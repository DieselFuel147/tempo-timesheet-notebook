import { useEffect, useMemo, useRef, useState } from 'react'
import AutoStoriesIcon from '@mui/icons-material/AutoStories'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import type { ReactNode } from 'react'
import type { CalloutTone, GuideBlock, GuideSection, InlineSegment } from './guideModel'
import { parseUserGuide, searchGuide } from './guideModel'
import { USER_GUIDE_MARKDOWN } from './userGuideSource'

const CALLOUT_SEVERITY: Record<CalloutTone, 'success' | 'info' | 'warning'> = {
  tip: 'success',
  note: 'info',
  warning: 'warning',
}

interface Props {
  open: boolean
  /** Deep link: open the guide pre-scrolled to a section id (slug of its H2). */
  initialSectionId?: string | null
  onClose: () => void
}

export function GuideDialog({ open, initialSectionId, onClose }: Props) {
  const theme = useTheme()
  const doc = useMemo(() => parseUserGuide(USER_GUIDE_MARKDOWN), [])
  const [query, setQuery] = useState('')
  const [activeSectionId, setActiveSectionId] = useState<string>(() => doc.sections[0]?.id ?? '')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Section wrapper elements keyed by section id; offsets drive both the
  // deep-link jump and the scroll-spy highlight. The container is position:
  // relative so offsetTop is measured against it.
  const sectionElsRef = useRef(new Map<string, HTMLElement>())

  const jumpToSection = (sectionId: string) => {
    setActiveSectionId(sectionId)
    const container = scrollRef.current
    const el = sectionElsRef.current.get(sectionId)
    if (!container || !el) return
    container.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
  }

  // Reopening resets the rail and honours the requested deep-link target once
  // the dialog content has actually mounted (hence the frame delay).
  useEffect(() => {
    if (!open) return
    setQuery('')
    const target =
      initialSectionId && doc.sections.some((section) => section.id === initialSectionId)
        ? initialSectionId
        : (doc.sections[0]?.id ?? '')
    setActiveSectionId(target)
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current
      const el = sectionElsRef.current.get(target)
      if (!container) return
      if (!el) {
        container.scrollTop = 0
        return
      }
      container.scrollTop = Math.max(0, el.offsetTop - 12)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, initialSectionId])

  // Scroll-spy: last section whose top edge crossed the upper band is active.
  const handleContentScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const threshold = container.scrollTop + 96
    let current = doc.sections[0]?.id ?? ''
    for (const section of doc.sections) {
      const el = sectionElsRef.current.get(section.id)
      if (el && el.offsetTop <= threshold) current = section.id
    }
    setActiveSectionId(current)
  }

  const trimmedQuery = query.trim()
  const searchHits = useMemo(() => searchGuide(doc, trimmedQuery), [doc, trimmedQuery])

  const renderSegments = (segments: InlineSegment[]): ReactNode[] =>
    segments.map((segment, index) => {
      switch (segment.style) {
        case 'bold':
          return (
            <Box key={index} component="strong" sx={{ fontWeight: 600 }}>
              {segment.text}
            </Box>
          )
        case 'italic':
          return (
            <Box key={index} component="em">
              {segment.text}
            </Box>
          )
        case 'code':
          return (
            <Box
              key={index}
              component="code"
              sx={{
                fontFamily: theme.monoFont,
                fontSize: '0.85em',
                px: 0.5,
                borderRadius: 0.5,
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {segment.text}
            </Box>
          )
        default:
          return <span key={index}>{segment.text}</span>
      }
    })

  const renderBlock = (block: GuideBlock, key: number | string) => {
    switch (block.kind) {
      case 'paragraph':
        return (
          <Typography key={key} variant="body2" sx={{ mb: 1.25, lineHeight: 1.7 }}>
            {renderSegments(block.segments)}
          </Typography>
        )
      case 'heading':
        return (
          <Typography key={key} variant="subtitle1" sx={{ fontWeight: 600, mt: 2.5, mb: 0.75 }} id={`guide-anchor-${block.id}`}>
            {renderSegments(block.segments)}
          </Typography>
        )
      case 'bullets':
        return (
          <Box key={key} component="ul" sx={{ m: 0, pl: 3, mb: 1.5 }}>
            {block.items.map((item, itemIndex) => (
              <Box key={itemIndex} component="li" sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ lineHeight: 1.65 }} component="span">
                  {renderSegments(item)}
                </Typography>
              </Box>
            ))}
          </Box>
        )
      case 'callout':
        return (
          <Alert key={key} severity={CALLOUT_SEVERITY[block.tone]} sx={{ my: 1.5 }} variant="outlined">
            <Typography variant="body2">{renderSegments(block.segments)}</Typography>
          </Alert>
        )
      case 'table':
        return (
          <TableContainer key={key} sx={{ my: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, maxWidth: 640 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {block.header.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} sx={{ fontWeight: 600 }}>
                      {renderSegments(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {block.rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex}>{renderSegments(cell)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
    }
  }

  const renderSectionContent = (section: GuideSection) => (
    <Box
      key={section.id}
      ref={(el: HTMLElement | null) => {
        if (el) sectionElsRef.current.set(section.id, el)
        else sectionElsRef.current.delete(section.id)
      }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, mt: 3, mb: 1, '&:first-of-type': { mt: 1 } }}>
        {section.title}
      </Typography>
      {section.blocks.map((block, index) => renderBlock(block, index))}
    </Box>
  )

  return (
    <Dialog fullWidth maxWidth="lg" open={open} onClose={onClose} slotProps={{ paper: { sx: { height: '82vh' } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoStoriesIcon fontSize="small" />
        User guide
        <IconButton aria-label="Close user guide" onClick={onClose} size="small" sx={{ ml: 'auto' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0, display: 'flex', overflow: 'hidden' }}>
        <Box
          role="navigation"
          aria-label="Guide sections"
          sx={{
            width: 264,
            flexShrink: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            overflowY: 'auto',
            p: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <TextField
            size="small"
            placeholder="Search the guide"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          {trimmedQuery.length > 0 ? (
            searchHits.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No matches.
              </Typography>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                  {searchHits.length} matching section{searchHits.length === 1 ? '' : 's'}
                </Typography>
                <List disablePadding>
                  {searchHits.map((hit) => (
                    <ListItemButton
                      key={hit.sectionId}
                      onClick={() => jumpToSection(hit.sectionId)}
                      sx={{ borderRadius: 1 }}
                    >
                      <ListItemText
                        primary={hit.sectionTitle}
                        secondary={hit.snippet}
                        slotProps={{
                          primary: { variant: 'body2', sx: { fontWeight: 600 } },
                          secondary: {
                            variant: 'caption',
                            sx: {
                              display: '-webkit-box',
                              WebkitBoxOrient: 'vertical',
                              WebkitLineClamp: 2,
                              overflow: 'hidden',
                            },
                          },
                        }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </>
            )
          ) : (
            <List disablePadding>
              {doc.sections.map((section) => (
                <ListItemButton
                  key={section.id}
                  selected={activeSectionId === section.id}
                  onClick={() => jumpToSection(section.id)}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemText
                    primary={section.title}
                    secondary={section.summary || null}
                    slotProps={{
                      primary: { variant: 'body2', sx: { fontWeight: 600 } },
                      secondary: {
                        variant: 'caption',
                        sx: {
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          overflow: 'hidden',
                        },
                      },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <Box
          ref={scrollRef}
          onScroll={handleContentScroll}
          sx={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', px: 3.5, pb: 4 }}
        >
          {doc.title.length > 0 && (doc.preamble.length > 0 || doc.sections.length > 0) && (
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              {doc.title}
            </Typography>
          )}
          {/* Intro copy and callouts that sit above the first H2 in the markdown. */}
          {doc.preamble.map((block, index) => renderBlock(block, `preamble-${index}`))}
          {doc.sections.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              The guide file is empty - add sections to docs/user-guide.md.
            </Typography>
          ) : (
            doc.sections.map(renderSectionContent)
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
