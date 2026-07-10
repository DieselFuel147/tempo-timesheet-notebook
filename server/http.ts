// Shared JSON HTTP helper for the Jira and Tempo clients.
//
// Corporate networks can be slow or flaky on the first connection to a new
// host (the smoke test saw a ~5s cold connect and an intermittent
// UND_ERR_CONNECT_TIMEOUT to api.tempo.io). So every request gets a per-attempt
// timeout and retries on transient connection/gateway failures, and errors
// surface the underlying cause instead of a bare "fetch failed".

const RETRYABLE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND', // transient DNS
])

const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

export interface HttpError extends Error {
  status?: number
  body?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface JsonRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
  /** Per-attempt timeout. Default 15s — generous enough for a slow cold connect. */
  timeoutMs?: number
  /** Total attempts including the first. Default 3. */
  retries?: number
  /** Human label for error messages, e.g. "Tempo POST /worklogs". */
  label?: string
}

export async function requestJson<T>(req: JsonRequest): Promise<T> {
  const { method, url, headers = {}, body, timeoutMs = 15000, retries = 3, label } = req
  const tag = label ?? `${method} ${url}`

  const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers }
  const hasBody = body !== undefined
  if (hasBody) finalHeaders['Content-Type'] = 'application/json'

  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: finalHeaders,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err: HttpError = new Error(`${tag} -> ${res.status} ${res.statusText}: ${text.slice(0, 300)}`)
        err.status = res.status
        err.body = text
        if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
          lastErr = err
          await sleep(attempt * 500)
          continue
        }
        throw err
      }

      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    } catch (err) {
      lastErr = err
      // A formatted HTTP error we already decided not to retry — pass it through.
      if ((err as HttpError)?.status) throw err

      const name = (err as { name?: string })?.name
      const code = (err as { cause?: { code?: string } })?.cause?.code
      const retryable = name === 'TimeoutError' || (code ? RETRYABLE_CODES.has(code) : false)
      if (retryable && attempt < retries) {
        await sleep(attempt * 500)
        continue
      }

      const detail = code ?? name ?? (err as Error)?.message ?? String(err)
      throw new Error(`${tag} -> connection failed after ${attempt} attempt(s): ${detail}`)
    }
  }
  throw lastErr
}
