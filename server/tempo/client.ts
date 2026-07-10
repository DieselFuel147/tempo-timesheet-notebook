import type { AuthProvider } from '../auth/types'
import type { WorklogInput } from '../../shared/types'
import { requestJson } from '../http'

/** Thin Tempo REST client (API v4). */
export class TempoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthProvider,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>({
      method,
      url: `${this.baseUrl}${path}`,
      headers: await this.auth.authHeaders(),
      body,
      label: `Tempo ${method} ${path}`,
    })
  }

  /** Read a page of worklogs — used by the smoke test to verify the token (writes nothing). */
  async listWorklogs(limit = 1): Promise<unknown> {
    return this.request('GET', `/worklogs?limit=${limit}`)
  }

  /** Create a single worklog. Returns Tempo's assigned worklog id. */
  async createWorklog(input: WorklogInput): Promise<{ tempoWorklogId: number }> {
    return this.request('POST', '/worklogs', input)
  }
}
