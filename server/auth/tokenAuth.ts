import type { AuthProvider } from './types'

/** Bearer-token auth — used for Tempo. */
export class BearerTokenAuth implements AuthProvider {
  constructor(private readonly token: string) {}
  async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.token}` }
  }
}

/** HTTP Basic auth with email + API token — used for Jira Cloud. */
export class BasicTokenAuth implements AuthProvider {
  constructor(
    private readonly email: string,
    private readonly token: string,
  ) {}
  async authHeaders(): Promise<Record<string, string>> {
    const encoded = Buffer.from(`${this.email}:${this.token}`).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }
}
