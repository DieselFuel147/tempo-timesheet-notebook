import 'dotenv/config'

/** Secrets and connection settings, loaded from `.env`. */
export const config = {
  jira: {
    baseUrl: (process.env.JIRA_BASE_URL ?? '').replace(/\/+$/, ''),
    email: process.env.JIRA_EMAIL ?? '',
    apiToken: process.env.JIRA_API_TOKEN ?? '',
  },
  tempo: {
    baseUrl: (process.env.TEMPO_BASE_URL ?? 'https://api.tempo.io/4').replace(/\/+$/, ''),
    apiToken: process.env.TEMPO_API_TOKEN ?? '',
  },
  port: Number(process.env.PORT ?? 3000),
}

/** Throws a helpful error if any credential is missing. */
export function assertConfigured(): void {
  const missing: string[] = []
  if (!config.jira.baseUrl) missing.push('JIRA_BASE_URL')
  if (!config.jira.email) missing.push('JIRA_EMAIL')
  if (!config.jira.apiToken) missing.push('JIRA_API_TOKEN')
  if (!config.tempo.apiToken) missing.push('TEMPO_API_TOKEN')
  if (missing.length) {
    throw new Error(
      `Missing env vars: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`,
    )
  }
}
