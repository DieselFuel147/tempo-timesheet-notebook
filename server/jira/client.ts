import type { AuthProvider } from '../auth/types'
import type { JiraProfile, JiraIssueRef } from '../../shared/types'
import { requestJson } from '../http'

/** Thin Jira Cloud REST client — only the calls this tool needs. */
export class JiraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthProvider,
  ) {}

  private async get<T>(path: string): Promise<T> {
    return requestJson<T>({
      method: 'GET',
      url: `${this.baseUrl}${path}`,
      headers: await this.auth.authHeaders(),
      label: `Jira GET ${path}`,
    })
  }

  /** The authenticated user — source of the accountId Tempo worklogs require. */
  async myself(): Promise<JiraProfile> {
    const d = await this.get<Record<string, unknown>>('/rest/api/3/myself')
    return {
      accountId: String(d.accountId),
      displayName: String(d.displayName ?? ''),
      emailAddress: d.emailAddress ? String(d.emailAddress) : undefined,
      timeZone: String(d.timeZone ?? ''),
    }
  }

  /** Resolve a ticket key (REACT-1540) to the numeric id Tempo needs. */
  async resolveIssue(key: string): Promise<JiraIssueRef> {
    const d = await this.get<{ id: string | number; key: string; fields?: { summary?: string } }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`,
    )
    return { id: String(d.id), key: d.key, summary: d.fields?.summary ?? '' }
  }
}
