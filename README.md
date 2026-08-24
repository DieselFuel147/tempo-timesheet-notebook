# Tempo Timesheet Tool

Structured, day-at-a-glance time logging that pushes cleanly to
[Tempo](https://apidocs.tempo.io/) via its API. You capture the four things a
worklog needs — start/end, ticket, and a one-line summary — in a notepad-style
day view, keep freeform notes alongside (never sent), get warned about odd
entries, then push the day to Tempo.

It is a local-first **desktop app**: a React UI in a Tauri 2 shell, backed by a
native Rust core. There is no server to run and no cloud component.

## Why not log in Tempo directly

Tempo's own UI is slow, and it doesn't let you keep your running notes and your
loggable time in one place. This keeps the notepad feel but constrains entry
enough that nothing has to be re-interpreted before it goes to Tempo.

## Install

Currently only packaged for mac silicon.

Download latest .dmg from releases page > open and drag installer to Applications folder.

While this is still in development you will need to remove quarantine flag via terminal to run it (only need to do this once)

`xattr -cr "/Applications/Tempo Timesheet Tool.app"` 

You can then open the app normally.

To setup the Jira and Tempo sync, open settings and follow the instructions for configuring the API keys.

You can also configure a local AI model for summarising long ticket notes into shorter descriptions for the tempo entry.

## Dev setup

Requires:

- Node 22+ (to build the React UI)
- Rust toolchain (`rustup`, `cargo`)

```bash
npm install
```

You need two credentials, entered in the app's **Settings** screen (not in any
file). They are stored in the OS keychain via the native secret store.

- **Jira** (email + Atlassian API token) — Tempo's API requires a *numeric*
  issue id, not the `REACT-1540` key, so we resolve keys via Jira. Also used for
  ticket autocomplete and your accountId.
- **Tempo** (API token) — to write the worklogs.

## Run

```bash
npm run tauri:dev
```

This starts the React UI in a Tauri 2 shell and uses the native Rust core for:

- local SQLite persistence (in the Tauri app-data directory)
- settings and secret persistence (OS keychain)
- validation before push
- Jira profile and ticket lookup
- Tempo dry run and push

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

Versioning is automatic and runs when a branch is merged to main. Semantic versioning used and based on label assigned to PR, one will be suggested from PR title but can be manually set.

Once a PR is successfully merged a release will be automatically built and published.

Packaging, signing, and enterprise rollout constraints are documented in
[`PACKAGING.md`](./PACKAGING.md).

## Dry run (preview before sending)

Click **"Dry run — preview payload"** to resolve ticket ids and build the exact
requests that *would* be sent to Tempo. The preview includes method, URL,
headers, and body. Nothing is sent, and the auth token is redacted in the
output.

## Corporate networks (TLS interception)

If your network runs a TLS-inspecting proxy (Zscaler/Netskope-type), requests to
`api.tempo.io` can fail with a self-signed-certificate error. The native app
uses the OS trust store directly, so a corporate TLS root CA must be installed
in the macOS or Windows system trust store for the app to trust the proxy.

## Layout

```
src-tauri/ Rust native core and Tauri shell
  src/core/     persistence, validation, push, Jira, Tempo, HTTP client, settings, AI
  src/commands/ thin Tauri command handlers
src/       React front end (Vite); talks to the core via Tauri commands
shared/    TypeScript types, settings/validation logic, and Tauri command contracts
```
