/**
 * Auth is abstracted behind this interface so the Tempo bearer-token provider
 * can be swapped for an OAuth 2.0 provider later without touching the API
 * clients that consume it.
 */
export interface AuthProvider {
  /** Headers to attach to an outbound request (e.g. an Authorization header). */
  authHeaders(): Promise<Record<string, string>>
}
