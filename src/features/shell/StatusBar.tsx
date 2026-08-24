import { Box, Stack, Typography, useTheme } from '@mui/material'
import { formatHours } from '@app/dateutil'
import { MONO_FONT } from '@app/theme'

interface Props {
  trackedCount: number
  ticketCount: number
  unsyncedCount: number
  syncedCount: number
  /** Total tracked minutes for the day (already includes live blocks). */
  totalMinutes: number
  /** Total tracked minutes for the selected day's week (Mon-Sun), including live blocks. */
  weekTotalMinutes: number
  errorCount: number
  warningCount: number
  aiEnabled: boolean
  aiRunning: boolean
}

// Footer strip with the day's running totals. Scrolls horizontally when the
// window is too narrow instead of wrapping or squeezing, so every stat stays
// reachable.
export function StatusBar({
  trackedCount,
  ticketCount,
  unsyncedCount,
  syncedCount,
  totalMinutes,
  weekTotalMinutes,
  errorCount,
  warningCount,
  aiEnabled,
  aiRunning,
}: Props) {
  const theme = useTheme()
  return (
    <Box sx={{ mt: 'auto', bgcolor: theme.ledger.barBg, color: theme.ledger.barText, overflowX: 'auto' }}>
      <Stack
        direction="row"
        useFlexGap
        spacing={2}
        sx={{ px: { xs: 2, md: 3 }, py: 1.5, minWidth: 'max-content', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Stack direction="row" useFlexGap spacing={2.5} sx={{ flexShrink: 0 }}>
          {[
            `blocks · ${trackedCount}`,
            `tickets · ${ticketCount}`,
            `ready · ${unsyncedCount}`,
            `synced · ${syncedCount}`,
            `tracked · ${formatHours(Math.round(totalMinutes))}`,
            `week · ${formatHours(Math.round(weekTotalMinutes))}`,
            `errors · ${errorCount}`,
            `warnings · ${warningCount}`,
          ].map((stat) => (
            <Typography key={stat} variant="caption" sx={{ fontFamily: MONO_FONT, whiteSpace: 'nowrap' }}>
              {stat}
            </Typography>
          ))}
          {aiEnabled && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: aiRunning ? 'secondary.main' : theme.ledger.headerCaption,
                }}
              />
              <Typography variant="caption" sx={{ fontFamily: MONO_FONT, whiteSpace: 'nowrap' }}>
                {`ai · ${aiRunning ? 'loaded' : 'unloaded'}`}
              </Typography>
            </Stack>
          )}
        </Stack>
        <Typography variant="caption" sx={{ fontFamily: MONO_FONT, opacity: 0.75, whiteSpace: 'nowrap' }}>
          tap block · pins + merge
        </Typography>
      </Stack>
    </Box>
  )
}
