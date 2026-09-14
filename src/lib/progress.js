// Everything the app remembers between visits, under one localStorage key.
//
//   { tier, clearedPassageIds, bestByPassageId, inputMode, unitMs, anchoredInput, boardsByTier,
//     touchControls, sidetone, onboardingSeen, keyerMode, keyerWpm }
//
// unitMs is the operator's calibrated dot length, or null if they never calibrated.
// anchoredInput is the player's choice at tier 5; below that anchoring is always on.
// boardsByTier remembers which passages make up each tier's board, chosen on the
// first visit, so a later fetch can't swap in passages the player hasn't seen.
// touchControls is 'auto' (follow the device), 'on' or 'off'.
// sidetone is null to follow the device (on with touch controls), or the player's choice.
// onboardingSeen is set once the first-visit intro has been closed, however it was closed.
// keyerMode is how the dot/dash pad keys: 'manual' (each tap is an element) or
// 'iambic' (held paddles generate elements at keyerWpm).
//
// localStorage can throw (Safari private browsing, blocked site data), so every
// call is guarded and the latest saved state is also kept in memory: if storage
// is unavailable the app keeps working for the rest of the session.
// Passage ids are stored as strings, since Supabase ids are numbers and JSON
// object keys aren't.

import { CONFIG } from '../morse/timing.js'

export const STORAGE_KEY = 'morse-club-v1'
export const CLEAR_ACCURACY = 80 // percent, as shown in results
export const MAX_TIER = 5
export const BOARD_SIZE = 8

/**
 * How forgiving each tier is, in one place. Every leniency decision in the app
 * reads from here; nothing else hardcodes a tier or a threshold.
 *
 *   undo            the undo control (and Backspace) is offered
 *   prosign         what taking a letter back with the error prosign costs:
 *                   'free' (the letter is left out of grading) or 'deletion'
 *                   (it is graded as a missed letter)
 *   errorGapUnits   on the error path, a gap this many units long ends a letter
 *   unanchored      the player may switch anchoring off and decode by timing alone
 */
export const LENIENCY = Object.freeze({
  1: Object.freeze({ undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false }),
  2: Object.freeze({ undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false }),
  3: Object.freeze({ undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false }),
  4: Object.freeze({ undo: false, prosign: 'deletion', errorGapUnits: 2, unanchored: false }),
  5: Object.freeze({ undo: false, prosign: 'deletion', errorGapUnits: 2, unanchored: true }),
})

/** The leniency row for a tier (clamped to the tiers that exist). */
export function leniencyFor(tier) {
  return LENIENCY[Math.min(MAX_TIER, Math.max(1, Math.trunc(tier) || 1))]
}

/** The first tier where anchoring can be switched off, for telling players when it unlocks. */
export const UNANCHORED_FROM_TIER = Number(Object.keys(LENIENCY).find(tier => LENIENCY[tier].unanchored))

export const TOUCH_CONTROL_SETTINGS = ['auto', 'on', 'off']
export const KEYER_MODES = ['manual', 'iambic']
export const KEYER_WPM = Object.freeze({ min: 5, max: 40, default: 20 })

const INPUT_MODE_IDS = ['key', 'pad']

let memory = null
let unsaved = false // the last save didn't reach storage, so memory is newer than anything stored

export function defaultProgress() {
  return {
    tier: 1,
    clearedPassageIds: [],
    bestByPassageId: {},
    inputMode: 'key',
    unitMs: null,
    anchoredInput: true,
    boardsByTier: {},
    touchControls: 'auto',
    sidetone: null,
    onboardingSeen: false,
    keyerMode: 'manual',
    keyerWpm: KEYER_WPM.default,
  }
}

/** Saved progress, or defaults. Never throws. */
export function loadProgress() {
  // A stale stored copy must never undo a save that only reached memory.
  if (unsaved && memory) return memory
  let raw
  try {
    raw = globalThis.localStorage.getItem(STORAGE_KEY)
  } catch {
    return memory ?? defaultProgress()
  }
  if (raw === null) return memory ?? defaultProgress()

  try {
    memory = sanitize(JSON.parse(raw))
  } catch {
    memory ??= defaultProgress()
  }
  return memory
}

/** Persist progress (in memory at least). Returns the stored value. Never throws. */
export function saveProgress(progress) {
  memory = sanitize(progress)
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
    unsaved = false
  } catch {
    // Storage unavailable: memory holds it for this session.
    unsaved = true
  }
  return memory
}

export function isCleared(progress, passageId) {
  return progress.clearedPassageIds.includes(String(passageId))
}

/**
 * How far through the current tier the player is: which of the board's
 * passages are cleared, out of all of them. Only passages that belong to the
 * current tier count (an offline fallback board from another tier counts for
 * nothing). Board order plays no part.
 */
export function tierStatus(progress, board) {
  const inTier = board.filter(passage => passage.tier === progress.tier)
  const cleared = inTier.filter(passage => isCleared(progress, passage.id)).length
  return {
    tier: progress.tier,
    cleared,
    total: inTier.length || board.length,
    allCleared: inTier.length > 0 && inTier.length === board.length && cleared === inTier.length,
  }
}

/**
 * Move up a tier if, and only if, every passage on the board is cleared.
 * At tier 5 a fully cleared board completes the game instead of advancing.
 * Returns { progress, advanced, completed }.
 */
export function advanceTier(progress, board) {
  if (!tierStatus(progress, board).allCleared) return { progress, advanced: false, completed: false }
  if (progress.tier >= MAX_TIER) return { progress, advanced: false, completed: true }
  return { progress: { ...progress, tier: progress.tier + 1 }, advanced: true, completed: false }
}

/**
 * Apply a finished run. `accuracy` is the whole percentage shown to the player.
 * Returns the next progress, whether this run cleared the passage, and whether
 * it moved the player up a tier or completed tier 5. Only a newly cleared
 * passage can do either, so reloading a board never cascades through tiers.
 */
export function recordRun(progress, { passageId, accuracy, board }) {
  const id = String(passageId)
  const cleared = accuracy >= CLEAR_ACCURACY
  const newlyCleared = cleared && !progress.clearedPassageIds.includes(id)

  const next = {
    ...progress,
    bestByPassageId: { ...progress.bestByPassageId, [id]: Math.max(progress.bestByPassageId[id] ?? 0, accuracy) },
    clearedPassageIds: newlyCleared ? [...progress.clearedPassageIds, id] : progress.clearedPassageIds,
  }

  if (!newlyCleared) return { progress: next, cleared, advanced: false, completed: false }
  return { ...advanceTier(next, board), cleared }
}

/** The passage ids chosen for a tier's board, or null if it hasn't been chosen yet. */
export function boardIdsFor(progress, tier) {
  return progress.boardsByTier[tier] ?? null
}

/** Remember the passages that make up a tier's board. */
export function setBoardIds(progress, tier, ids) {
  return { ...progress, boardsByTier: { ...progress.boardsByTier, [tier]: sanitizeIds(ids).slice(0, BOARD_SIZE) } }
}

export function setInputMode(progress, inputMode) {
  return INPUT_MODE_IDS.includes(inputMode) ? { ...progress, inputMode } : progress
}

/** Whether runs decode against the passage: always, unless the tier allows otherwise and the player chose it. */
export function isAnchored(progress) {
  return !leniencyFor(progress.tier).unanchored || progress.anchoredInput
}

/** Whether the undo control is offered at the player's tier. */
export function canUndo(progress) {
  return leniencyFor(progress.tier).undo
}

/** How many letters taken back with the error prosign to grade as missed, at the player's tier. */
export function prosignDeletions(progress, scrubbedLetters) {
  return leniencyFor(progress.tier).prosign === 'deletion' ? scrubbedLetters : 0
}

/** Choose anchored or pure-timing input. Only takes effect where the tier allows it. */
export function setAnchoredInput(progress, anchoredInput) {
  return { ...progress, anchoredInput: Boolean(anchoredInput) }
}

/** Store a calibrated dot length (clamped to the estimator's range), or null to forget it. */
export function setCalibration(progress, unitMs) {
  return { ...progress, unitMs: sanitizeUnit(unitMs) }
}

/** 'auto', 'on' or 'off'. */
export function setTouchControls(progress, touchControls) {
  return TOUCH_CONTROL_SETTINGS.includes(touchControls) ? { ...progress, touchControls } : progress
}

/** Whether to lay out the on-screen touch keys: the override, or the device's primary pointer when on auto. */
export function usesTouchControls(progress, coarsePointer) {
  if (progress.touchControls === 'on') return true
  if (progress.touchControls === 'off') return false
  return Boolean(coarsePointer)
}

/** Turn the sidetone on or off; null goes back to the device default. */
export function setSidetone(progress, on) {
  return { ...progress, sidetone: typeof on === 'boolean' ? on : null }
}

/** Whether the sidetone plays: the player's choice, else on exactly when touch controls are in use. */
export function sidetoneOn(progress, touchControls) {
  return progress.sidetone ?? Boolean(touchControls)
}

/** 'manual' or 'iambic', for the dot/dash pad. */
export function setKeyerMode(progress, keyerMode) {
  return KEYER_MODES.includes(keyerMode) ? { ...progress, keyerMode } : progress
}

/** The iambic keyer's speed, rounded and clamped to 5–40 WPM. */
export function setKeyerWpm(progress, wpm) {
  return Number.isFinite(wpm) ? { ...progress, keyerWpm: clampWpm(wpm) } : progress
}

/** Whether the pad generates elements itself: pad mode with the iambic keyer on. */
export function usesIambic(progress) {
  return progress.inputMode === 'pad' && progress.keyerMode === 'iambic'
}

export function markOnboardingSeen(progress) {
  return progress.onboardingSeen ? progress : { ...progress, onboardingSeen: true }
}

// Coerce anything read back from storage into a valid progress object.
function sanitize(value) {
  const input = value !== null && typeof value === 'object' ? value : {}

  const tier = Number.isInteger(input.tier) ? Math.min(MAX_TIER, Math.max(1, input.tier)) : 1

  const clearedPassageIds = sanitizeIds(input.clearedPassageIds)

  const bestByPassageId = {}
  if (input.bestByPassageId !== null && typeof input.bestByPassageId === 'object') {
    for (const [id, accuracy] of Object.entries(input.bestByPassageId)) {
      if (Number.isFinite(accuracy)) bestByPassageId[id] = Math.min(100, Math.max(0, accuracy))
    }
  }

  const inputMode = INPUT_MODE_IDS.includes(input.inputMode) ? input.inputMode : 'key'

  const anchoredInput = typeof input.anchoredInput === 'boolean' ? input.anchoredInput : true

  const boardsByTier = {}
  if (input.boardsByTier !== null && typeof input.boardsByTier === 'object') {
    for (let t = 1; t <= MAX_TIER; t++) {
      const ids = sanitizeIds(input.boardsByTier[t]).slice(0, BOARD_SIZE)
      if (ids.length > 0) boardsByTier[t] = ids
    }
  }

  return {
    tier,
    clearedPassageIds,
    bestByPassageId,
    inputMode,
    unitMs: sanitizeUnit(input.unitMs),
    anchoredInput,
    boardsByTier,
    touchControls: TOUCH_CONTROL_SETTINGS.includes(input.touchControls) ? input.touchControls : 'auto',
    sidetone: typeof input.sidetone === 'boolean' ? input.sidetone : null,
    // Progress saved before the intro existed belongs to a returning player, who never needs it.
    onboardingSeen: typeof input.onboardingSeen === 'boolean' ? input.onboardingSeen : true,
    keyerMode: KEYER_MODES.includes(input.keyerMode) ? input.keyerMode : 'manual',
    keyerWpm: Number.isFinite(input.keyerWpm) ? clampWpm(input.keyerWpm) : KEYER_WPM.default,
  }
}

function clampWpm(wpm) {
  return Math.min(KEYER_WPM.max, Math.max(KEYER_WPM.min, Math.round(wpm)))
}

function sanitizeIds(ids) {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter(id => typeof id === 'string' || typeof id === 'number').map(String))]
}

function sanitizeUnit(unitMs) {
  return Number.isFinite(unitMs) ? Math.min(CONFIG.maxUnitMs, Math.max(CONFIG.minUnitMs, unitMs)) : null
}
