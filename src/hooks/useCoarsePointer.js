import { useSyncExternalStore } from 'react'

export const COARSE_POINTER_QUERY = '(pointer: coarse)'

/**
 * Whether the primary pointer is coarse (a finger), by capability rather than
 * user agent. Live: attaching a keyboard and trackpad to a tablet flips it
 * without a reload.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function query() {
  try {
    return globalThis.matchMedia?.(COARSE_POINTER_QUERY) ?? null
  } catch {
    return null
  }
}

function getSnapshot() {
  return query()?.matches ?? false
}

function subscribe(onChange) {
  const list = query()
  if (!list) return () => {}
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
  // Safari before 14.
  list.addListener?.(onChange)
  return () => list.removeListener?.(onChange)
}
