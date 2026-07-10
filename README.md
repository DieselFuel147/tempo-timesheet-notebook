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

## Layout

```
server/   Fastify backend — holds credentials, talks to Jira + Tempo
  auth/     AuthProvider abstraction (token now, OAuth-ready)
  jira/     resolve key -> id, /myself
  tempo/    create/read worklogs
src/      React front end (Vite)
shared/   Types shared by both
```
