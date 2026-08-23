import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { NotebookDay } from '@shared/types'
import {
  DAY_MINUTES,
  MIN_BLOCK_DURATION_MINUTES,
  getTimedBlocks,
  markBlockDirty,
  replaceBlockById,
} from '@app/features/notebook/blockModel'
import { PX_PER_MINUTE } from './constants'
import { resolveDropTarget } from './dropTarget'

// Pointer travel (px) before a press on a block body counts as a drag rather
// than a click.
const DRAG_START_THRESHOLD_PX = 4

/** Live visual offset of a block mid-drag, kept outside the day model. */
export interface BlockDragPreview {
  id: string
  deltaMinutes: number
}

interface Options {
  dayRef: { current: NotebookDay | null }
  commitDay: (update: (current: NotebookDay) => NotebookDay) => void
  getCurrentMinute: (forDate: string) => number
  setExpandedId: (updater: string | null | ((current: string | null) => string | null)) => void
}

// Pointer-driven timeline editing: edge pins resize a block, the body drag
// moves it while preserving duration. Also owns click-to-expand, suppressing
// the synthetic click that follows a real drag.
export function useBlockDrag({ dayRef, commitDay, getCurrentMinute, setExpandedId }: Options) {
  // Set while a timeline block body drag is in flight; the click that follows
  // pointerup must not toggle that block's expansion.
  const justDraggedIdRef = useRef<string | null>(null)
  // Visual offset while dragging. Deliberately not committed to the day model
  // so the block can travel over other entries; overlaps never reach state.
  const [blockDragPreview, setBlockDragPreview] = useState<BlockDragPreview | null>(null)

  const handlePinPointerDown = useCallback(
    (id: string, edge: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const currentDay = dayRef.current
      if (!currentDay) return
      const nowMinute = getCurrentMinute(currentDay.date)
      const timedBlocks = getTimedBlocks(currentDay.blocks, nowMinute)
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return

      const current = timedBlocks[timedIndex]
      const previous = timedBlocks[timedIndex - 1]
      const next = timedBlocks[timedIndex + 1]
      const startValue = edge === 'start' ? current.startMinute : current.endMinute
      const pointerStart = event.clientY

      const onMove = (moveEvent: PointerEvent) => {
        const deltaMinutes = Math.round((moveEvent.clientY - pointerStart) / PX_PER_MINUTE)
        let nextValue = startValue + deltaMinutes

        if (edge === 'start') {
          const min = previous?.endMinute ?? 0
          const max = current.endMinute - MIN_BLOCK_DURATION_MINUTES
          nextValue = Math.min(Math.max(nextValue, min), max)
          commitDay((dayState) => ({
            date: dayState.date,
            blocks: replaceBlockById(dayState.blocks, id, (block) => markBlockDirty({ ...block, startMinute: nextValue })),
          }))
        } else {
          const min = current.startMinute + MIN_BLOCK_DURATION_MINUTES
          const max = next?.startMinute ?? DAY_MINUTES
          nextValue = Math.min(Math.max(nextValue, min), max)
          commitDay((dayState) => ({
            date: dayState.date,
            blocks: replaceBlockById(dayState.blocks, id, (block) => markBlockDirty({ ...block, endMinute: nextValue })),
          }))
        }
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commitDay, dayRef, getCurrentMinute],
  )

  // Whole-block drag: shifts both edges by the same delta so the duration is
  // preserved. The block travels freely over other entries while dragging
  // (preview only); on release it snaps to the nearest gap that fits, falling
  // back to its original spot when no gap is large enough. A genuine drag
  // suppresses the click that would otherwise toggle expansion.
  const handleTimelineBlockPointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // Interactive controls inside the block (pins, merge/absorb buttons)
      // handle their own pointer events; only the body starts a move.
      if ((event.target as HTMLElement).closest('button')) return

      const currentDay = dayRef.current
      if (!currentDay) return
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return

      const current = timedBlocks[timedIndex]
      if (!current.block.closed) return
      const startMinute = current.startMinute
      const duration = current.endMinute - current.startMinute
      // Free vertical travel within the day bounds only — passing over other
      // entries is allowed; landing is resolved against them on release.
      const maxDelta = DAY_MINUTES - duration - startMinute
      const pointerStart = event.clientY
      let moved = false
      let lastApplied: number | null = null

      event.preventDefault()

      const onMove = (moveEvent: PointerEvent) => {
        const offsetY = moveEvent.clientY - pointerStart
        if (!moved && Math.abs(offsetY) < DRAG_START_THRESHOLD_PX) return
        moved = true
        justDraggedIdRef.current = id

        const applied = Math.min(Math.max(Math.round(offsetY / PX_PER_MINUTE), -startMinute), maxDelta)
        if (applied === lastApplied) return
        lastApplied = applied
        setBlockDragPreview({ id, deltaMinutes: applied })
      }

      const clearJustDragged = () => {
        // The click event (if any) fires after pointerup; clear the suppression
        // flag on a later tick so a click that never arrives can't swallow the
        // next legitimate one.
        window.setTimeout(() => {
          if (justDraggedIdRef.current === id) justDraggedIdRef.current = null
        }, 0)
      }

      const finish = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        setBlockDragPreview(null)

        const applied = lastApplied
        if (!moved || applied === null || applied === 0) {
          clearJustDragged()
          return
        }

        // Snap to the nearest collision-free gap; stay put when none fits.
        const others = timedBlocks
          .filter((item) => item.block.id !== id)
          .map((item) => ({ startMinute: item.startMinute, endMinute: item.endMinute }))
        const landed = resolveDropTarget(others, startMinute + applied, duration)
        if (landed !== null && landed !== startMinute) {
          commitDay((dayState) => ({
            date: dayState.date,
            blocks: replaceBlockById(dayState.blocks, id, (block) =>
              markBlockDirty({ ...block, startMinute: landed, endMinute: landed + duration }),
            ),
          }))
        }
        clearJustDragged()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [commitDay, dayRef, getCurrentMinute],
  )

  // Click handler for timeline blocks: ignores the synthetic click that follows
  // a block drag so dragging never toggles expansion.
  const handleTimelineBlockClick = useCallback((id: string) => {
    if (justDraggedIdRef.current === id) {
      justDraggedIdRef.current = null
      return
    }
    setExpandedId((current) => (current === id ? null : id))
  }, [setExpandedId])

  return { handlePinPointerDown, handleTimelineBlockPointerDown, handleTimelineBlockClick, blockDragPreview }
}
