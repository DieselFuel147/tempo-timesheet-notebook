import AccessTimeIcon from '@mui/icons-material/AccessTime'
import SettingsIcon from '@mui/icons-material/Settings'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'
import { AppBar, Badge, Box, IconButton, Stack, Toolbar, Tooltip, Typography, useTheme } from '@mui/material'
import type { JiraProfile } from '@shared/types'
import { MONO_FONT } from '@app/theme'

function buildLegacyProfileLabel(profile: JiraProfile | null): string {
  return profile ? `${profile.displayName} · ${profile.timeZone}` : 'not connected to Jira'
}

interface Props {
  profile: JiraProfile | null
  clockLabel: string
  isLiveTyping: boolean
  updateVersion: string | null
  onOpenSettings: () => void
}

export function AppHeader({ profile, clockLabel, isLiveTyping, updateVersion, onOpenSettings }: Props) {
  const theme = useTheme()
  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: theme.ledger.barBg, color: theme.ledger.barText }}>
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
          <AccessTimeIcon />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" component="h1" sx={{ lineHeight: 1.15, fontWeight: 600 }} noWrap>
              Timesheet Notebook
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: theme.ledger.headerCaption, display: 'block' }} noWrap>
              {buildLegacyProfileLabel(profile)}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography
            variant="subtitle2"
            sx={{ fontFamily: MONO_FONT, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            aria-label="Current time"
          >
            {clockLabel}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: isLiveTyping ? 'secondary.main' : theme.ledger.headerCaption,
              }}
            />
            <Typography variant="caption" sx={{ fontFamily: MONO_FONT }}>
              {isLiveTyping ? 'logging' : 'idle'}
            </Typography>
          </Stack>
          {updateVersion && (
            <Tooltip title={`Version ${updateVersion} is available — open settings to install it`} arrow>
              <IconButton color="inherit" size="small" onClick={onOpenSettings} aria-label={`Update to version ${updateVersion} available`}>
                <Badge color="warning" variant="dot" overlap="circular">
                  <SystemUpdateAltIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
          )}
          <IconButton color="inherit" size="small" onClick={onOpenSettings} aria-label="Settings">
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Toolbar>
    </AppBar>
  )
}
