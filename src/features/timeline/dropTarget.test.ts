import { describe, expect, it } from 'vitest'
import { resolveClickedEntrySpan, resolveDropTarget } from './dropTarget'

const span = (startMinute: number, endMinute: number) => ({ startMinute, endMinute })

describe('resolveDropTarget', () => {
  it('lands exactly where released when the hovered gap fits', () => {
    const others = [span(9 * 60, 10 * 60), span(14 * 60, 15 * 60)]
    // Released inside the 11:00–14:00 gap with a 60-minute block.
    expect(resolveDropTarget(others, 11 * 60 + 30, 60)).toBe(11 * 60 + 30)
  })

  it('snaps forward to the nearest fitting gap when released over another entry', () => {
    const others = [span(9 * 60, 10 * 60), span(11 * 60, 12 * 60), span(15 * 60, 16 * 60)]
    // Released at 11:30 (inside the 11–12 entry) dragging a 45-minute block:
    // the 12:00–15:00 gap clamps to 12:00, the 10:00–11:00 gap would clamp to
    // 10:15 — 12:00 is closer.
    expect(resolveDropTarget(others, 11 * 60 + 30, 45)).toBe(12 * 60)
  })

  it('snaps backward when the earlier gap is closer', () => {
    const others = [span(10 * 60, 11 * 60), span(12 * 60, 13 * 60 + 40)]
    // Released at 10:55 (over the first entry) with a 100-minute block: the
    // head gap clamps to 08:20, the gap past the last entry clamps to 13:40 —
    // the earlier one is closer.
    expect(resolveDropTarget(others, 11 * 60 - 5, 100)).toBe(8 * 60 + 20)
  })

  it('clamps into the only fitting gap even when released far outside it', () => {
    const others = [span(12 * 60, 13 * 60)]
    // Tail gap (13:00–24:00) is 660m — too small for a 700m block — so the
    // drop clamps flush against the entry from above despite the release
    // sitting near midnight.
    expect(resolveDropTarget(others, 23 * 60, 700)).toBe(20)
  })

  it('returns null when no gap fits the duration so the caller keeps the original spot', () => {
    const others = [span(8 * 60, 9 * 60), span(9 * 60 + 90, 17 * 60)]
    // Free gaps: 00:00–08:00 (480m), 09:00–10:30 (90m), 17:00–24:00 (420m).
    // A 500-minute block fits nowhere.
    expect(resolveDropTarget(others, 12 * 60, 500)).toBeNull()
  })

  it('uses the head and tail gaps, clamping at the day edges when needed', () => {
    const others = [span(10 * 60, 11 * 60)]
    // Fits exactly where released inside the tail gap…
    expect(resolveDropTarget(others, 22 * 60 + 30, 60)).toBe(22 * 60 + 30)
    // …clamps back against the day end when released past it…
    expect(resolveDropTarget(others, 23 * 60 + 40, 60)).toBe(23 * 60)
    // …and sits where released inside the head gap.
    expect(resolveDropTarget(others, 40, 60)).toBe(40)
  })

  it('tolerates overlapping other entries without producing negative gaps', () => {
    const others = [span(9 * 60, 11 * 60), span(10 * 60, 12 * 60)]
    // Overlap collapses into a single cursor; the drop must not land inside it.
    const landed = resolveDropTarget(others, 10 * 60 + 30, 60)
    expect(landed).not.toBeNull()
    expect(landed! + 60 <= 9 * 60 || landed! >= 12 * 60).toBe(true)
  })
})

describe('resolveClickedEntrySpan', () => {
  it('fills a gap bounded on both sides, starting against the previous entry', () => {
    const others = [span(9 * 60, 10 * 60), span(13 * 60, 14 * 60)]
    // Clicked anywhere in the 10:00–13:00 gap: start 10:00, end capped at 11:00.
    expect(resolveClickedEntrySpan(others, 11 * 60 + 30)).toEqual({ startMinute: 10 * 60, endMinute: 11 * 60 })
  })

  it('fills a narrow bounded gap edge to edge when it is under the cap', () => {
    const others = [span(9 * 60, 10 * 60), span(10 * 60 + 50, 12 * 60)]
    // Gap is only 50 minutes — filled fully rather than capped.
    expect(resolveClickedEntrySpan(others, 10 * 60 + 20)).toEqual({ startMinute: 10 * 60, endMinute: 10 * 60 + 50 })
  })

  it('anchors the start after the previous entry when only bounded above', () => {
    const others = [span(9 * 60, 10 * 60)]
    // Clicked below the only entry: 10:00–10:30.
    expect(resolveClickedEntrySpan(others, 15 * 60)).toEqual({ startMinute: 10 * 60, endMinute: 10 * 60 + 30 })
  })

  it('anchors the end before the next entry when only bounded below', () => {
    const others = [span(12 * 60, 13 * 60)]
    // Clicked above the only entry: 11:30–12:00.
    expect(resolveClickedEntrySpan(others, 9 * 60)).toEqual({ startMinute: 11 * 60 + 30, endMinute: 12 * 60 })
  })

  it('starts at the clicked minute with a default duration when unbounded', () => {
    expect(resolveClickedEntrySpan([], 14 * 60 + 10)).toEqual({ startMinute: 14 * 60 + 10, endMinute: 14 * 60 + 40 })
  })

  it('clamps unbounded clicks against the day edges', () => {
    // Near midnight the 30-minute default cannot run past 24:00, so the start
    // pulls back to 23:30…
    expect(resolveClickedEntrySpan([], 23 * 60 + 50)).toEqual({ startMinute: 23 * 60 + 30, endMinute: 24 * 60 })
    // …and negative clicks pin to midnight.
    expect(resolveClickedEntrySpan([], -5)).toEqual({ startMinute: 0, endMinute: 30 })
  })

  it('treats clicks exactly on an entry boundary as the adjacent gap', () => {
    const others = [span(9 * 60, 10 * 60), span(12 * 60, 13 * 60)]
    // Clicked exactly at the entry's end: bounded on both sides below.
    expect(resolveClickedEntrySpan(others, 10 * 60)).toEqual({ startMinute: 10 * 60, endMinute: 11 * 60 })
    // Clicked exactly at the next entry's start: same gap, same result.
    expect(resolveClickedEntrySpan(others, 12 * 60)).toEqual({ startMinute: 10 * 60, endMinute: 11 * 60 })
  })
})
