import { Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { Appearance } from '@app/appearance'

interface Props {
  appearance: Appearance
  onAppearanceChange: (value: Appearance) => void
}

export function AppearanceSection({ appearance, onAppearanceChange }: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        Appearance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Applies immediately on this device. It is not affected by Save settings below.
      </Typography>
      <ToggleButtonGroup
        exclusive
        value={appearance}
        onChange={(_event, next: Appearance | null) => {
          if (next !== null) onAppearanceChange(next)
        }}
        aria-label="Appearance"
      >
        <ToggleButton value="auto" aria-label="Auto">Auto</ToggleButton>
        <ToggleButton value="light" aria-label="Light">Light</ToggleButton>
        <ToggleButton value="dark" aria-label="Dark">Dark</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Auto follows your system setting.
      </Typography>
    </Paper>
  )
}
