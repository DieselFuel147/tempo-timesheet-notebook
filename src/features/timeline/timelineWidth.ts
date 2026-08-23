import { DEFAULT_TIMELINE_WIDTH, MAX_TIMELINE_WIDTH, MIN_TIMELINE_WIDTH } from './constants'

const TIMELINE_WIDTH_KEY = 'tempo:timeline-width'

export function clampTimelineWidth(width: number): number {
  return Math.min(MAX_TIMELINE_WIDTH, Math.max(MIN_TIMELINE_WIDTH, width))
}

export function readTimelineWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_TIMELINE_WIDTH
  const parsed = Number(window.localStorage.getItem(TIMELINE_WIDTH_KEY))
  return Number.isFinite(parsed) && parsed > 0 ? clampTimelineWidth(parsed) : DEFAULT_TIMELINE_WIDTH
}

export function writeTimelineWidth(width: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TIMELINE_WIDTH_KEY, String(Math.round(width)))
}
