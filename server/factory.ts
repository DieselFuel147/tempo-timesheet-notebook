import { config } from './config'
import { BasicTokenAuth, BearerTokenAuth } from './auth/tokenAuth'
import { JiraClient } from './jira/client'
import { TempoClient } from './tempo/client'

/** Wire up the API clients from config. Swap the Tempo auth here for OAuth later. */
export function buildClients() {
  const jira = new JiraClient(
    config.jira.baseUrl,
    new BasicTokenAuth(config.jira.email, config.jira.apiToken),
  )
  const tempo = new TempoClient(
    config.tempo.baseUrl,
    new BearerTokenAuth(config.tempo.apiToken),
  )
  return { jira, tempo }
}
