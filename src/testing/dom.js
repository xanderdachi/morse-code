// Helpers for tests that run in jsdom.
import { act } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * One clock for a test: performance.now() reads `clock.now`, and events
 * dispatched through the clock carry it as their timeStamp, as a browser's do.
 */
export function mockClock(start = 10_000) {
  const clock = {
    now: start,

    /** Dispatch a real DOM event stamped at `at` (default: now), moving the clock there. */
    fire(target, type, init = {}, at = clock.now) {
      clock.now = at
      const EventType = type.startsWith('pointer') ? PointerEvent : type.startsWith('key') ? KeyboardEvent : Event
      const event = new EventType(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'touch', ...init })
      Object.defineProperty(event, 'timeStamp', { value: at })
      act(() => {
        target.dispatchEvent(event)
      })
      return event
    },

    /** A touch press on `target` from `at` for `durationMs`. */
    tap(target, { at = clock.now, durationMs = 80, pointerId = 1, pointerType = 'touch' } = {}) {
      clock.fire(target, 'pointerdown', { pointerId, pointerType }, at)
      clock.fire(target, 'pointerup', { pointerId, pointerType }, at + durationMs)
    },

    /** A keyboard press from `at` for `durationMs`: Space, '.' or '-'. */
    press(key, { at = clock.now, durationMs = 80 } = {}) {
      const init = key === ' ' ? { key, code: 'Space' } : { key, code: key === '.' ? 'Period' : 'Minus' }
      clock.fire(window, 'keydown', init, at)
      clock.fire(window, 'keyup', init, at + durationMs)
    },

    /** Let `ms` pass: the clock moves and any timers due by then run. Needs vi.useFakeTimers(). */
    wait(ms) {
      act(() => {
        clock.now += ms
        vi.advanceTimersByTime(ms)
      })
    },
  }
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  return clock
}
