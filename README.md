# Tempo Timesheet Tool

Structured, day-at-a-glance time logging that pushes cleanly to
[Tempo](https://apidocs.tempo.io/) via its API. You capture the four things a
worklog needs — start/end, ticket, and a one-line summary — in a notepad-style
day view, keep freeform notes alongside (never sent), get warned about odd
entries, then push the day to Tempo.

## Why not log in Tempo directly

Tempo's own UI is slow, and it doesn't let you keep your running notes and your
loggable time in one place. This keeps the notepad feel but constrains entry
enough that nothing has to be re-interpreted before it goes to Tempo.

## Setup

Requires Node 22+.

```bash
npm install
cp .env.example .env   # then fill in the values
```

You need two credentials (see `.env.example` for where to get them):

- **Jira** (email + Atlassian API token) — Tempo's API requires a *numeric*
  issue id, not the `REACT-1540` key, so we resolve keys via Jira. Also used for
  ticket autocomplete and your accountId.
- **Tempo** (API token) — to write the worklogs.

> Auth is abstracted behind an `AuthProvider` interface (`server/auth/`), so the
> Tempo token can be swapped for OAuth 2.0 later without touching the rest.

## Verify your credentials

```bash
npm run smoke                 # Jira /myself + Tempo token (writes nothing)
npm run smoke -- REACT-1540   # also resolves a real ticket key -> numeric id
```

## Run

```bash
npm run dev     # Vite UI on :5173 (proxies /api to the Fastify backend on :3000)
```

## Tauri Wave 0 scaffold

Requires the Rust toolchain in addition to Node 22+.

```bash
npm run tauri:dev
```

Current Wave 0 behavior:

- launches the existing React/Vite UI inside a Tauri 2 shell
- uses native `invoke` commands instead of the Fastify server when running in Tauri
- keeps capabilities conservative (`core:default` only)
- does not start a permanent Node sidecar
- exposes only scaffold-level native commands today; day data and settings are in-memory placeholders until the Rust persistence work lands

For the legacy web/server workflow, continue using `npm run dev`.

## Dry run (preview before sending)

Click **"Dry run — preview payload"** (or `POST /api/day/<date>/push?dryRun=true`) to
resolve ticket ids and build the exact requests that *would* be sent to Tempo —
method, URL, headers, and body — shown in the UI and printed to the server
console. Nothing is sent, and the auth token is redacted in the output.

## Corporate networks (TLS interception)

If your network runs a TLS-inspecting proxy (Zscaler/Netskope-type), Node will
reject `api.tempo.io` with `SELF_SIGNED_CERT_IN_CHAIN` because it ships its own CA
bundle and ignores the system keychain. The npm scripts set `NODE_USE_SYSTEM_CA=1`
so Node trusts the same corporate root CA your OS/curl already trust. If your CA
isn't in the system store, point Node at it: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Layout

```
server/   Fastify backend — holds credentials, talks to Jira + Tempo
  auth/     AuthProvider abstraction (token now, OAuth-ready)
  jira/     resolve key -> id, /myself
  tempo/    create/read worklogs
src/      React front end (Vite)
shared/   Types shared by both
```
