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

Requires:

- Node 22+
- Rust toolchain (`rustup`, `cargo`)

```bash
npm install
cp .env.example .env   # then fill in the values
```

You need two credentials (see `.env.example` for where to get them):

- **Jira** (email + Atlassian API token) — Tempo's API requires a *numeric*
  issue id, not the `REACT-1540` key, so we resolve keys via Jira. Also used for
  ticket autocomplete and your accountId.
- **Tempo** (API token) — to write the worklogs.

Current migration state:

- the Tauri desktop app is the primary runtime path
- the shared/frontend settings model and UI now include Jira/Tempo connection fields plus saved-token metadata
- the legacy Node/Fastify path still reads actual Jira/Tempo secrets from `.env`; it ignores in-app secret updates
- old repo-local SQLite data is not migrated; the native app starts with a fresh DB in the Tauri app-data directory

> Auth is still abstracted in the legacy Node path (`server/auth/`). The Rust/Tauri
> path will move to desktop-native settings and secret storage later; for now it
> still reads env vars for parity.

## Verify your credentials

```bash
npm run smoke                 # Jira /myself + Tempo token (writes nothing)
npm run smoke -- REACT-1540   # also resolves a real ticket key -> numeric id
```

## Run

### Preferred desktop workflow

```bash
npm run tauri:dev
```

This starts the React UI in a Tauri 2 shell and uses the native Rust core for:

- local SQLite persistence
- settings persistence
- validation before push
- Jira profile and ticket lookup
- Tempo dry run and push

The desktop app does not use the internal Fastify server as its main runtime path.

### Legacy web/server workflow

```bash
npm run dev     # Vite UI on :5173 (proxies /api to the Fastify backend on :3000)
```

Keep this only if you want to work on or compare against the old Node/Fastify path.

## Test And Verify

Frontend/shared checks:

```bash
npm run typecheck
npm test
npm run build
```

Native Rust/Tauri checks:

```bash
cd src-tauri
cargo check
cargo test
```

Desktop package build:

```bash
npm run tauri:build
```

Packaging, signing, and enterprise rollout constraints are documented in
[`PACKAGING.md`](./PACKAGING.md).

## Dry run (preview before sending)

Click **"Dry run — preview payload"** to resolve ticket ids and build the exact
requests that *would* be sent to Tempo. The preview includes method, URL,
headers, and body. Nothing is sent, and the auth token is redacted in the
output.

## Corporate networks (TLS interception)

If your network runs a TLS-inspecting proxy (Zscaler/Netskope-type), Node will
reject `api.tempo.io` with `SELF_SIGNED_CERT_IN_CHAIN` because it ships its own CA
bundle and ignores the system keychain. The npm scripts set `NODE_USE_SYSTEM_CA=1`
so Node trusts the same corporate root CA your OS/curl already trust. If your CA
isn't in the system store, point Node at it: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

For the Rust/Tauri desktop runtime, `NODE_USE_SYSTEM_CA=1` does not apply. The
native app uses the OS trust store directly, so a corporate TLS root CA must be
installed in the macOS or Windows system trust store.

## Layout

```
src-tauri/ Rust native core and Tauri shell
  src/core/   persistence, validation, push, Jira, Tempo, HTTP, settings
  src/commands/ thin Tauri command handlers
server/   Legacy Fastify backend kept only as a transitional/reference path
  auth/     AuthProvider abstraction (token now, OAuth-ready)
  jira/     resolve key -> id, /myself
  tempo/    create/read worklogs
src/      React front end (Vite)
shared/   Types shared by both
```
