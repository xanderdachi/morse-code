import { COARSE_POINTER_QUERY } from '../hooks/useCoarsePointer.js'

// A matchMedia whose pointer can be swapped, like attaching a keyboard and trackpad to a tablet.
export function fakeMatchMedia(coarse) {
  const listeners = new Set()
  const matchMedia = query => ({
    media: query,
    get matches() {
      return query === COARSE_POINTER_QUERY && coarse
    },
    addEventListener: (type, listener) => type === 'change' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  })
  return {
    matchMedia,
    listeners,
    setCoarse(next) {
      coarse = next
      for (const listener of [...listeners]) listener({ matches: next, media: COARSE_POINTER_QUERY })
    },
  }
}
