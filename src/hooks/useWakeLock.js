import { useEffect } from 'react'

/**
 * Keep the screen awake while `active`. The browser drops the lock whenever the
 * tab is hidden, so it's requested again each time the page becomes visible.
 * Where the Screen Wake Lock API is missing or refuses (no HTTPS, battery
 * saver), nothing happens.
 */
export function useWakeLock(active) {
  useEffect(() => {
    const wakeLock = globalThis.navigator?.wakeLock
    if (!active || typeof wakeLock?.request !== 'function') return

    let sentinel = null
    let requesting = false
    let stopped = false

    async function acquire() {
      if (stopped || requesting || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      requesting = true
      try {
        const next = await wakeLock.request('screen')
        if (stopped) next.release().catch(() => {})
        else sentinel = next
      } catch {
        // Refused or unsupported: the screen may dim, and that's all.
      } finally {
        requesting = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sentinel?.release().catch(() => {})
    }
  }, [active])
}
