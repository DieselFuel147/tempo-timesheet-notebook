import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import UploadIcon from '@mui/icons-material/Upload'
import SyncIcon from '@mui/icons-material/Sync'
import { Box, Button, IconButton, Stack, Typography, useTheme } from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { addDays, prettyDate, todayISO } from '@app/dateutil'

interface Props {
  date: string
  onChangeDate: (iso: string) => void
  /** True while any dry-run/push request is in flight; disables both buttons. */
  actionRunning: boolean
  dryRunRunning: boolean
  pushRunning: boolean
  pushBlocked: boolean
  pushableCount: number
  onDryRun: () => void
  onPushClick: () => void
}

// Date navigation plus the Tempo entry points (dry run / push).
export function DateToolbar({
  date,
  onChangeDate,
  actionRunning,
  dryRunRunning,
  pushRunning,
  pushBlocked,
  pushableCount,
  onDryRun,
  onPushClick,
}: Props) {
  const theme = useTheme()
  return (
    <Box
      sx={{
        px: { xs: 2, md: 3 },
        py: 1.5,
        bgcolor: theme.ledger.instructionBar,
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
          {prettyDate(date)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Notes are the source of truth. Time is inferred while you work, and the timeline mirrors the same blocks.
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <IconButton size="small" onClick={() => onChangeDate(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeftIcon />
        </IconButton>
        <DatePicker
          value={dayjs(date)}
          onChange={(newValue) => onChangeDate(newValue?.format('YYYY-MM-DD') || date)}
          format="DD/MM/YYYY"
          slots={{ openPickerIcon: CalendarMonthIcon }}
          slotProps={{ textField: { size: 'small', sx: { width: 200, bgcolor: 'background.paper', borderRadius: 1 } } }}
        />
        <IconButton size="small" onClick={() => onChangeDate(addDays(date, 1))} aria-label="Next day">
          <ChevronRightIcon />
        </IconButton>
        <IconButton size="small" onClick={() => onChangeDate(todayISO())} aria-label="Today">
          <TodayIcon fontSize="small" />
        </IconButton>
        <Button
          variant="outlined"
          size="small"
          startIcon={<PlayArrowIcon />}
          onClick={onDryRun}
          disabled={actionRunning || pushableCount === 0}
        >
          {dryRunRunning ? 'Running dry run…' : 'Dry run'}
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={pushRunning ? <SyncIcon /> : <UploadIcon />}
          onClick={onPushClick}
          disabled={actionRunning || pushBlocked}
        >
          {pushRunning ? 'Pushing…' : 'Push'}
        </Button>
      </Stack>
    </Box>
  )
}
