import { DAY_MINUTES } from '@app/features/notebook/blockModel'

export interface MinuteSpan {
  startMinute: number
  endMinute: number
}

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
