import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { NotebookDay } from '@shared/types'
import {
  DAY_MINUTES,
  MIN_BLOCK_DURATION_MINUTES,
  getTimedBlocks,
  markBlockDirty,
  replaceBlockById,
} from '@app/features/notebook/blockModel'
import { PX_PER_MINUTE } from './constants'

// Pointer travel (px) before a press on a block body counts as a drag rather
// than a click.
const DRAG_START_THRESHOLD_PX = 4

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
          const max = next?.startMinute ?? getCurrentMinute(currentDay.date)
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
  // preserved, clamped against neighbouring blocks and the day bounds. A
  // genuine drag suppresses the click that would otherwise toggle expansion.
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
      const previous = timedBlocks[timedIndex - 1]
      const next = timedBlocks[timedIndex + 1]
      const minDelta = (previous?.endMinute ?? 0) - startMinute
      const maxDelta = (next?.startMinute ?? DAY_MINUTES) - current.endMinute
      const pointerStart = event.clientY
      let moved = false
      let lastApplied: number | null = null

      event.preventDefault()

      const onMove = (moveEvent: PointerEvent) => {
        const offsetY = moveEvent.clientY - pointerStart
        if (!moved && Math.abs(offsetY) < DRAG_START_THRESHOLD_PX) return
        moved = true
        justDraggedIdRef.current = id

        const applied = Math.min(Math.max(Math.round(offsetY / PX_PER_MINUTE), minDelta), maxDelta)
        if (applied === lastApplied) return
        lastApplied = applied
        commitDay((dayState) => ({
          date: dayState.date,
          blocks: replaceBlockById(dayState.blocks, id, (block) =>
            markBlockDirty({ ...block, startMinute: startMinute + applied, endMinute: startMinute + applied + duration }),
          ),
        }))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        // The click event (if any) fires after pointerup; clear the suppression
        // flag on a later tick so a click that never arrives can't swallow the
        // next legitimate one.
        window.setTimeout(() => {
          if (justDraggedIdRef.current === id) justDraggedIdRef.current = null
        }, 0)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
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

  return { handlePinPointerDown, handleTimelineBlockPointerDown, handleTimelineBlockClick }
}
