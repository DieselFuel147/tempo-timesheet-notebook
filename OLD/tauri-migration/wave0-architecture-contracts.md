# Wave 0 Tauri Architecture and Contracts

## Purpose

This document defines the parity-focused Tauri-native architecture and the explicit frontend/native command contracts for Wave 0.

Wave 0 means:

- keep the current product behavior stable while replacing internal HTTP with Tauri IPC
- do not keep Fastify or a permanent Node sidecar in the long-term runtime path
- do not mix in the deferred notes-first redesign
- do not pull AI infrastructure into the baseline command set yet

The matching typed contract definitions live in `shared/tauri-contracts.ts`.

## Scope Freeze For Wave 0

Wave 0 preserves the current app model:

- day-oriented editing
- freeform notes stored locally only
- entry create/update/delete
- live frontend validation from pure TypeScript rules
- native revalidation before push
- Jira profile lookup
- Jira ticket search and resolution during push
- Tempo dry run preview
- Tempo push with idempotent skip behavior for already-synced entries
- settings persistence for validation thresholds
- issue-id cache usage during push

Wave 0 explicitly defers:

- notes-first redesign
- inferred entries or timeline capture
- cloud or remote AI features
- permanent background summarization runtime
- preserving REST or Fastify as a supported runtime mode

## Target Module Boundaries

### Frontend-safe TypeScript

These modules may run in the browser/WebView and must not require secrets, filesystem access, direct DB access, or direct Jira/Tempo access:

- `src/App.tsx`, `src/EntryRow.tsx`, `src/Settings.tsx`, `src/TicketField.tsx`
- `src/api/desktopApi.ts` or a minimal replacement for `src/api.ts`
- `shared/types.ts`
- `shared/settings.ts`
- `shared/validation.ts`
- `shared/worklog.ts` only if kept strictly pure and used for parity tests, not for privileged transport
- `shared/tauri-contracts.ts`

Frontend rules:

- no direct SQLite access
- no credentials in frontend state beyond ephemeral form input
- no direct Jira/Tempo HTTP calls
- all privileged behavior goes through typed Tauri commands

### Native Privileged Rust

These modules own local persistence, secrets, remote integrations, and orchestration:

- `src-tauri/src/commands/*`: thin Tauri command wrappers only
- `src-tauri/src/core/db/*`: SQLite schema, migrations, repository
- `src-tauri/src/core/settings/*`: settings load/save/default merge behavior
- `src-tauri/src/core/auth/*`: secrets and auth header assembly
- `src-tauri/src/core/jira/*`: profile lookup, issue resolution, ticket search
- `src-tauri/src/core/tempo/*`: worklog creation and dry-run preview shaping
- `src-tauri/src/core/push/*`: push orchestration, issue cache, idempotency, validation gate
- `src-tauri/src/state.rs`: shared application state and service handles
- `src-tauri/src/error.rs`: serialized native error model exposed to the frontend

Native rules:

- command handlers should parse input, call one core service, and serialize typed output
- business logic belongs in `core`, not inside command handlers
- native side revalidates before push even if the UI already validated locally
- native side owns all secrets, filesystem paths, HTTP clients, retries, and redaction

## Command Set

Wave 0 command set version: `wave0`

Canonical command names are defined in `shared/tauri-contracts.ts` as snake_case strings intended to map directly to Tauri command handlers.

### Commands

| Command | Input | Success output | Source behavior to preserve |
| --- | --- | --- | --- |
| `health_check` | `{}` | `HealthStatus` | Basic shell/invoke wiring check replacing `/api/health` |
| `get_profile` | `{}` | `JiraProfile` | Same behavior as `/api/profile`; configuration/auth failures surface as command errors |
| `get_day` | `{ date }` | `Day` | Same behavior as `/api/day/:date`; empty day returns `{ date, notes: '', entries: [] }` |
| `save_day_notes` | `{ date, notes }` | `{ ok: true }` | Same behavior as `PUT /api/day/:date/notes` |
| `upsert_entry` | `UpsertEntryInput` | `Entry` | Same behavior as `POST /api/entry`; creates day row if needed; keeps sort ordering behavior |
| `delete_entry` | `{ id }` | `{ ok: true }` | Same behavior as `DELETE /api/entry/:id` |
| `list_dates` | `{ from?, to? }` | `string[]` | Wave 0 parity only needs current `listDates()` behavior; filters are reserved and may be ignored initially |
| `get_settings` | `{}` | `Settings` | Same behavior as `GET /api/settings`; defaults returned if unset or corrupt |
| `save_settings` | `{ settings }` | `Settings` | Current REST route only persists `validation`; Wave 0 command should still persist the full serializable `Settings` object so the surface can grow without another transport redesign |
| `search_tickets` | `{ query }` | `TicketSuggestion[]` | Same behavior as `/api/tickets`; empty query returns recent suggestions |
| `push_day` | `{ date }` | `PushSummary` | Same push semantics as `POST /api/day/:date/push` |
| `dry_run_day` | `{ date }` | `DryRunSummary` | Same dry-run semantics as `POST /api/day/:date/push?dryRun=true` |

### Explicit Non-Command For Wave 0

`suggest_summary` is not part of the Wave 0 command set. AI infrastructure is deferred until after parity and packaging foundations are established.

## Frontend Adapter Contract

`src/api.ts` should be replaced by a typed invoke adapter with the same high-level call shape the UI uses today.

Recommended minimal adapter structure:

- `src/api/desktopApi.ts`: low-level typed `invoke` wrapper using `tauriCommandNames` and `TauriCommandContracts`
- `src/api.ts`: optional compatibility facade preserving the current `api.profile()`, `api.getDay(date)`, `api.saveNotes(date, notes)`, and similar methods so `App.tsx` and `Settings.tsx` can migrate with minimal churn

Frontend behavior to preserve in the adapter:

- successful commands resolve plain domain objects, not wrapped `{ data }` payloads
- command failures reject promises so current `try/catch` and `.catch(...)` flows continue to work
- profile bootstrap failure may still be treated as non-fatal by the UI
- settings bootstrap failure may still fall back to `defaultSettings` in the UI
- push and dry-run failures must still surface human-readable messages

## Error Contract

Native commands should return normal success values and reject with a serialized `NativeCommandError`.

Error shape:

```ts
interface NativeCommandError {
  code:
    | 'BAD_REQUEST'
    | 'VALIDATION_ERROR'
    | 'NOT_CONFIGURED'
    | 'AUTH_ERROR'
    | 'NETWORK_ERROR'
    | 'TLS_ERROR'
    | 'EXTERNAL_API_ERROR'
    | 'DB_ERROR'
    | 'INTERNAL_ERROR'
  message: string
  details?: string[]
  fieldErrors?: Array<{ field: string; message: string }>
  retryable?: boolean
}
```

Wave 0 error handling rules:

- malformed command input becomes `BAD_REQUEST`
- settings schema failures become `VALIDATION_ERROR`
- missing Jira/Tempo configuration becomes `NOT_CONFIGURED`
- Jira/Tempo auth failures become `AUTH_ERROR`
- proxy, TLS, DNS, and timeout failures become `NETWORK_ERROR` or `TLS_ERROR`
- SQLite and persistence failures become `DB_ERROR`
- unexpected failures become `INTERNAL_ERROR`

For parity with the current UI, the frontend adapter should normalize a rejected `NativeCommandError` into an `Error`-like object whose `message` is the native error message.

## REST To Command Mapping

| Current REST endpoint | Target command | Input mapping | Output mapping | Notes |
| --- | --- | --- | --- | --- |
| `GET /api/health` | `health_check` | none -> `{}` | `{ ok: true }` -> `HealthStatus` | Adds `commandSetVersion` to make scaffold verification explicit |
| `GET /api/profile` | `get_profile` | none -> `{}` | unchanged `JiraProfile` | Current server wraps config/auth failures as `{ error }`; Tauri should reject with `NativeCommandError` instead |
| `GET /api/day/:date` | `get_day` | route param -> `{ date }` | unchanged `Day` | Preserve empty day behavior |
| `PUT /api/day/:date/notes` | `save_day_notes` | route param + body `{ notes }` -> `{ date, notes }` | unchanged `{ ok: true }` | Preserve debounced notes save semantics in frontend |
| `POST /api/entry` | `upsert_entry` | body unchanged | unchanged `Entry` | Preserve id generation when `id` is absent |
| `DELETE /api/entry/:id` | `delete_entry` | route param -> `{ id }` | unchanged `{ ok: true }` | Preserve best-effort delete UI flow |
| `GET /api/dates` | `list_dates` | none -> `{}` | unchanged `string[]` | Currently unused by main UI but should remain available |
| `GET /api/settings` | `get_settings` | none -> `{}` | unchanged `Settings` | Preserve default merge behavior |
| `PUT /api/settings` | `save_settings` | current `{ validation }` becomes canonical `{ settings }` | unchanged `Settings` | Frontend adapter can wrap the current screen until the settings UI grows |
| `GET /api/tickets?q=...` | `search_tickets` | query string `q` -> `{ query }` | unchanged suggestion array | Empty query still means recent issues |
| `POST /api/day/:date/push` | `push_day` | route param -> `{ date }` | unchanged `PushSummary` | Preserve blocking on validation errors |
| `POST /api/day/:date/push?dryRun=true` | `dry_run_day` | route param -> `{ date }` | unchanged `DryRunSummary` | Preserve redacted headers and no-send behavior |

## Parity Checklist Extracted From Current Behavior

### Core Data And Editing

- loading a day returns the current notes and entries for a date
- loading a day with no stored row still returns a usable empty day object
- adding an entry creates a row immediately and defaults to a 30-minute slot after the previous entry or 09:00 when empty
- entry edits are persisted with debounced saves
- deleting an entry removes it locally and then issues a best-effort delete request
- notes are saved separately, locally only, and are never included in Tempo worklog payloads
- synced entries remain visible with sync metadata and are skipped on re-push

### Validation And Settings

- ticket format is validated locally with the shared regex
- blank ticket is an error
- malformed times are errors
- end before or equal to start is an error
- overlapping entries are errors and block push
- short, long, early, late, missing-summary, low-day-total, and high-day-total remain warnings, not blocking errors
- stored settings are merged over defaults and unknown settings keys are ignored
- invalid settings payloads are rejected
- native push validation uses stored settings, not a separate hard-coded config

### Push And Dry Run

- any validation error blocks the whole push and nothing is sent
- dry run also blocks on validation errors and still sends nothing
- already-synced entries are skipped for both push and dry run result counts
- dry run builds the exact outbound request shape for each unsynced entry
- dry run redacts the auth header before anything reaches logs or UI
- issue resolution is cached by ticket key
- each distinct ticket is only resolved once when cache is empty
- per-entry push failures are recorded without aborting later entries after the validation gate passes
- successful pushes mark entries as synced with a Tempo worklog id

### Frontend UX Expectations

- startup attempts profile fetch and tolerates failure by showing "not connected to Jira"
- startup attempts settings fetch and tolerates failure by falling back to `defaultSettings`
- push success refreshes the day so synced badges appear immediately
- dry run preview remains human-readable and shows request method, URL, headers, and body
- push button stays disabled when there are validation errors or no unsynced entries

## Implementation Guidance For Later Workstreams

### Command Registration Shape

Preferred Rust command modules for Wave 0:

- `commands/health.rs`: `health_check`
- `commands/profile.rs`: `get_profile`
- `commands/day.rs`: `get_day`, `save_day_notes`, `upsert_entry`, `delete_entry`, `list_dates`
- `commands/settings.rs`: `get_settings`, `save_settings`
- `commands/jira.rs`: `search_tickets`
- `commands/push.rs`: `push_day`, `dry_run_day`

### Shared Type Ownership

- keep `shared/types.ts`, `shared/settings.ts`, and `shared/validation.ts` as the frontend-safe source for the current UI
- keep `shared/tauri-contracts.ts` as the canonical frontend/native TypeScript contract description
- duplicate the compact validation and worklog-shaping rules in Rust rather than trying to share runtime code across TS and Rust

## Unresolved Architecture Questions

1. Existing DB migration path: should the first native build auto-import repo-local `data/tempo.db`, offer an explicit import action, or require a one-time manual migration?
2. Secret storage boundary: should Wave 0 scaffold assume a Tauri plugin for OS-native secrets immediately, or allow a temporary development-only config path while the settings UI catches up?
3. Command error serialization: should the Rust side reject with the raw `NativeCommandError` JSON shape directly, or should the frontend adapter normalize multiple native error shapes during the transition?
4. `list_dates` scope: does Wave 0 need date-range filtering soon enough to justify implementing `from` and `to` now, or should the command ignore those reserved fields until a UI actually needs them?
5. Ordering contract: should `sortOrder` remain a write-only persistence concern, or should a later contract revision expose it explicitly on returned entries if drag-reorder enters scope?

## Recommendations For Sub-Agents 02 Through 06

### Sub-Agent 02

- scaffold the Tauri command modules using the exact snake_case names from `shared/tauri-contracts.ts`
- add `error.rs` and `state.rs` early so later agents do not invent incompatible command signatures
- keep capabilities tight; Wave 0 only needs app-local storage, outbound HTTP, and minimal process/plugin access if any

### Sub-Agent 03

- expose a native repository API that can satisfy `get_day`, `save_day_notes`, `upsert_entry`, `delete_entry`, `list_dates`, `get_settings`, and `save_settings`
- preserve current settings default/merge semantics exactly, including tolerance for missing or stale stored blobs
- keep `sort_order` in SQLite even though it is not currently exposed on returned `Entry`

### Sub-Agent 04

- derive acceptance tests directly from `shared/validation.test.ts`, `shared/worklog.test.ts`, and `server/push.test.ts`
- preserve the validation gate, idempotent skip behavior, dry-run redaction, issue-id cache usage, and per-entry error collection exactly
- shape the push-domain interfaces around the Wave 0 command outputs `PushSummary` and `DryRunSummary`

### Sub-Agent 05

- implement integration traits/services that satisfy `get_profile`, `search_tickets`, issue resolution inside push, and Tempo worklog create/preview flows
- make auth, TLS, proxy, timeout, and retry failures map cleanly into the `NativeCommandError` codes defined in `shared/tauri-contracts.ts`
- preserve dry-run preview fidelity so the push domain can return the same request details the current UI shows

### Sub-Agent 06

- replace fetches with a typed invoke adapter that preserves the current `api` method surface until the UI can be cleaned up later
- keep current Promise rejection behavior so `App.tsx` and `Settings.tsx` need only small transport edits
- continue to treat profile/settings bootstrap failures as non-fatal unless product direction changes explicitly
