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
      return dispatch(target, type, init, at)
    },

    /** Dispatch a real DOM event now, stamped earlier at `stampedAt`: input that waited behind a busy main thread. */
    fireLate(target, type, init, stampedAt) {
      return dispatch(target, type, init, stampedAt)
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

    /**
     * Let `ms` pass in one jump: the clock moves and any timers due by then run, all seeing the later time,
     * as they would on a page whose main thread was busy for `ms`. Needs vi.useFakeTimers().
     */
    wait(ms) {
      act(() => {
        clock.now += ms
        vi.advanceTimersByTime(ms)
      })
    },

    /** Let `ms` pass a few ms at a time, so each timer runs within `stepMs` of when it's due, as on a page keeping up. */
    run(ms, stepMs = 4) {
      for (let left = ms; left > 0; left -= stepMs) clock.wait(Math.min(stepMs, left))
    },
  }
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
  return clock
}

function dispatch(target, type, init, timeStamp) {
  const EventType = type.startsWith('pointer') ? PointerEvent : type.startsWith('key') ? KeyboardEvent : Event
  const event = new EventType(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'touch', ...init })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/**
 * requestAnimationFrame under the test's control: frames only happen when the
 * test asks for them, and `queued` shows whether anything is still scheduled.
 */
export function fakeFrames(clock) {
  const pending = new Map()
  let nextId = 1
  vi.stubGlobal('requestAnimationFrame', callback => {
    const id = nextId++
    pending.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', id => {
    pending.delete(id)
  })
  return {
    get queued() {
      return pending.size
    },
    /** One frame, `ms` after the last. */
    step(ms = 16) {
      clock.now += ms
      const due = [...pending.values()]
      pending.clear()
      act(() => {
        for (const callback of due) callback(clock.now)
      })
    },
  }
}
