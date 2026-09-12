// International Morse code: letters, digits, and the common punctuation marks.

export const CHAR_TO_MORSE = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',

  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',

  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-',
  '"': '.-..-.', $: '...-..-', '@': '.--.-.',
})

export const MORSE_TO_CHAR = Object.freeze(
  Object.fromEntries(Object.entries(CHAR_TO_MORSE).map(([char, code]) => [code, char])),
)

/** Morse code for a single character (case-insensitive), or undefined if it has none. */
export function toMorse(char) {
  return CHAR_TO_MORSE[char.toUpperCase()]
}

/** Character for a code like '.-', or undefined if the code isn't in the table. */
export function fromMorse(code) {
  return MORSE_TO_CHAR[code]
}

const SINGLE_QUOTES = /[‘’‚‛′]/g // ‘ ’ ‚ ‛ ′
const DOUBLE_QUOTES = /[“”„‟″«»]/g // “ ” „ ‟ ″ « »

/**
 * Reduce text to what can be sent in Morse: accents stripped, curly quotes
 * straightened, whitespace collapsed to single spaces, and every character
 * without a Morse code dropped. Case is preserved.
 */
export function normalize(text) {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')

  let out = ''
  for (const char of plain) {
    if (/\s/.test(char)) out += ' '
    else if (toMorse(char)) out += char
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

/** Whether a single displayed character becomes a letter the operator must send. */
export function isSendable(char) {
  return !/\s/.test(char) && normalize(char) !== ''
}
