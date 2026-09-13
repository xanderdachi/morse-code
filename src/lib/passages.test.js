import { describe, expect, it } from 'vitest'
import { assembleBoard, fallbackPassages, loadBoard } from './passages.js'
import { boardIdsFor, defaultProgress, setBoardIds, tierStatus } from './progress.js'

// A fake database: 22 active tier-1 passages (like production), ids 1..22,
// shortest first by id. Supports deactivating a passage and failing.
function fakeSource({ inactive = [], failing = false } = {}) {
  const rows = Array.from({ length: 22 }, (_, i) => ({ id: i + 1, tier: 1, title: `P${i + 1}`, charCount: 20 + i }))
  const active = row => !inactive.includes(row.id)
  const calls = []
  return {
    calls,
    async forTier(tier, { limit = 8, excludeIds = [] } = {}) {
      calls.push(['forTier', tier, limit, excludeIds])
      if (failing) return null
      return rows
        .filter(row => row.tier === tier && active(row) && !excludeIds.map(String).includes(String(row.id)))
        .sort((a, b) => a.charCount - b.charCount)
        .slice(0, limit)
    },
    async byIds(tier, ids) {
      calls.push(['byIds', tier, ids])
      if (failing) return null
      return rows.filter(row => row.tier === tier && active(row) && ids.map(String).includes(String(row.id)))
    },
    add(row) {
      rows.push(row)
    },
  }
}

describe('loadBoard', () => {
  it('picks eight passages on the first visit and returns their ids to remember', async () => {
    const source = fakeSource()
    const board = await loadBoard(1, null, source)
    expect(board.offline).toBe(false)
    expect(board.ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('reuses the remembered ids on later visits, even if the database would now choose differently', async () => {
    const source = fakeSource()
    source.add({ id: 99, tier: 1, title: 'New and short', charCount: 1 })
    const stored = ['3', '14', '7', '22', '1', '9', '18', '5']
    const board = await loadBoard(1, stored, source)
    expect(board.ids).toEqual(stored)
    expect(board.passages.map(p => p.id)).toEqual(stored.map(Number))
    expect(source.calls.some(([kind]) => kind === 'forTier')).toBe(false)
  })

  it('replaces only a remembered passage that is no longer active, in its own slot', async () => {
    const source = fakeSource({ inactive: [7] })
    const stored = ['3', '14', '7', '22', '1', '9', '18', '5']
    const board = await loadBoard(1, stored, source)
    // 7 is gone; the shortest passage not already on the board (2) takes its slot.
    expect(board.ids).toEqual(['3', '14', '2', '22', '1', '9', '18', '5'])
  })

  it('keeps a reloaded board and its cleared state intact', async () => {
    const source = fakeSource()
    const first = await loadBoard(1, null, source)
    let progress = setBoardIds(defaultProgress(), 1, first.ids)
    progress = { ...progress, clearedPassageIds: ['2', '6'] }

    const again = await loadBoard(1, boardIdsFor(progress, 1), source)
    expect(again.ids).toEqual(first.ids)
    expect(tierStatus(progress, again.passages)).toEqual({ tier: 1, cleared: 2, total: 8, allCleared: false })
  })

  it('falls back to the bundled passages without returning ids to remember', async () => {
    for (const stored of [null, ['1', '2', '3']]) {
      const board = await loadBoard(1, stored, fakeSource({ failing: true }))
      expect(board).toEqual({ passages: fallbackPassages, offline: true, ids: null })
    }
  })
})

describe('assembleBoard', () => {
  it('keeps remembered order and drops a slot only when there is no replacement', () => {
    const found = [{ id: 2 }, { id: 5 }]
    expect(assembleBoard(['5', '9', '2'], found, [{ id: 11 }]).map(p => p.id)).toEqual([5, 11, 2])
    expect(assembleBoard(['5', '9', '2'], found, []).map(p => p.id)).toEqual([5, 2])
  })
})
