import { FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type { NotificationSettings } from '@shared/settings'
import { ensureNotificationPermission } from '@app/features/notifications/permission'

interface Props {
  notifications: NotificationSettings
  onChange: (patch: Partial<NotificationSettings>) => void
}

export function NotificationsSection({ notifications, onChange }: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        Reminders
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Get a macOS notification when your time entries have gone stale. Reminders only fire during
        Normal hours on weekdays (see Validation thresholds).
      </Typography>

      <Stack spacing={1.5}>
        <FormControlLabel
          control={
            <Switch
              checked={notifications.inactivityEnabled}
              onChange={(e) => {
                onChange({ inactivityEnabled: e.target.checked })
                // Ask for macOS consent in the same gesture as enabling — if we
                // waited until first fire, the dialog would appear while the app
                // is unfocused (the exact moment it's easy to miss).
                if (e.target.checked) void ensureNotificationPermission()
              }}
            />
          }
          label="Remind me to update my time entries"
        />

        <TextField
          label="Idle time before reminding (minutes)"
          type="number"
          slotProps={{ htmlInput: { min: 1, max: 1440 } }}
          value={notifications.inactivityThresholdMinutes}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.valueAsNumber
            onChange({
              inactivityThresholdMinutes: Number.isNaN(v)
                ? notifications.inactivityThresholdMinutes
                : Math.max(1, Math.floor(v)),
            })
          }}
          helperText="First reminder after this much app inactivity; repeats at the same interval while idle."
        />
      </Stack>
    </Paper>
  )
}
