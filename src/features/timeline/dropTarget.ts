import { DAY_MINUTES, MIN_BLOCK_DURATION_MINUTES } from '@app/features/notebook/blockModel'

export interface MinuteSpan {
  startMinute: number
  endMinute: number
}

/** Longest auto-filled span when a new entry drops into a bounded gap. */
export const MAX_GAP_FILL_DURATION_MINUTES = 60

/** Duration used whenever a new entry is not filling a gap on both sides. */
export const DEFAULT_NEW_ENTRY_DURATION_MINUTES = 30

/**
 * Nearest collision-free landing spot for a dragged block.
 *
 * Walks the free gaps around `others` (any order; sorted internally) and picks
 * the placement closest to `releasedStart` that fits the block's duration
 * without overlapping another entry, clamping into the chosen gap. Returns
 * null when no gap is large enough — the caller then keeps the original
 * position.
 */
export function resolveDropTarget(others: MinuteSpan[], releasedStart: number, duration: number): number | null {
  const ordered = [...others].sort((left, right) => left.startMinute - right.startMinute)
  const gaps: Array<{ from: number; to: number }> = []
  let cursor = 0
  for (const span of ordered) {
    if (span.startMinute > cursor) gaps.push({ from: cursor, to: Math.min(span.startMinute, DAY_MINUTES) })
    cursor = Math.max(cursor, span.endMinute)
  }
  if (cursor < DAY_MINUTES) gaps.push({ from: cursor, to: DAY_MINUTES })

  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    if (gap.to - gap.from < duration) continue
    const candidate = Math.min(Math.max(releasedStart, gap.from), gap.to - duration)
    const distance = Math.abs(candidate - releasedStart)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * Start/end minutes for a brand-new entry created on a blank timeline spot at
 * `clickedMinute`.
 *
 * - Bounded by entries on both sides: starts flush against the previous
 *   entry's end and fills the gap, capped at one hour.
 * - Bounded on one side only: anchors the constrained edge (start after a
 *   previous entry, or end before a following one) with a default 30-minute
 *   duration.
 * - Unbounded: starts at the clicked minute with a default 30-minute duration.
 */
export function resolveClickedEntrySpan(others: MinuteSpan[], clickedMinute: number): MinuteSpan {
  const ordered = [...others].sort((left, right) => left.startMinute - right.startMinute)
  let previousEnd: number | null = null
  let nextStart: number | null = null
  for (const span of ordered) {
    if (span.endMinute <= clickedMinute && (previousEnd === null || span.endMinute > previousEnd)) {
      previousEnd = span.endMinute
    }
    if (span.startMinute >= clickedMinute && (nextStart === null || span.startMinute < nextStart)) {
      nextStart = span.startMinute
    }
  }

  const defaultDuration = DEFAULT_NEW_ENTRY_DURATION_MINUTES
  if (previousEnd !== null && nextStart !== null) {
    const endMinute = Math.max(
      Math.min(previousEnd + MAX_GAP_FILL_DURATION_MINUTES, nextStart),
      previousEnd + MIN_BLOCK_DURATION_MINUTES,
    )
    return { startMinute: previousEnd, endMinute }
  }
  if (previousEnd !== null) {
    const endMinute = Math.min(previousEnd + defaultDuration, DAY_MINUTES)
    return { startMinute: previousEnd, endMinute }
  }
  if (nextStart !== null) {
    return { startMinute: Math.max(0, nextStart - defaultDuration), endMinute: nextStart }
  }
  const startMinute = Math.min(Math.max(clickedMinute, 0), DAY_MINUTES - defaultDuration)
  return { startMinute, endMinute: startMinute + defaultDuration }
}
