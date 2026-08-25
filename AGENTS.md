# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

A local-first **desktop timesheet app**: React 19 + TypeScript + Vite UI inside a
**Tauri 2** shell with a native **Rust** core. No server, no cloud. Users log
time in a notepad-style day view ("Notebook"), see it visualised as a horizontal
timeline ("Timeline" panel), then push the day to Tempo via its API. Jira is used
to resolve ticket keys to numeric issue ids, for autocomplete, and for the user
profile. macOS silicon is the only packaged target.

## Commands

```bash
npm install          # first-time setup (Node 22+, Rust toolchain required)
npm run tauri:dev    # run the desktop app in dev mode

# Frontend/shared checks (run all three after frontend changes)
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # vite build

# Rust checks (run after any src-tauri change)
cd src-tauri && cargo check && cargo test

npm run tauri:build  # package the desktop app
```

There is no ESLint/Prettier config; `typecheck` + `vitest` + `cargo` are the gates.

## Layout

```
src/            React front end (Vite). Talks to the core only via Tauri commands.
  api/            thin typed wrappers over invoke; api/index.ts is the public surface
  features/
    notebook/     NotebookEditorPanel, block model/mutations, TicketField (Jira autocomplete)
    timeline/     TimelinePanel, block drag/pins, split resize, drop targets
    sync/         push/dry-run flow, Tempo worklog overlay, sync status chips
    shell/        AppHeader, DateToolbar, StatusBar, StackedPanels, clock
    settings/, activity/, notifications/, updater/
shared/         Isomorphic TypeScript used by BOTH sides: types.ts, notebook.ts,
                validation.ts, settings.ts, tauri-contracts.ts
src-tauri/src/
  commands/       thin Tauri command handlers (arg/response DTOs)
  core/           business logic: push.rs, tempo.rs, jira.rs, validation.rs,
                  notebook.rs, db/, ai/, settings.rs
  state.rs        Rust mirror of the TS data types + Settings
```

## Architecture rules

- **Tauri contract:** every command crossing the boundary is typed in
  `shared/tauri-contracts.ts`; command names/payloads are a stable contract.
  Frontend calls go through `src/api/index.ts`, never raw `invoke`.
- **TS/Rust twins:** several pieces of logic exist in both languages and MUST be
  kept textually/behaviourally aligned when edited:
  - validation: `shared/validation.ts` ⇄ `src-tauri/src/core/validation.rs`
  - auto-summary truncation: `autoSummary` in `shared/notebook.ts` ⇄ `notebook_block_summary`
  - `NotebookBlock`: `shared/types.ts` ⇄ `struct NotebookBlock` in `src-tauri/src/state.rs`
- **Client is never trusted:** validation runs live in the UI for feedback, then
  re-runs natively before every dry-run/push (`core/push.rs`). Errors block the
  entire day's push.
- **Single source of truth:** no state library. `App.tsx` owns the day via
  `useNotebookDay` (loads, normalises, debounced-autosaves through `commitDay`);
  Timeline and Notebook are two views over the same `day.blocks`. Mutations from
  either panel round-trip through `dayRef.current` → mutate → `commitDay`.

## Data model (NotebookBlock)

Key fields (`shared/types.ts`): `id`, `date`, `startMinute`/`endMinute`
(minutes-from-midnight, nullable), `text` (freeform notes — NEVER sent to Tempo),
`closed`, `ticketId` (e.g. `ABC-123`), `summaryOverride?`, `manualEnd?`,
`tempoWorklogId?` (idempotency marker set after successful push), `syncedAt?`.

- A day always ends with one trailing blank slot; `normalizeNotebookDay` sorts
  closed-timed blocks by start and appends blanks.
- `patchBlock` clears `tempoWorklogId`/`syncedAt` whenever push-relevant fields
  change (`blockHasPushRelevantChanges`) so edits re-queue for sync.
- Summary shown/uploaded = `summaryOverride ?? autoSummary(text)` (trimmed,
  truncated with `…` inside the char limit).

## Database

- Single SQLite file `tempo.db` in `app_data_dir`, opened **WAL-mode** by
  `Repository` (`src-tauri/src/core/db/repo.rs`). One connection, owned by
  `AppState` (state.rs) — no pool. Anything that swaps/replaces DB contents must
  go through that connection, not file copies behind its back.
- Migrations: append-only SQL list in `src-tauri/src/core/db/schema.rs`, tracked
  via the `user_version` pragma. Forward-only — never edit an already-applied
  migration, only add to the end.
- Tables: `notebook_days` + `notebook_blocks` (live data); `settings` (one JSON
  blob under key `app`); `issue_cache` (disposable Jira cache); `days` +
  `entries` (legacy wave0, **dead** — no code reads or writes them).
- **Secrets are never in SQLite**: Jira/Tempo tokens live in the OS keychain
  (`secret_store.rs`). Any DB backup therefore excludes secrets by design.

## Validation & push

- Two tiers: `error` blocks the whole push; `warning` is informational
  (TOO_SHORT/TOO_LONG, EARLY/LATE, DAY_LOW/DAY_HIGH, NO_TEXT).
- Ticket shape regex `/^[A-Z][A-Z0-9]*-\d+$/`. Ticket *existence* is checked only
  at push time (Jira resolve, cached in SQLite).
- Push filter (`pushable_block`): closed + timed + non-empty summary. Already-
  synced blocks (have `tempoWorklogId`) are skipped. Per-block failures don't
  abort the rest; they're reported individually.
- Dry-run builds the exact HTTP request (auth redacted) without sending.

## Conventions

- UI kit: MUI v9 + Emotion. Tooltips use `<Tooltip arrow>`. Icons come from
  `@mui/icons-material` only. Dates via dayjs; minutes-from-midnight internally.
- Comments explain *why*, not what. Keep them when refactoring; match existing
  tone. No TODOs without context.
- Tests: Vitest, colocated as `*.test.ts` next to the source (pure logic only —
  components aren't tested). Mirror the same cases in the Rust `#[cfg(test)]`
  modules when touching twin logic.
- Theme tokens like `theme.ledger.*` carry the ledger/ruler palette; use them
  rather than hard-coded colours.
- Layout: below the `md` breakpoint panels stack and alternate via
  `StackedPanels`; above it they're side-by-side columns with a draggable splitter.

## Key files quick index

| Concern | Location |
|---|---|
| App composition, panel wrappers, stats | `src/App.tsx` |
| Day state + all mutation handlers | `src/features/notebook/useNotebookDay.ts` |
| Block factory/normalise/totals | `src/features/notebook/blockModel.ts` |
| Timeline rendering (px math: `(min − minVisible) × PX_PER_MINUTE + 16`) | `src/features/timeline/TimelinePanel.tsx` |
| Drag pins/click-vs-drag | `src/features/timeline/useBlockDrag.ts` |
| Sync chip logic | `src/features/sync/syncStatus.ts` |
| Push orchestration | `src-tauri/src/core/push.rs` |
| Settings schema | `shared/settings.ts` |
