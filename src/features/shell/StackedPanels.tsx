import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { Box, ButtonBase, Typography, useTheme } from '@mui/material'
import type { ReactNode } from 'react'

export type StackedPanel = 'notebook' | 'timeline'

interface Props {
  active: StackedPanel
  onChange: (panel: StackedPanel) => void
  notebook: ReactNode
  timeline: ReactNode
}

// Narrow-window layout (below the md breakpoint): the notebook and timeline
// can't share the width without becoming unreadable, so exactly one shows at
// a time. The collapsed panel stays reachable as a slim header — expanding it
// collapses the other.
export function StackedPanels({ active, onChange, notebook, timeline }: Props) {
  const theme = useTheme()

  const renderHeader = (panel: StackedPanel, label: string) => {
    const isActive = active === panel
    return (
      <ButtonBase
        onClick={() => onChange(panel)}
        aria-expanded={isActive}
        sx={{
          display: 'flex',
          width: '100%',
          px: 2,
          py: 1,
          gap: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: isActive ? theme.ledger.instructionBar : 'transparent',
          color: isActive ? 'text.primary' : 'text.secondary',
          transition: 'background-color 150ms',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {isActive ? <KeyboardArrowUpIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ButtonBase>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {renderHeader('notebook', 'Notebook')}
      {active === 'notebook' && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{notebook}</Box>
      )}
      {renderHeader('timeline', 'Timeline')}
      {active === 'timeline' && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{timeline}</Box>
      )}
    </Box>
  )
}
