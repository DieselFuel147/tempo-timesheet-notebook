import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIMELINE_WIDTH, MAX_TIMELINE_WIDTH, MIN_TIMELINE_WIDTH } from './constants'
import { clampTimelineWidth, readTimelineWidth, writeTimelineWidth } from './timelineWidth'

describe('clampTimelineWidth', () => {
  it('clamps to the configured bounds', () => {
    expect(clampTimelineWidth(0)).toBe(MIN_TIMELINE_WIDTH)
    expect(clampTimelineWidth(-100)).toBe(MIN_TIMELINE_WIDTH)
    expect(clampTimelineWidth(10_000)).toBe(MAX_TIMELINE_WIDTH)
    expect(clampTimelineWidth(DEFAULT_TIMELINE_WIDTH)).toBe(DEFAULT_TIMELINE_WIDTH)
  })
})

describe('read/writeTimelineWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to the default without a window (non-browser/test env)', () => {
    expect(readTimelineWidth()).toBe(DEFAULT_TIMELINE_WIDTH)
  })

  it('reads a persisted width and clamps bad values', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })

    store.set('tempo:timeline-width', '512')
    expect(readTimelineWidth()).toBe(512)

    store.set('tempo:timeline-width', 'not-a-number')
    expect(readTimelineWidth()).toBe(DEFAULT_TIMELINE_WIDTH)

    // Only positive persisted values are honored/clamped.
    store.set('tempo:timeline-width', '-20')
    expect(readTimelineWidth()).toBe(DEFAULT_TIMELINE_WIDTH)

    store.set('tempo:timeline-width', '9000')
    expect(readTimelineWidth()).toBe(MAX_TIMELINE_WIDTH)
  })

  it('writes the width rounded, and no-ops without a window', () => {
    const store = new Map<string, string>()
    const setItem = vi.fn((k: string, v: string) => void store.set(k, v))
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } })

    writeTimelineWidth(412.6)
    expect(store.get('tempo:timeline-width')).toBe('413')
  })
})
