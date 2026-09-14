import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// progress.js keeps an in-memory copy at module level, so each test gets a fresh module.
let progressModule
beforeEach(async () => {
  vi.resetModules()
  progressModule = await import('./progress.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.localStorage
})

const board = (tier, count = 8, idBase = tier * 100) =>
  Array.from({ length: count }, (_, i) => ({ id: idBase + i, tier, title: `P${i}` }))

// Clear each of `passages` in turn while playing `fullBoard`.
function clearMany(progress, passages, fullBoard = passages, accuracy = 90) {
  const { recordRun } = progressModule
  let outcome = { progress }
  for (const passage of passages) {
    outcome = recordRun(outcome.progress, { passageId: passage.id, accuracy, board: fullBoard })
  }
  return outcome
}

class MemoryStorage {
  items = new Map()
  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null
  }
  setItem(key, value) {
    this.items.set(key, String(value))
  }
  removeItem(key) {
    this.items.delete(key)
  }
}

describe('clear threshold', () => {
  it('clears a passage at exactly 80% accuracy', () => {
    const { defaultProgress, recordRun, isCleared } = progressModule
    const outcome = recordRun(defaultProgress(), { passageId: 101, accuracy: 80, board: board(1) })
    expect(outcome.cleared).toBe(true)
    expect(isCleared(outcome.progress, 101)).toBe(true)
  })

  it('does not clear a passage at 79%', () => {
    const { defaultProgress, recordRun, isCleared } = progressModule
    const outcome = recordRun(defaultProgress(), { passageId: 101, accuracy: 79, board: board(1) })
    expect(outcome.cleared).toBe(false)
    expect(isCleared(outcome.progress, 101)).toBe(false)
  })

  it('keeps the best accuracy per passage, cleared or not', () => {
    const { defaultProgress, recordRun } = progressModule
    let { progress } = recordRun(defaultProgress(), { passageId: 'hamlet', accuracy: 64, board: [] })
    expect(progress.bestByPassageId).toEqual({ hamlet: 64 })
    ;({ progress } = recordRun(progress, { passageId: 'hamlet', accuracy: 91, board: [] }))
    ;({ progress } = recordRun(progress, { passageId: 'hamlet', accuracy: 70, board: [] }))
    expect(progress.bestByPassageId).toEqual({ hamlet: 91 })
  })

  it('stays cleared after a worse run, and never lists a passage twice', () => {
    const { defaultProgress, recordRun } = progressModule
    let { progress } = recordRun(defaultProgress(), { passageId: 7, accuracy: 95, board: [] })
    ;({ progress } = recordRun(progress, { passageId: 7, accuracy: 20, board: [] }))
    ;({ progress } = recordRun(progress, { passageId: '7', accuracy: 99, board: [] }))
    expect(progress.clearedPassageIds).toEqual(['7'])
  })

  it('does not mutate the progress it was given', () => {
    const { defaultProgress, recordRun } = progressModule
    const before = defaultProgress()
    recordRun(before, { passageId: 1, accuracy: 100, board: board(1) })
    expect(before).toEqual(defaultProgress())
  })
})

describe('tier advancement', () => {
  const allIds = passages => passages.map(p => String(p.id))

  it('reports cleared out of every passage on the board', () => {
    const { defaultProgress, tierStatus } = progressModule
    const passages = board(2)
    const progress = { ...defaultProgress(), tier: 2, clearedPassageIds: allIds(passages.slice(0, 5)) }
    expect(tierStatus(progress, passages)).toEqual({ tier: 2, cleared: 5, total: 8, allCleared: false })
  })

  it('does not advance when the last passage on the board is cleared with others outstanding', () => {
    const { defaultProgress, recordRun } = progressModule
    const passages = board(1)
    for (const outstanding of [1, 2, 7]) {
      const before = { ...defaultProgress(), clearedPassageIds: allIds(passages.slice(0, 7 - outstanding)) }
      const outcome = recordRun(before, { passageId: passages[7].id, accuracy: 100, board: passages })
      expect(outcome.cleared).toBe(true)
      expect(outcome.advanced).toBe(false)
      expect(outcome.progress.tier).toBe(1)
    }
  })

  it('does not advance on 7 of 8, whichever 7', () => {
    const { defaultProgress, advanceTier } = progressModule
    const passages = board(1)
    for (let skip = 0; skip < 8; skip++) {
      const progress = { ...defaultProgress(), clearedPassageIds: allIds(passages.filter((_, i) => i !== skip)) }
      expect(advanceTier(progress, passages).advanced).toBe(false)
    }
  })

  it('advances once all eight are cleared, in any order, including last-first', () => {
    const { defaultProgress, recordRun } = progressModule
    const passages = board(1)
    const orders = [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [7, 0, 6, 1, 5, 2, 4, 3],
      [3, 7, 1, 5, 0, 6, 2, 4],
    ]
    for (const order of orders) {
      let progress = defaultProgress()
      for (const [step, i] of order.entries()) {
        const outcome = recordRun(progress, { passageId: passages[i].id, accuracy: 90, board: passages })
        expect(outcome.advanced, `order ${order}, step ${step}`).toBe(step === 7)
        progress = outcome.progress
      }
      expect(progress.tier).toBe(2)
    }
  })

  it('never looks at board order: shuffling the board changes nothing', () => {
    const { defaultProgress, advanceTier, tierStatus } = progressModule
    const passages = board(1)
    const progress = { ...defaultProgress(), clearedPassageIds: allIds(passages) }
    const shuffled = [passages[5], passages[2], passages[7], passages[0], passages[6], passages[1], passages[4], passages[3]]
    expect(tierStatus(progress, shuffled)).toEqual(tierStatus(progress, passages))
    expect(advanceTier(progress, shuffled)).toEqual(advanceTier(progress, passages))
  })

  it('does not increment the cleared count when the same passage is cleared again', () => {
    const { defaultProgress, recordRun, tierStatus } = progressModule
    const passages = board(1)
    let progress = defaultProgress()
    for (let i = 0; i < 5; i++) ({ progress } = recordRun(progress, { passageId: passages[3].id, accuracy: 100, board: passages }))
    expect(progress.clearedPassageIds).toEqual([String(passages[3].id)])
    expect(tierStatus(progress, passages).cleared).toBe(1)
  })

  it('does not clear below 80, and clears on a later pass at 80 or more', () => {
    const { defaultProgress, recordRun, isCleared } = progressModule
    const passages = board(1)
    let { progress } = recordRun(defaultProgress(), { passageId: passages[0].id, accuracy: 79, board: passages })
    expect(isCleared(progress, passages[0].id)).toBe(false)
    ;({ progress } = recordRun(progress, { passageId: passages[0].id, accuracy: 65, board: passages }))
    expect(isCleared(progress, passages[0].id)).toBe(false)
    ;({ progress } = recordRun(progress, { passageId: passages[0].id, accuracy: 84, board: passages }))
    expect(isCleared(progress, passages[0].id)).toBe(true)
  })

  it('does not advance when an already cleared passage is re-cleared on a full board', () => {
    const { defaultProgress, recordRun } = progressModule
    const passages = board(2)
    const progress = { ...defaultProgress(), tier: 2, clearedPassageIds: allIds(passages) }
    expect(recordRun(progress, { passageId: passages[0].id, accuracy: 100, board: passages }).advanced).toBe(false)
  })

  it('never advances from a board that belongs to another tier (offline fallback)', () => {
    const { defaultProgress, recordRun, tierStatus } = progressModule
    const bundled = board(1)
    let progress = { ...defaultProgress(), tier: 2 }
    for (const passage of bundled) {
      const outcome = recordRun(progress, { passageId: passage.id, accuracy: 100, board: bundled })
      expect(outcome.advanced).toBe(false)
      progress = outcome.progress
    }
    expect(progress.tier).toBe(2)
    expect(tierStatus(progress, bundled)).toEqual({ tier: 2, cleared: 0, total: 8, allCleared: false })
  })

  it('needs every passage on a board shorter than eight', () => {
    const { defaultProgress, recordRun } = progressModule
    const short = board(1, 4)
    let progress = defaultProgress()
    for (const [i, passage] of short.entries()) {
      const outcome = recordRun(progress, { passageId: passage.id, accuracy: 90, board: short })
      expect(outcome.advanced).toBe(i === 3)
      progress = outcome.progress
    }
  })

  it('completes rather than advancing at tier 5, without throwing', () => {
    const { defaultProgress, recordRun } = progressModule
    const passages = board(5)
    let progress = { ...defaultProgress(), tier: 5 }
    let outcome
    expect(() => {
      for (const passage of passages) {
        outcome = recordRun(progress, { passageId: passage.id, accuracy: 100, board: passages })
        progress = outcome.progress
      }
    }).not.toThrow()
    expect(outcome).toMatchObject({ advanced: false, completed: true })
    expect(progress.tier).toBe(5)
    // Clearing again afterwards neither advances nor completes a second time.
    expect(recordRun(progress, { passageId: passages[0].id, accuracy: 100, board: passages })).toMatchObject({
      advanced: false,
      completed: false,
    })
  })

  it('climbs from tier 1 to 5 and no further', () => {
    const { defaultProgress } = progressModule
    let progress = defaultProgress()
    for (let tier = 1; tier <= 5; tier++) {
      const outcome = clearMany(progress, board(tier))
      expect(outcome.progress.tier).toBe(Math.min(tier + 1, 5))
      progress = outcome.progress
    }
    expect(progress.tier).toBe(5)
  })
})

describe('board selection', () => {
  it('remembers a board per tier, and it survives a reload with its cleared state', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const ids = ['12', '7', '31', '4', '19', '22', '8', '15']
    const { defaultProgress, saveProgress, setBoardIds, recordRun } = progressModule
    const passages = ids.map(id => ({ id: Number(id), tier: 1 }))
    let progress = setBoardIds(defaultProgress(), 1, ids)
    ;({ progress } = recordRun(progress, { passageId: 31, accuracy: 95, board: passages }))
    saveProgress(progress)

    vi.resetModules()
    const reloaded = await import('./progress.js')
    const restored = reloaded.loadProgress()
    expect(reloaded.boardIdsFor(restored, 1)).toEqual(ids)
    expect(reloaded.boardIdsFor(restored, 2)).toBeNull()
    expect(reloaded.tierStatus(restored, passages)).toMatchObject({ cleared: 1, total: 8 })
  })

  it('keeps at most eight ids per tier and drops junk', () => {
    const { defaultProgress, setBoardIds, saveProgress, loadProgress } = progressModule
    vi.stubGlobal('localStorage', new MemoryStorage())
    expect(setBoardIds(defaultProgress(), 2, [1, 2, 2, null, 3, 4, 5, 6, 7, 8, 9]).boardsByTier).toEqual({
      2: ['1', '2', '3', '4', '5', '6', '7', '8'],
    })
    saveProgress({ ...defaultProgress(), boardsByTier: { 2: [1, 2, 2, null, 3], 9: [1], x: 'nope' } })
    expect(loadProgress().boardsByTier).toEqual({ 2: ['1', '2', '3'] })
  })
})

describe('storage', () => {
  it('round-trips through localStorage under morse-club-v1', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { saveProgress, loadProgress, STORAGE_KEY } = progressModule

    saveProgress({ tier: 3, clearedPassageIds: ['12', 'hamlet'], bestByPassageId: { 12: 88 }, inputMode: 'pad', unitMs: 64, anchoredInput: false })

    expect(STORAGE_KEY).toBe('morse-club-v1')
    expect(JSON.parse(storage.getItem('morse-club-v1'))).toEqual({
      tier: 3,
      clearedPassageIds: ['12', 'hamlet'],
      bestByPassageId: { 12: 88 },
      inputMode: 'pad',
      unitMs: 64,
      anchoredInput: false,
      boardsByTier: {},
      touchControls: 'auto',
      sidetone: null,
      onboardingSeen: true,
      keyerMode: 'manual',
      keyerWpm: 20,
    })
    expect(loadProgress()).toEqual({
      tier: 3,
      clearedPassageIds: ['12', 'hamlet'],
      bestByPassageId: { 12: 88 },
      inputMode: 'pad',
      unitMs: 64,
      anchoredInput: false,
      boardsByTier: {},
      touchControls: 'auto',
      sidetone: null,
      onboardingSeen: true,
      keyerMode: 'manual',
      keyerWpm: 20,
    })
  })

  it('starts from defaults when nothing is saved', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    expect(progressModule.loadProgress()).toEqual({
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
      keyerWpm: 20,
    })
  })

  it('starts from defaults when saved data is corrupt', () => {
    const storage = new MemoryStorage()
    storage.setItem('morse-club-v1', '{not json')
    vi.stubGlobal('localStorage', storage)
    expect(progressModule.loadProgress()).toEqual(progressModule.defaultProgress())
  })

  it('repairs saved data with the wrong shape', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'morse-club-v1',
      JSON.stringify({
        tier: 9,
        clearedPassageIds: [4, '4', null, 'x'],
        bestByPassageId: { 4: 'lots', x: 140 },
        inputMode: 'telegraph',
        unitMs: '90',
        anchoredInput: 'no',
        touchControls: 'always',
        sidetone: 'loud',
        onboardingSeen: 'yes',
      }),
    )
    vi.stubGlobal('localStorage', storage)
    expect(progressModule.loadProgress()).toEqual({
      tier: 5,
      clearedPassageIds: ['4', 'x'],
      bestByPassageId: { x: 100 },
      inputMode: 'key',
      unitMs: null,
      anchoredInput: true,
      boardsByTier: {},
      touchControls: 'auto',
      sidetone: null,
      onboardingSeen: true,
      keyerMode: 'manual',
      keyerWpm: 20,
    })
  })

  it('keeps working in memory when every localStorage call throws', () => {
    const quotaError = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', { getItem: quotaError, setItem: quotaError, removeItem: quotaError })
    const { loadProgress, saveProgress, setInputMode } = progressModule

    expect(() => loadProgress()).not.toThrow()
    expect(loadProgress()).toEqual(progressModule.defaultProgress())

    const next = setInputMode({ ...loadProgress(), tier: 2 }, 'pad')
    expect(() => saveProgress(next)).not.toThrow()
    expect(loadProgress()).toEqual({ ...progressModule.defaultProgress(), tier: 2, inputMode: 'pad' })
  })

  it('keeps working in memory when even reading localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    const { loadProgress, saveProgress } = progressModule

    expect(loadProgress()).toEqual(progressModule.defaultProgress())
    saveProgress({ tier: 4, clearedPassageIds: ['1'], bestByPassageId: { 1: 97 }, inputMode: 'key' })
    expect(loadProgress().tier).toBe(4)
  })

  it('keeps working when localStorage does not exist at all', () => {
    const { loadProgress, saveProgress } = progressModule
    expect(globalThis.localStorage).toBeUndefined()
    expect(loadProgress()).toEqual(progressModule.defaultProgress())
    expect(saveProgress({ ...progressModule.defaultProgress(), inputMode: 'pad' }).inputMode).toBe('pad')
    expect(loadProgress().inputMode).toBe('pad')
  })
})

describe('setCalibration', () => {
  it('persists a calibrated dot length, clamped to the estimator range', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const { defaultProgress, setCalibration, saveProgress, loadProgress } = progressModule
    saveProgress(setCalibration(defaultProgress(), 72.5))
    expect(loadProgress().unitMs).toBe(72.5)
    expect(setCalibration(defaultProgress(), 5).unitMs).toBe(40)
    expect(setCalibration(defaultProgress(), 9000).unitMs).toBe(400)
  })

  it('forgets the calibration with null', () => {
    const { setCalibration, defaultProgress } = progressModule
    expect(setCalibration({ ...defaultProgress(), unitMs: 80 }, null).unitMs).toBeNull()
  })
})

describe('anchored input', () => {
  it('defaults on, and stays on below tier 5 whatever was chosen', () => {
    const { defaultProgress, isAnchored, setAnchoredInput } = progressModule
    expect(defaultProgress().anchoredInput).toBe(true)
    for (const tier of [1, 2, 3, 4]) {
      expect(isAnchored(setAnchoredInput({ ...defaultProgress(), tier }, false))).toBe(true)
    }
  })

  it('can be switched off at tier 5, and persists', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const { defaultProgress, isAnchored, setAnchoredInput, saveProgress, loadProgress } = progressModule
    saveProgress(setAnchoredInput({ ...defaultProgress(), tier: 5 }, false))
    expect(isAnchored(loadProgress())).toBe(false)
    expect(isAnchored(setAnchoredInput(loadProgress(), true))).toBe(true)
  })
})

describe('undo availability', () => {
  it('is offered at tiers 1 to 3 only', () => {
    const { defaultProgress, canUndo } = progressModule
    expect([1, 2, 3, 4, 5].map(tier => canUndo({ ...defaultProgress(), tier }))).toEqual([true, true, true, false, false])
  })
})

describe('setInputMode', () => {
  it('accepts key and pad only', () => {
    const { defaultProgress, setInputMode } = progressModule
    const progress = defaultProgress()
    expect(setInputMode(progress, 'pad').inputMode).toBe('pad')
    expect(setInputMode(progress, 'semaphore')).toBe(progress)
  })
})

describe('touch controls', () => {
  it('follows the device on auto and obeys an override either way', () => {
    const { defaultProgress, setTouchControls, usesTouchControls } = progressModule
    const auto = defaultProgress()
    expect(auto.touchControls).toBe('auto')
    expect([usesTouchControls(auto, true), usesTouchControls(auto, false)]).toEqual([true, false])
    const on = setTouchControls(auto, 'on')
    expect([usesTouchControls(on, true), usesTouchControls(on, false)]).toEqual([true, true])
    const off = setTouchControls(auto, 'off')
    expect([usesTouchControls(off, true), usesTouchControls(off, false)]).toEqual([false, false])
    expect(setTouchControls(auto, 'sometimes')).toBe(auto)
  })

  it('persists the override', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const { defaultProgress, setTouchControls, saveProgress, loadProgress } = progressModule
    saveProgress(setTouchControls(defaultProgress(), 'off'))
    expect(loadProgress().touchControls).toBe('off')
  })
})

describe('sidetone', () => {
  it('is on by default exactly when touch controls are in use, until the player chooses', () => {
    const { defaultProgress, setSidetone, sidetoneOn } = progressModule
    const progress = defaultProgress()
    expect([sidetoneOn(progress, true), sidetoneOn(progress, false)]).toEqual([true, false])
    expect([sidetoneOn(setSidetone(progress, false), true), sidetoneOn(setSidetone(progress, true), false)]).toEqual([false, true])
    expect(sidetoneOn(setSidetone(setSidetone(progress, false), null), true)).toBe(true)
  })

  it('persists the choice', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const { defaultProgress, setSidetone, saveProgress, loadProgress } = progressModule
    saveProgress(setSidetone(defaultProgress(), false))
    expect(loadProgress().sidetone).toBe(false)
  })
})

describe('onboarding', () => {
  it('is unseen for a new player and stays seen once marked, across a reload', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { loadProgress, saveProgress, markOnboardingSeen } = progressModule
    expect(loadProgress().onboardingSeen).toBe(false)
    saveProgress(markOnboardingSeen(loadProgress()))

    vi.resetModules()
    const reloaded = await import('./progress.js')
    expect(reloaded.loadProgress().onboardingSeen).toBe(true)
  })

  it('counts a player with progress saved before the intro existed as having seen it', () => {
    const storage = new MemoryStorage()
    storage.setItem('morse-club-v1', JSON.stringify({ tier: 2, clearedPassageIds: ['4'], inputMode: 'pad' }))
    vi.stubGlobal('localStorage', storage)
    expect(progressModule.loadProgress().onboardingSeen).toBe(true)
  })

  it('stays seen for the session when storage throws on every call', () => {
    const fail = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    const { loadProgress, saveProgress, markOnboardingSeen } = progressModule
    expect(loadProgress().onboardingSeen).toBe(false)
    saveProgress(markOnboardingSeen(loadProgress()))
    expect(loadProgress().onboardingSeen).toBe(true)
  })

  it('stays seen for the session when storage reads but will not write', () => {
    const storage = new MemoryStorage()
    storage.setItem('morse-club-v1', JSON.stringify(progressModule.defaultProgress()))
    storage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', storage)
    const { loadProgress, saveProgress, markOnboardingSeen } = progressModule
    expect(loadProgress().onboardingSeen).toBe(false)
    saveProgress(markOnboardingSeen(loadProgress()))
    // The stored copy still says unseen; it must not bring the intro back.
    expect(loadProgress().onboardingSeen).toBe(true)
  })
})

describe('leniency table', () => {
  it('holds the rules for every tier in one place', () => {
    const { LENIENCY } = progressModule
    expect(LENIENCY).toEqual({
      1: { undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false },
      2: { undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false },
      3: { undo: true, prosign: 'free', errorGapUnits: 2, unanchored: false },
      4: { undo: false, prosign: 'deletion', errorGapUnits: 2, unanchored: false },
      5: { undo: false, prosign: 'deletion', errorGapUnits: 2, unanchored: true },
    })
    expect(Object.isFrozen(LENIENCY[3])).toBe(true)
  })

  it('drives undo, anchoring and the prosign cost', () => {
    const { defaultProgress, canUndo, isAnchored, prosignDeletions, leniencyFor, UNANCHORED_FROM_TIER } = progressModule
    for (let tier = 1; tier <= 5; tier++) {
      const progress = { ...defaultProgress(), tier, anchoredInput: false }
      expect(canUndo(progress)).toBe(leniencyFor(tier).undo)
      expect(isAnchored(progress)).toBe(!leniencyFor(tier).unanchored)
      expect(prosignDeletions(progress, 2)).toBe(leniencyFor(tier).prosign === 'deletion' ? 2 : 0)
    }
    expect(UNANCHORED_FROM_TIER).toBe(5)
    expect(leniencyFor(0)).toBe(leniencyFor(1))
    expect(leniencyFor(9)).toBe(leniencyFor(5))
  })
})

describe('iambic keyer settings', () => {
  it('defaults to the manual pad at 20 WPM', () => {
    const { defaultProgress, usesIambic } = progressModule
    expect(defaultProgress()).toMatchObject({ keyerMode: 'manual', keyerWpm: 20 })
    expect(usesIambic({ ...defaultProgress(), inputMode: 'pad' })).toBe(false)
  })

  it('persists the mode and a speed clamped to 5–40 WPM', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const { defaultProgress, setKeyerMode, setKeyerWpm, saveProgress, loadProgress, usesIambic } = progressModule
    saveProgress(setKeyerWpm(setKeyerMode({ ...defaultProgress(), inputMode: 'pad' }, 'iambic'), 27.4))
    expect(loadProgress()).toMatchObject({ keyerMode: 'iambic', keyerWpm: 27 })
    expect(usesIambic(loadProgress())).toBe(true)
    expect(setKeyerWpm(defaultProgress(), 2).keyerWpm).toBe(5)
    expect(setKeyerWpm(defaultProgress(), 90).keyerWpm).toBe(40)
    expect(setKeyerMode(defaultProgress(), 'bug').keyerMode).toBe('manual')
  })
})
