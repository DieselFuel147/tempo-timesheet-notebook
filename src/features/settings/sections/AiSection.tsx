import { Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { DEFAULT_AI_SYSTEM_PROMPT, type AiSettings } from '@shared/settings'

interface Props {
  ai: AiSettings
  onChange: (patch: Partial<AiSettings>) => void
}

export function AiSection({ ai, onChange }: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        AI (local summaries)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Runs a local, on-device model to draft a worklog description from a block's notes when you
        press Suggest. Nothing leaves your machine. Requires a llama.cpp <code>llama-server</code>
        {' '}binary and a GGUF model file (Gemma-3-1b recommended).
      </Typography>

      <Stack spacing={1.5}>
        <FormControlLabel
          control={
            <Switch
              checked={ai.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
          }
          label="Enable local AI summaries"
        />

        <TextField
          label="llama-server binary path"
          value={ai.binaryPath}
          onChange={(e) => onChange({ binaryPath: e.target.value })}
          placeholder="/opt/homebrew/bin/llama-server"
          helperText="Absolute path to the llama.cpp server executable."
        />

        <TextField
          label="Model file path (GGUF)"
          value={ai.modelPath}
          onChange={(e) => onChange({ modelPath: e.target.value })}
          placeholder="/path/to/gemma-3-1b-it-Q4_K_M.gguf"
          helperText="Absolute path to the GGUF model file."
        />

        <TextField
          label="Idle shutdown (seconds)"
          type="number"
          slotProps={{ htmlInput: { min: 0 } }}
          value={ai.idleTimeoutSecs}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.valueAsNumber
            onChange({ idleTimeoutSecs: Number.isNaN(v) ? 0 : Math.max(0, Math.floor(v)) })
          }}
          helperText="The model process is stopped after this long with no requests."
        />

        <TextField
          label="System prompt"
          value={ai.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          multiline
          minRows={4}
          helperText="Instructions sent to the model on every Suggest. Tweak to taste; leave blank to use the built-in default."
        />
        <Box>
          <Button
            type="button"
            size="small"
            variant="text"
            disabled={ai.systemPrompt === DEFAULT_AI_SYSTEM_PROMPT}
            onClick={() => onChange({ systemPrompt: DEFAULT_AI_SYSTEM_PROMPT })}
          >
            Reset prompt to default
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}
