import { passages as bundledPassages } from '../data/passages.js'
import { normalize } from '../morse/alphabet.js'
import { BOARD_SIZE } from './progress.js'

export { BOARD_SIZE }

const FETCH_TIMEOUT_MS = 6000
const COLUMNS = 'id, tier, title, author, culture, era, blurb, text_original, text_morse_safe'

// Passage shape used throughout the app:
//   { id, tier, title, author, culture, era, blurb, text, textMorseSafe }
// `text` is for display; `textMorseSafe` is what gets graded. era and blurb may be null.

/** Bundled passages, used whenever Supabase can't provide a board. */
export const fallbackPassages = bundledPassages.map(passage => ({
  ...passage,
  textMorseSafe: normalize(passage.text),
}))

/**
 * Up to `limit` active passages for a tier, shortest first, skipping `excludeIds`.
 * Returns null on any failure (not configured, network, timeout, permissions).
 */
export async function fetchPassagesForTier(tier, { limit = BOARD_SIZE, excludeIds = [] } = {}) {
  return query(`tier ${tier} passages`, supabase => {
    let request = supabase.from('passages').select(COLUMNS).eq('tier', tier).eq('active', true)
    if (excludeIds.length > 0) request = request.not('id', 'in', `(${excludeIds.join(',')})`)
    return request.order('char_count', { ascending: true }).limit(limit)
  })
}

/**
 * The passages with these ids that are still active and still in this tier.
 * Returns null on any failure.
 */
export async function fetchPassagesByIds(tier, ids) {
  return query(`tier ${tier} board`, supabase =>
    supabase.from('passages').select(COLUMNS).in('id', ids).eq('tier', tier).eq('active', true),
  )
}

const supabaseSource = { forTier: fetchPassagesForTier, byIds: fetchPassagesByIds }

/**
 * The board for a tier.
 *
 * The first visit picks up to BOARD_SIZE passages and returns their ids for the
 * caller to remember. Every later visit asks for exactly those ids, so a
 * refetch can never swap in a passage the player hasn't seen. A remembered id
 * that is no longer active (or moved tier) is replaced in its own slot by the
 * shortest passage not already on the board; the rest are kept.
 *
 * Returns { passages, offline, ids }: ids to store (null when offline, so a
 * fallback board is never remembered as the tier's board).
 */
export async function loadBoard(tier, storedIds = null, source = supabaseSource) {
  if (storedIds?.length) {
    const found = await source.byIds(tier, storedIds)
    if (found) {
      const foundIds = new Set(found.map(passage => String(passage.id)))
      const missing = storedIds.filter(id => !foundIds.has(String(id))).length
      const replacements = missing > 0 ? await source.forTier(tier, { limit: missing, excludeIds: storedIds }) : []
      if (replacements) {
        const passages = assembleBoard(storedIds, found, replacements)
        if (passages.length > 0) return { passages, offline: false, ids: passages.map(passage => String(passage.id)) }
      }
    }
  } else {
    const passages = await source.forTier(tier)
    if (passages?.length) return { passages, offline: false, ids: passages.map(passage => String(passage.id)) }
  }
  return { passages: fallbackPassages, offline: true, ids: null }
}

/** Remembered ids in their original order, each filled by its passage or, if gone, the next replacement. */
export function assembleBoard(storedIds, found, replacements) {
  const byId = new Map(found.map(passage => [String(passage.id), passage]))
  const spare = [...replacements]
  return storedIds.map(id => byId.get(String(id)) ?? spare.shift()).filter(Boolean)
}

async function query(what, build) {
  if (globalThis.navigator?.onLine === false) return null
  try {
    // Loaded on demand so the game (and its bundled passages) never waits on the client.
    const { supabase } = await import('./supabase.js')
    if (!supabase) return null

    const { data, error } = await build(supabase)
      // Fail fast: postgrest-js otherwise retries network errors for ~7s, and
      // the bundled passages are a better answer than a long skeleton.
      .retry(false)
      .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS))

    if (error || !Array.isArray(data)) {
      if (import.meta.env.DEV) console.warn(`Couldn't fetch ${what}.`, error)
      return null
    }
    return data.map(fromRow).filter(Boolean)
  } catch (error) {
    if (import.meta.env.DEV) console.warn(`Couldn't fetch ${what}.`, error)
    return null
  }
}

function fromRow(row) {
  // Re-normalizing is a no-op for well-seeded rows and keeps a bad row playable.
  const textMorseSafe = normalize(row.text_morse_safe ?? '')
  if (!row.text_original || !textMorseSafe) return null

  if (import.meta.env.DEV && textMorseSafe.toUpperCase() !== normalize(row.text_original).toUpperCase()) {
    console.warn(
      `Passage ${row.id}: text_morse_safe doesn't match text_original after normalizing, ` +
        'so the on-screen cursor and the grading will disagree.',
    )
  }

  return {
    id: row.id,
    tier: row.tier,
    title: row.title,
    author: row.author ?? 'Oral tradition',
    culture: row.culture,
    era: row.era,
    blurb: row.blurb,
    text: row.text_original,
    textMorseSafe,
  }
}
