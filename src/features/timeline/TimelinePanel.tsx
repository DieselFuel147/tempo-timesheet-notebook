import { useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import ExpandIcon from '@mui/icons-material/Expand'
import LinkIcon from '@mui/icons-material/Link'
import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography, useTheme } from '@mui/material'
import type { NotebookBlock, TempoWorklog } from '@shared/types'
import { notebookBlockSummary } from '@shared/notebook'
import { formatHours } from '@app/dateutil'
import { DAY_MINUTES, getTimedBlocks } from '@app/features/notebook/blockModel'
import { toTempoWorklogViews } from '@app/features/sync/tempoViews'
import { MIN_BLOCK_PIXEL_FLOOR, PX_PER_MINUTE, RULER_GUTTER } from './constants'
import { MONO_FONT } from '@app/theme'

export interface TimelinePanelProps {
  blocks: NotebookBlock[]
  nowMinute: number
  expandedId: string | null
  tempoWorklogs: TempoWorklog[]
  localWorklogIds: Set<number>
  onToggleExpand: (id: string) => void
  onAbsorbGap: (id: string, direction: 'up' | 'down') => void
  onMerge: (id: string, direction: 'prev' | 'next') => void
  onPinPointerDown: (id: string, edge: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>) => void
  onBlockPointerDown: (id: string, event: ReactPointerEvent<HTMLDivElement>) => void
  onDeselect: () => void
}

// Width of the read-only lane on the ruler's right edge that shows worklogs
// already confirmed in Tempo, kept clear of the editable notebook blocks.
const TEMPO_LANE_WIDTH = 20

// Timeline blocks are sized purely by their start/end times, so their summary
// text must fit whatever room is left instead of stretching the block. These
// approximate the chrome around the summary (paper padding 2x8, the stacked
// time + ticket rows, and the stack gaps) to derive a safe line count; any
// rounding residue is absorbed by overflow clipping rather than growing the
// block.
const SUMMARY_LINE_HEIGHT_PX = 20
const TIMELINE_BLOCK_CHROME_PX = 64

export function TimelinePanel({
  blocks,
  nowMinute,
  expandedId,
  tempoWorklogs,
  localWorklogIds,
  onToggleExpand,
  onAbsorbGap,
  onMerge,
  onPinPointerDown,
  onBlockPointerDown,
  onDeselect,
}: TimelinePanelProps) {
  const theme = useTheme()
  const palette = theme.blockColors
  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const block of blocks) {
      if (block.startMinute === null) continue
      const ticketId = block.ticketId.trim()
      if (!ticketId) continue
      counts.set(ticketId, (counts.get(ticketId) ?? 0) + 1)
    }
    return counts
  }, [blocks])

  const ticketColors = useMemo(() => {
    const colors = new Map<string, string>()
    let nextColor = 0
    for (const block of blocks) {
      if (block.startMinute === null) continue
      const ticketId = block.ticketId.trim()
      if (!ticketId) continue
      if (!colors.has(ticketId)) {
        colors.set(ticketId, palette[nextColor % palette.length])
        nextColor += 1
      }
    }
    return colors
  }, [blocks, palette])

  const timedBlocks = useMemo(() => getTimedBlocks(blocks, nowMinute), [blocks, nowMinute])
  const tempoViews = useMemo(
    () => toTempoWorklogViews(tempoWorklogs, localWorklogIds),
    [tempoWorklogs, localWorklogIds],
  )
  const minVisibleMinute = useMemo(() => {
    const candidates = [nowMinute, ...timedBlocks.map((block) => block.startMinute), ...tempoViews.map((view) => view.startMinute)]
    const firstMinute = Math.min(...candidates)
    return Math.max(0, Math.floor((firstMinute - 30) / 60) * 60)
  }, [nowMinute, timedBlocks, tempoViews])

  const maxMinute = Math.min(
    DAY_MINUTES,
    Math.max(minVisibleMinute + 120, ...timedBlocks.map((block) => block.endMinute), ...tempoViews.map((view) => view.endMinute)),
  )
  const timelineHeight = Math.max(320, (maxMinute - minVisibleMinute) * PX_PER_MINUTE + 64)

  const ticketPositions = useMemo(() => {
    const positions = new Map<string, Array<{ top: number; bottom: number; color: string }>>()
    for (const timedBlock of timedBlocks) {
      const ticketId = timedBlock.block.ticketId.trim()
      if (!ticketId) continue
      const color = ticketColors.get(ticketId) ?? palette[0]
      const top = (timedBlock.startMinute - minVisibleMinute) * PX_PER_MINUTE + 16
      const bottom = (timedBlock.endMinute - minVisibleMinute) * PX_PER_MINUTE + 16
      const list = positions.get(ticketId) ?? []
      list.push({ top, bottom, color })
      positions.set(ticketId, list)
    }
    return positions
  }, [minVisibleMinute, ticketColors, timedBlocks])

  const connectors = useMemo(() => {
    const items: Array<{ id: string; top: number; height: number; color: string }> = []
    ticketPositions.forEach((positions, ticketId) => {
      for (let index = 0; index < positions.length - 1; index += 1) {
        const current = positions[index]
        const next = positions[index + 1]
        const height = Math.max(0, next.top - current.bottom)
        if (height <= 0) continue
        items.push({
          id: `${ticketId}-${index}`,
          top: current.bottom,
          height,
          color: current.color,
        })
      }
    })
    return items
  }, [ticketPositions])

  // Precomputed once so the hour label column and the tick-line column (which
  // live in two different positioning contexts, see below) stay in lockstep.
  const hourMarks = useMemo(() => {
    const marks: Array<{ minute: number; top: number }> = []
    const count = Math.ceil((maxMinute - minVisibleMinute) / 60) + 2
    for (let hourIndex = 0; hourIndex < count; hourIndex += 1) {
      const minute = minVisibleMinute + hourIndex * 60
      if (minute > Math.min(maxMinute + 60, DAY_MINUTES)) break
      marks.push({ minute, top: (minute - minVisibleMinute) * PX_PER_MINUTE + 16 })
    }
    return marks
  }, [maxMinute, minVisibleMinute])

  return (
    <Box onClick={onDeselect} sx={{ position: 'relative', minHeight: timelineHeight, pr: 1 }}>
      {/* Hour labels live in the left gutter, positioned directly against this
          outer box (no padding to fight with) so `left: 0` really means the
          gutter's own left edge. */}
      {hourMarks.map(({ minute, top }) => (
        <Typography
          key={`label-${minute}`}
          variant="caption"
          sx={{
            position: 'absolute',
            left: 0,
            top,
            transform: 'translateY(-50%)',
            width: RULER_GUTTER - 8,
            textAlign: 'right',
            color: 'text.secondary',
            fontFamily: MONO_FONT,
            fontSize: 10,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`}
        </Typography>
      ))}

      {/* Everything else (ticks, connectors, blocks) sits to the right of the
          label gutter via this margin-shifted positioning context. */}
      <Box sx={{ position: 'relative', ml: `${RULER_GUTTER}px` }}>
        {hourMarks.map(({ minute, top }) => (
          <Box key={`tick-${minute}`} sx={{ position: 'absolute', insetInline: 0, top }}>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
          </Box>
        ))}

        {connectors.map((connector) => (
          <Box
            key={connector.id}
            sx={{
              position: 'absolute',
              top: connector.top,
              left: 20,
              height: connector.height,
              borderLeft: `2px dashed ${connector.color}`,
              opacity: 0.55,
            }}
          />
        ))}

        {timedBlocks.map((timedBlock, index) => {
        const { block } = timedBlock
        const startMinute = timedBlock.startMinute
        const endMinute = timedBlock.endMinute
        const duration = Math.max(1, endMinute - startMinute)
        const height = Math.max(MIN_BLOCK_PIXEL_FLOOR, duration * PX_PER_MINUTE)
        const top = (startMinute - minVisibleMinute) * PX_PER_MINUTE + 16
        const ticketId = block.ticketId.trim()
        const color = ticketId ? ticketColors.get(ticketId) ?? palette[index % palette.length] : palette[index % palette.length]
        const ticketCount = ticketId ? ticketCounts.get(ticketId) ?? 0 : 0
        const summary = notebookBlockSummary(block)
        const expanded = expandedId === block.id
        // How many body2 lines fit under the time row without growing the block.
        const maxSummaryLines = Math.max(0, Math.floor((height - TIMELINE_BLOCK_CHROME_PX) / SUMMARY_LINE_HEIGHT_PX))
        const previous = timedBlocks[index - 1]
        const next = timedBlocks[index + 1]
        const gapAbove = previous ? Math.max(0, startMinute - previous.endMinute) : 0
        const gapBelow = next ? Math.max(0, next.startMinute - endMinute) : 0
        const showAbsorbUp = expanded && block.closed && gapAbove > 0
        const showAbsorbDown = expanded && block.closed && gapBelow > 0
        const canMergePrev = expanded && block.closed && !!previous?.block.closed
        const canMergeNext = expanded && block.closed && !!next?.block.closed

        return (
          <Box key={block.id} sx={{ position: 'absolute', top, left: 16, right: tempoViews.length > 0 ? TEMPO_LANE_WIDTH : 0 }}>
            {gapAbove > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: -gapAbove * PX_PER_MINUTE,
                  left: 4,
                  width: 8,
                  height: Math.max(6, gapAbove * PX_PER_MINUTE),
                  background: `repeating-linear-gradient(135deg, ${theme.ledger.gapStripe}, ${theme.ledger.gapStripe} 4px, transparent 4px, transparent 8px)`,
                  opacity: 0.8,
                  pointerEvents: 'none',
                }}
              />
            )}

            <Paper
              elevation={0}
              onPointerDown={(event) => onBlockPointerDown(block.id, event)}
              onClick={(event) => {
                event.stopPropagation()
                if (block.closed) onToggleExpand(block.id)
              }}
              sx={{
                position: 'relative',
                height,
                p: 1,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: color,
                color: '#F4F5EF',
                borderRadius: 1.5,
                cursor: block.closed ? 'grab' : 'default',
                touchAction: 'none',
                boxShadow: expanded
                  ? `0 0 0 2px ${theme.palette.text.primary}`
                  : '0 2px 5px rgba(0,0,0,0.18)',
              }}
            >
              {expanded && block.closed && (
                <>
                  <Box
                    onPointerDown={(event) => onPinPointerDown(block.id, 'start', event)}
                    onClick={(event) => event.stopPropagation()}
                    sx={{
                      position: 'absolute',
                      left: -7,
                      top: -7,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      border: `2px solid ${theme.ledger.pinBorder}`,
                      touchAction: 'none',
                      cursor: 'ns-resize',
                    }}
                  />
                  <Box
                    onPointerDown={(event) => onPinPointerDown(block.id, 'end', event)}
                    onClick={(event) => event.stopPropagation()}
                    sx={{
                      position: 'absolute',
                      left: -7,
                      bottom: -7,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      border: `2px solid ${theme.ledger.pinBorder}`,
                      touchAction: 'none',
                      cursor: 'ns-resize',
                    }}
                  />
                </>
              )}

              {showAbsorbUp && (
                <IconButton
                  size="small"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAbsorbGap(block.id, 'up')
                  }}
                  sx={{
                    position: 'absolute',
                    top: -16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <ExpandIcon fontSize="small" />
                </IconButton>
              )}

              {showAbsorbDown && (
                <IconButton
                  size="small"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAbsorbGap(block.id, 'down')
                  }}
                  sx={{
                    position: 'absolute',
                    bottom: -16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <ExpandIcon fontSize="small" />
                </IconButton>
              )}

              {canMergePrev && (
                <IconButton
                  size="small"
                  title="Merge with previous"
                  aria-label="Merge with previous"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onMerge(block.id, 'prev')
                  }}
                  sx={{
                    position: 'absolute',
                    top: -14,
                    right: -14,
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <LinkIcon fontSize="small" />
                </IconButton>
              )}

              {canMergeNext && (
                <IconButton
                  size="small"
                  title="Merge with next"
                  aria-label="Merge with next"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onMerge(block.id, 'next')
                  }}
                  sx={{
                    position: 'absolute',
                    bottom: -14,
                    right: -14,
                    bgcolor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                  }}
                >
                  <LinkIcon fontSize="small" />
                </IconButton>
              )}

              <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* Time and ticket sit side by side while the block is wide
                    enough; the non-wrapping time text wins and the chip wraps
                    below it as the block narrows (the panel is user-resizable,
                    so this adapts continuously without breakpoints). */}
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: MONO_FONT, fontSize: 10, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}
                  >
                    {`${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')} - ${
                      block.closed
                        ? `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`
                        : 'now'
                    }  ·  ${formatHours(block.closed ? endMinute - startMinute : nowMinute - startMinute)}`}
                  </Typography>
                  {ticketId && (
                    <Chip
                      size="small"
                      label={ticketCount > 1 ? `${ticketId} · ${ticketCount}` : ticketId}
                      sx={{ bgcolor: theme.ledger.ticketBadgeBg, color: '#fff', fontFamily: MONO_FONT, fontWeight: 600 }}
                    />
                  )}
                </Stack>

                {maxSummaryLines > 0 && (
                  <Typography
                    variant="body2"
                    title={summary}
                    sx={{
                      fontWeight: 600,
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: maxSummaryLines,
                    }}
                  >
                    {summary}
                  </Typography>
                )}
              </Stack>
            </Paper>
          </Box>
        )
      })}

        {/* Read-only lane: worklogs already confirmed in Tempo for this day.
            Kept in its own right-edge column so it never collides with the
            editable notebook blocks. */}
        {tempoViews.map((view) => {
          const top = (view.startMinute - minVisibleMinute) * PX_PER_MINUTE + 16
          const height = Math.max(MIN_BLOCK_PIXEL_FLOOR, (view.endMinute - view.startMinute) * PX_PER_MINUTE)
          const startLabel = `${String(Math.floor(view.startMinute / 60)).padStart(2, '0')}:${String(view.startMinute % 60).padStart(2, '0')}`
          const endLabel = `${String(Math.floor(view.endMinute / 60)).padStart(2, '0')}:${String(view.endMinute % 60).padStart(2, '0')}`
          const durationLabel = formatHours(view.endMinute - view.startMinute)
          const tooltip = `${view.issueKey} · ${startLabel}–${endLabel} · ${durationLabel}${
            view.description ? ` · ${view.description}` : ''
          }${view.inNotebook ? ' · in notebook' : ''}`
          return (
            <Tooltip key={`tempo-${view.tempoWorklogId}`} title={tooltip} placement="left" arrow>
              <Box
                aria-label={tooltip}
                sx={{
                  position: 'absolute',
                  top,
                  right: 0,
                  width: TEMPO_LANE_WIDTH - 6,
                  minHeight: height,
                  borderRadius: 0.75,
                  border: '1px solid',
                  borderColor: view.inNotebook ? 'success.main' : 'text.secondary',
                  bgcolor: view.inNotebook ? 'success.main' : 'transparent',
                  opacity: view.inNotebook ? 0.55 : 0.9,
                  backgroundImage: view.inNotebook
                    ? undefined
                    : `repeating-linear-gradient(135deg, ${theme.ledger.gapStripe}, ${theme.ledger.gapStripe} 3px, transparent 3px, transparent 6px)`,
                }}
              />
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}
