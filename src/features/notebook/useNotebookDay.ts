import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotebookBlock, NotebookDay } from '@shared/types'
import { parseTime } from '@shared/validation'
import {
  MIN_BLOCK_DURATION_MINUTES,
  TIMELINE_REFRESH_MS,
  cloneBlock,
  createBlankBlock,
  effectiveIdleThresholdMs,
  getTimedBlocks,
  markBlockDirty,
  normalizeNotebookDay,
  patchBlock,
  persistedNotebookDay,
  replaceBlockById,
} from './blockModel'
import { parseDuration } from '@app/dateutil'
import { api } from '@app/api'
import type { NotebookErrorSource } from '@app/features/activity/activityLog'

type SetExpandedId = (updater: string | null | ((current: string | null) => string | null)) => void

interface Options {
  date: string
  getCurrentMinute: (forDate: string) => number
  /** Re-anchors the app clock when a day finishes loading. */
  resetClockAnchor: (forDate: string) => void
  setExpandedId: SetExpandedId
  /** Receives notebook failures (day load, autosave, AI suggest) for logging. */
  onError: (source: NotebookErrorSource, message: string) => void
}

// Owns the notebook day lifecycle: loading/saving a day, the live-entry idle
// auto-close heartbeat, and every block mutation handler (text, ticket, time,
// duration, summary, delete, gap absorb, merge, AI suggest).
export function useNotebookDay({ date, getCurrentMinute, resetClockAnchor, setExpandedId, onError }: Options) {
  const [day, setDay] = useState<NotebookDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [suggestingId, setSuggestingId] = useState<string | null>(null)

  const dayRef = useRef<NotebookDay | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number | null>(null)
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const textAreaRefCallbacks = useRef(new Map<string, (element: HTMLTextAreaElement | null) => void>())

  useEffect(() => {
    dayRef.current = day
  }, [day])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .getDay(date)
      .then((loaded) => {
        if (cancelled) return
        setDay(normalizeNotebookDay(loaded))
        lastActivityRef.current = null
        resetClockAnchor(loaded.date)
        setExpandedId(null)
      })
      .catch((cause) => {
        if (cancelled) return
        onError('day-load', (cause as Error).message)
        const fallbackDay = normalizeNotebookDay({ date, blocks: [] })
        setDay(fallbackDay)
        resetClockAnchor(date)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, onError, resetClockAnchor, setExpandedId])

  const scheduleSave = useCallback((nextDay: NotebookDay) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveDay({ day: persistedNotebookDay(nextDay) }).catch((cause) => onError('day-save', (cause as Error).message))
    }, 500)
  }, [onError])

  // Heartbeat for live entries: closes the active block once typing has been
  // idle past the threshold (auto-closed blocks stay reopenable via text edits).
  useEffect(() => {
    const handle = setInterval(() => {
      const lastActivity = lastActivityRef.current
      const currentDay = dayRef.current
      if (!currentDay || lastActivity === null) return
      if (Date.now() - lastActivity < effectiveIdleThresholdMs()) return

      const nowMinute = getCurrentMinute(currentDay.date)
      const activeIndex = currentDay.blocks.findIndex((block) => block.startMinute !== null && !block.closed)
      if (activeIndex === -1) return

      const nextBlocks = currentDay.blocks.map((block, index) =>
        index === activeIndex
          ? { ...block, closed: true, endMinute: Math.max(block.startMinute ?? nowMinute, nowMinute), manualEnd: false }
          : block,
      )
      const normalized = normalizeNotebookDay({ date: currentDay.date, blocks: nextBlocks })
      setDay(normalized)
      scheduleSave(normalized)
      lastActivityRef.current = null
    }, TIMELINE_REFRESH_MS)

    return () => clearInterval(handle)
  }, [getCurrentMinute, scheduleSave])

  const commitDay = useCallback((update: (current: NotebookDay) => NotebookDay, save = true) => {
    const currentDay = dayRef.current
    if (!currentDay) return
    const nextDay = normalizeNotebookDay(update(currentDay))
    dayRef.current = nextDay
    setDay(nextDay)
    if (save) scheduleSave(nextDay)
  }, [scheduleSave])

  const getTextAreaRef = useCallback((id: string) => {
    if (!textAreaRefCallbacks.current.has(id)) {
      textAreaRefCallbacks.current.set(id, (element: HTMLTextAreaElement | null) => {
        textAreaRefs.current[id] = element
      })
    }
    return textAreaRefCallbacks.current.get(id) as (element: HTMLTextAreaElement | null) => void
  }, [])

  const activeReopenableId = useMemo(() => {
    if (!day || day.blocks.length < 2) return null
    const previous = day.blocks[day.blocks.length - 2]
    const trailing = day.blocks[day.blocks.length - 1]
    if (
      previous.closed &&
      previous.startMinute !== null &&
      trailing.startMinute === null &&
      trailing.text.trim() === '' &&
      trailing.ticketId.trim() === ''
    ) {
      return previous.id
    }
    return null
  }, [day])

  const handleTextChange = useCallback((id: string, value: string, eventTarget?: HTMLTextAreaElement | null) => {
    lastActivityRef.current = Date.now()
    commitDay((currentDay) => {
      const nowMinute = getCurrentMinute(currentDay.date)
      const index = currentDay.blocks.findIndex((block) => block.id === id)
      if (index === -1) return currentDay
      const blocks = currentDay.blocks.map(cloneBlock)
      const block = blocks[index]
      const isUnstartedDraft = block.startMinute === null && !block.closed
      const isTrailingBlank = index === blocks.length - 1 && isUnstartedDraft
      const reopenableId = (() => {
        if (blocks.length < 2) return null
        const previous = blocks[blocks.length - 2]
        const trailing = blocks[blocks.length - 1]
        if (
          previous.closed &&
          previous.startMinute !== null &&
          trailing.startMinute === null &&
          trailing.text.trim() === '' &&
          trailing.ticketId.trim() === ''
        ) {
          return previous.id
        }
        return null
      })()
      const activeIndex = blocks.findIndex((candidate) => candidate.startMinute !== null && !candidate.closed)

      // Auto-closed entries (idle timeout) reopen when the user keeps typing —
      // that is the "continue this note" affordance. Manually closed entries
      // (end time / duration / Stop pill) must never lose their end time, so
      // they fall through to a plain text edit.
      if (reopenableId === id && block.manualEnd !== true) {
        blocks[index] = patchBlock(block, {
          text: value,
          closed: false,
          endMinute: null,
          manualEnd: false,
          summaryOverride: block.summaryOverride,
        })
        return { date: currentDay.date, blocks }
      }

      if (isUnstartedDraft) {
        if (activeIndex !== -1) {
          blocks[activeIndex] = patchBlock(blocks[activeIndex], {
            closed: true,
            endMinute: Math.max(blocks[activeIndex].startMinute ?? nowMinute, nowMinute),
            manualEnd: false,
          })
        }
        blocks[index] = patchBlock(block, {
          startMinute: nowMinute,
          endMinute: null,
          closed: false,
          text: value,
        })
        if (isTrailingBlank) blocks.push(createBlankBlock(currentDay.date))
        return { date: currentDay.date, blocks }
      }

      blocks[index] = patchBlock(block, { text: value })
      return { date: currentDay.date, blocks }
    })

    if (eventTarget) {
      eventTarget.style.height = 'auto'
      eventTarget.style.height = `${eventTarget.scrollHeight}px`
    }
  }, [commitDay, getCurrentMinute])

  const handleTicketChange = useCallback((id: string, ticketId: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) => (block.id === id ? patchBlock(block, { ticketId }) : block)),
    }))
  }, [commitDay])

  // Manual (retroactive) time entry. Deliberately does NOT touch lastActivityRef
  // or auto-close siblings — unlike live typing — so the idle timer can't stomp
  // a hand-set time and overlaps are left for validation to flag.
  const handleTimeChange = useCallback((id: string, edge: 'start' | 'end', value: string) => {
    const minutes = value.trim() === '' ? null : parseTime(value)
    if (value.trim() !== '' && minutes === null) return
      commitDay((currentDay) => ({
        date: currentDay.date,
        blocks: currentDay.blocks.map((block) => {
          if (block.id !== id) return block
          if (edge === 'start') {
            return minutes === null
              ? patchBlock(block, { startMinute: null, endMinute: null, closed: false, manualEnd: false })
              : patchBlock(block, { startMinute: minutes })
          }
          return minutes === null
            ? patchBlock(block, { endMinute: null, closed: false, manualEnd: false })
            : patchBlock(block, { endMinute: minutes, closed: true, manualEnd: true })
        }),
      }))
  }, [commitDay])

  const handleDurationChange = useCallback((id: string, value: string) => {
    const durationMinutes = parseDuration(value)
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) => {
        if (block.id !== id) return block
        if (block.startMinute === null) return block
        if (durationMinutes === null || durationMinutes <= 0) {
          return patchBlock(block, { endMinute: null, closed: false, manualEnd: false })
        }
        const endMinute = Math.min(block.startMinute + durationMinutes, 1439)
        return patchBlock(block, { endMinute, closed: true, manualEnd: true })
      }),
    }))
  }, [commitDay])

  const handleDeleteBlock = useCallback((id: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.filter((block) => block.id !== id),
    }))
    setExpandedId((current) => (current === id ? null : current))
  }, [commitDay, setExpandedId])

  const handleAbsorbGap = useCallback((id: string, direction: 'up' | 'down') => {
    commitDay((currentDay) => {
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return currentDay

      const current = timedBlocks[timedIndex]
      const neighbor = direction === 'up' ? timedBlocks[timedIndex - 1] : timedBlocks[timedIndex + 1]
      if (!neighbor || !current.block.closed || !neighbor.block.closed) return currentDay

      const updatedBlocks = replaceBlockById(currentDay.blocks, id, (block) => {
        const dirty = markBlockDirty(block)
        return direction === 'up'
          ? { ...dirty, startMinute: neighbor.endMinute }
          : { ...dirty, endMinute: neighbor.startMinute }
      })

      return { date: currentDay.date, blocks: updatedBlocks }
    })
  }, [commitDay, getCurrentMinute])

  const handleMerge = useCallback((id: string, direction: 'prev' | 'next') => {
    commitDay((currentDay) => {
      const timedBlocks = getTimedBlocks(currentDay.blocks, getCurrentMinute(currentDay.date))
      const timedIndex = timedBlocks.findIndex((item) => item.block.id === id)
      if (timedIndex === -1) return currentDay

      const current = timedBlocks[timedIndex]
      const neighbor = direction === 'prev' ? timedBlocks[timedIndex - 1] : timedBlocks[timedIndex + 1]
      if (!neighbor || !current.block.closed || !neighbor.block.closed) return currentDay

      const earlier = direction === 'prev' ? neighbor.block : current.block
      const later = direction === 'prev' ? current.block : neighbor.block
      const mergedId = earlier.id

      const mergedBlock: NotebookBlock = markBlockDirty({
        ...earlier,
        endMinute: later.endMinute,
        text: [earlier.text, later.text].filter(Boolean).join('\n'),
        summaryOverride: null,
        ticketId: earlier.ticketId || later.ticketId,
      })

      return {
        date: currentDay.date,
        blocks: currentDay.blocks
          .filter((block) => block.id !== current.block.id && block.id !== neighbor.block.id)
          .concat(mergedBlock)
          .sort((left, right) => {
            const leftStart = left.startMinute ?? Number.MAX_SAFE_INTEGER
            const rightStart = right.startMinute ?? Number.MAX_SAFE_INTEGER
            if (leftStart !== rightStart) return leftStart - rightStart
            return left.id.localeCompare(right.id)
          })
          .map((block) => (block.id === mergedId ? mergedBlock : block)),
      }
    })
    setExpandedId(null)
  }, [commitDay, getCurrentMinute, setExpandedId])

  const handleSummaryChange = useCallback((id: string, value: string) => {
    commitDay((currentDay) => ({
      date: currentDay.date,
      blocks: currentDay.blocks.map((block) =>
        block.id === id
          ? patchBlock(block, { summaryOverride: value.trim().length > 0 ? value : null })
          : block,
      ),
    }))
  }, [commitDay])

  // One-click close of a live entry ("logging now" pill): stamps the end at
  // the current minute and freezes the block. The text stays fully editable —
  // only timing is locked. End is clamped to at least start + one minute so an
  // instant close can't create an invalid zero-duration range.
  const handleCloseLiveBlock = useCallback((id: string) => {
    commitDay((currentDay) => {
      const nowMinute = getCurrentMinute(currentDay.date)
      return {
        date: currentDay.date,
        blocks: currentDay.blocks.map((block) =>
          block.id === id && !block.closed && block.startMinute !== null
            ? patchBlock(block, {
                closed: true,
                endMinute: Math.max(nowMinute, block.startMinute + MIN_BLOCK_DURATION_MINUTES),
                manualEnd: true,
              })
            : block,
        ),
      }
    })
  }, [commitDay, getCurrentMinute])

  // Creates a fully-timed entry from the trailing blank slot (double-click on
  // a blank timeline spot) and moves cursor focus to its notes field. The
  // entry lands closed with a manual end: the bounds are explicit, so typing
  // the description must not reopen or retiming it like a live entry.
  const handleCreateEntryAt = useCallback((startMinute: number, endMinute: number) => {
    const currentDay = dayRef.current
    if (!currentDay || currentDay.blocks.length === 0) return
    const blank = currentDay.blocks[currentDay.blocks.length - 1]
    if (blank.closed || blank.startMinute !== null || blank.text.trim().length > 0 || blank.ticketId.trim().length > 0) return

    const id = blank.id
    commitDay((dayState) => ({
      date: dayState.date,
      blocks: replaceBlockById(dayState.blocks, id, (block) =>
        patchBlock(block, { startMinute, endMinute, closed: true, manualEnd: true }),
      ),
    }))
    // Focus after the commit renders; the card keeps its id so the ref holds.
    window.setTimeout(() => textAreaRefs.current[id]?.focus(), 0)
  }, [commitDay, dayRef])

  const handleSuggest = useCallback(async (id: string) => {
    const currentDay = dayRef.current
    const block = currentDay?.blocks.find((candidate) => candidate.id === id)
    const notes = block?.text.trim() ?? ''
    if (!notes) return

    setSuggestingId(id)
    try {
      const suggestion = (await api.suggestSummary(notes)).trim()
      if (suggestion) handleSummaryChange(id, suggestion)
    } catch (cause) {
      onError('ai-suggest', (cause as Error).message)
    } finally {
      setSuggestingId(null)
    }
  }, [handleSummaryChange, onError])

  return {
    day,
    dayRef,
    setDay,
    loading,
    suggestingId,
    activeReopenableId,
    getTextAreaRef,
    commitDay,
    handleTextChange,
    handleTicketChange,
    handleTimeChange,
    handleDurationChange,
    handleSummaryChange,
    handleDeleteBlock,
    handleAbsorbGap,
    handleMerge,
    handleCloseLiveBlock,
    handleCreateEntryAt,
    handleSuggest,
  }
}
