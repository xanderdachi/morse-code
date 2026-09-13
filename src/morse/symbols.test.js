import { describe, expect, it } from 'vitest'
import * as symbols from './symbols.js'

describe('symbols', () => {
  it('has dots, dashes and a letter boundary, and no word boundary', () => {
    expect(symbols.DOT).toBe('.')
    expect(symbols.DASH).toBe('-')
    expect(symbols.LETTER_GAP).toBe(' ')
    expect(symbols.WORD_GAP).toBeUndefined()
  })

  it('knows a mark when it sees one', () => {
    expect(symbols.isMark('.')).toBe(true)
    expect(symbols.isMark('-')).toBe(true)
    expect(symbols.isMark(' ')).toBe(false)
    expect(symbols.isMark(undefined)).toBe(false)
  })
})
