import { Alert, Button, Stack, TextField, Typography, Box, Paper } from '@mui/material'
import type { DraftState } from '../settingsDraft'
import type { Settings } from '@shared/settings'

interface Props {
  draft: DraftState
  settings: Settings
  /** Merges a partial draft patch into the form state. */
  onChange: (patch: Partial<DraftState>) => void
}

interface TokenRowProps {
  label: string
  value: string
  helperText: string
  onChange: (value: string) => void
  onClear: () => void
}

/** Password field + "clear saved token" action shared by both providers. */
function TokenRow({ label, value, helperText, onChange, onClear }: TokenRowProps) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}>
      <TextField
        label={label}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        fullWidth
        helperText={helperText}
      />
      <Button
        type="button"
        variant="outlined"
        onClick={onClear}
        sx={{ minWidth: { sm: 140 } }}
      >
        Clear saved token
      </Button>
    </Stack>
  )
}

export function ConnectionsSection({ draft, settings, onChange }: Props) {
  function tokenHelper(cleared: boolean, saved: boolean): string {
    if (cleared) return 'Will be cleared on save.'
    return saved ? 'Saved in app storage. Enter a new value to replace it.' : 'Not saved yet.'
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        Jira and Tempo
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage the connection details the app uses for profile lookup, ticket search, and Tempo pushes.
      </Typography>

      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <TextField
          label="Jira base URL"
          value={draft.jiraBaseUrl}
          onChange={(e) => onChange({ jiraBaseUrl: e.target.value })}
          placeholder="https://your-company.atlassian.net"
          helperText="Atlassian site root; trailing slash removed automatically on save."
        />

        <TextField
          label="Jira email"
          value={draft.jiraEmail}
          onChange={(e) => onChange({ jiraEmail: e.target.value })}
          placeholder="name@company.com"
        />

        <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0.75 }}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
            Which Jira token &amp; permissions
          </Typography>
          <Typography variant="caption" component="div" color="text.secondary">
            Create a plain (unscoped) token at{' '}
            <Box component="code" sx={{ fontFamily: 'monospace' }}>
              id.atlassian.com/manage-profile/security/api-tokens
            </Box>{' '}
            using <strong>Create API token</strong> - not the “with scopes” option, which the app
            can’t use yet. The app signs in as you and only <strong>reads</strong>: your profile,
            issue summaries, and ticket search. It never writes to Jira, so the account only needs{' '}
            <strong>Browse&nbsp;Projects</strong> permission on the projects you log against - no
            admin, edit, or worklog permissions.
          </Typography>
        </Alert>

        <TokenRow
          label="Jira API token"
          value={draft.jiraApiToken}
          helperText={tokenHelper(draft.clearJiraApiToken, settings.connections.jira.apiTokenSaved)}
          onChange={(jiraApiToken) => onChange({ jiraApiToken, clearJiraApiToken: false })}
          onClear={() => onChange({ clearJiraApiToken: true, jiraApiToken: '' })}
        />

        <TextField
          label="Tempo base URL"
          value={draft.tempoBaseUrl}
          onChange={(e) => onChange({ tempoBaseUrl: e.target.value })}
          placeholder="https://api.tempo.io/4"
          helperText="API root used for dry run and push requests."
        />

        <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0.75 }}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
            Which Tempo scopes
          </Typography>
          <Typography variant="caption" component="div" color="text.secondary">
            Create the token under <strong>Tempo → Settings → DATA ACCESS → API integration → New Token → Custom Access</strong> and grant
            only <strong>Worklogs Scope&nbsp;· View and Manage</strong>. Leave every other scope off - Accounts,
            Activities, Approvals, Audit, papertrail, Periods, Plans, Projects, Schemes, Teams. The
            app only creates and reads worklogs; it never reads or manages anything else in Tempo.
          </Typography>
        </Alert>

        <TokenRow
          label="Tempo API token"
          value={draft.tempoApiToken}
          helperText={tokenHelper(draft.clearTempoApiToken, settings.connections.tempo.apiTokenSaved)}
          onChange={(tempoApiToken) => onChange({ tempoApiToken, clearTempoApiToken: false })}
          onClear={() => onChange({ clearTempoApiToken: true, tempoApiToken: '' })}
        />
      </Stack>
    </Paper>
  )
}
