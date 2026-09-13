import { describe, expect, it } from 'vitest'
import { CHAR_TO_MORSE, MORSE_TO_CHAR, fromMorse, isSendable, normalize, toMorse } from './alphabet.js'

describe('tables', () => {
  it('covers A–Z and 0–9', () => {
    for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(CHAR_TO_MORSE[char]).toMatch(/^[.-]+$/)
    }
  })

  it('has a unique code for every character', () => {
    expect(Object.keys(MORSE_TO_CHAR)).toHaveLength(Object.keys(CHAR_TO_MORSE).length)
  })

  it('looks up both directions, case-insensitively', () => {
    expect(toMorse('s')).toBe('...')
    expect(toMorse('S')).toBe('...')
    expect(fromMorse('...')).toBe('S')
    expect(toMorse('#')).toBeUndefined()
    expect(fromMorse('........')).toBeUndefined()
  })
})

describe('normalize', () => {
  it('strips accents and keeps case', () => {
    expect(normalize('Café Déjà vu, naïve Øre')).toBe('Cafe Deja vu, naive re')
  })

  it('straightens curly quotes', () => {
    expect(normalize('‘It’s’ “quoted” „low‟ «guillemets»')).toBe(`'It's' "quoted" "low" "guillemets"`)
  })

  it('drops characters with no Morse code', () => {
    expect(normalize('Wait — really? #1 * ~ 50% ★')).toBe('Wait really? 1 50')
  })

  it('collapses whitespace and trims', () => {
    expect(normalize('  To be,\n\tor   not to be.  ')).toBe('To be, or not to be.')
  })

  it('handles accents written as combining marks', () => {
    expect(normalize('été')).toBe('ete')
  })

  it('is idempotent', () => {
    const once = normalize('“Hope” is the thing — with feathers')
    expect(normalize(once)).toBe(once)
  })
})

describe('isSendable', () => {
  it('agrees with normalize about which characters count', () => {
    const text = 'Petit à petit, l’oiseau fait son nid — ★ “yes”'
    const sendable = [...text].filter(isSendable).map(normalize).join('')
    expect(sendable).toBe(normalize(text).replaceAll(' ', ''))
  })

  it('treats whitespace as not sendable', () => {
    expect(isSendable(' ')).toBe(false)
    expect(isSendable('a')).toBe(true)
    expect(isSendable('—')).toBe(false)
  })
})

describe('normalize keep option', () => {
  it('retains listed characters that have no Morse code', () => {
    expect(normalize('E#T ★', { keep: '#' })).toBe('E#T')
    expect(normalize('E#T')).toBe('ET')
  })

  it('tolerates non-string input', () => {
    expect(normalize(null)).toBe('')
    expect(normalize(undefined)).toBe('')
  })
})
