// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeMatchMedia } from '../testing/fakeMatchMedia.js'
import { useCoarsePointer } from './useCoarsePointer.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCoarsePointer', () => {
  it('reads (pointer: coarse) and follows changes to it without a reload', () => {
    const media = fakeMatchMedia(true)
    vi.stubGlobal('matchMedia', media.matchMedia)
    const { result, unmount } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(true)

    act(() => media.setCoarse(false))
    expect(result.current).toBe(false)
    act(() => media.setCoarse(true))
    expect(result.current).toBe(true)

    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('is false where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })
})
