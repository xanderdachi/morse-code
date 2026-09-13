import { useLayoutEffect } from 'react'

const GAP_PX = 14 // between the bottom of the passage and the tops of the keys
const MIN_PASSAGE_PX = 96

/**
 * The touch layout's room around the floating keys. Measures the keys and sets
 * two custom properties on the scrolling practice screen:
 *   --dock-room     the keys' height, as padding so the last content scrolls clear of them
 *   --passage-room  the tallest the passage panel may be and still end above the
 *                   keys with the screen scrolled to the top (scrolling only moves it up)
 * Re-measured whenever the keys, the screen or the content above the passage change size.
 */
export function useDockRoom({ enabled, screenRef, dockRef, passageRef, layout }) {
  useLayoutEffect(() => {
    const screen = screenRef.current
    const dock = dockRef.current
    if (!enabled || !screen || !dock) return

    function measure() {
      const dockHeight = Math.ceil(dock.getBoundingClientRect().height)
      screen.style.setProperty('--dock-room', `${dockHeight}px`)
      const passage = passageRef.current
      if (!passage) return
      const top = passage.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop
      const room = Math.floor(screen.clientHeight - top - dockHeight - GAP_PX)
      screen.style.setProperty('--passage-room', `${Math.max(MIN_PASSAGE_PX, room)}px`)
    }

    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(screen)
    observer?.observe(dock)
    for (const child of screen.children) observer?.observe(child)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      screen.style.removeProperty('--dock-room')
      screen.style.removeProperty('--passage-room')
    }
    // `layout` names what's docked (the key or the pads), so a switch re-attaches to the new keys.
  }, [enabled, screenRef, dockRef, passageRef, layout])
}
