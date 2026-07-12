# Tauri Migration Plan

## Goal

Migrate the current local web app (`Vite + React + Fastify + SQLite`) to a clean long-term desktop-native architecture using:

- Tauri 2
- React + TypeScript frontend
- Rust native core
- SQLite local persistence
- Native command IPC instead of internal HTTP
- Local-only optional AI summarization via on-demand sidecar process

Primary target:
- macOS first

Supported target after stabilization:
- Windows

This migration should preserve the proven product behavior:
- local-first day logging
- local notes
- validation before push
- Jira lookup
- Tempo push
- dry-run preview
- future local AI summarization

The larger "notes-first, inferred entries" UX overhaul is intentionally deferred until after the platform migration is stable.

## Product Direction

### Target architecture

Frontend:
- React UI in TypeScript
- no direct DB access
- no direct Jira/Tempo calls
- no credentials in frontend
- all privileged actions via Tauri commands

Native core:
- Rust Tauri application core
- command handlers for all app actions
- SQLite access
- settings persistence
- credentials management
- Jira and Tempo API clients
- push orchestration
- local AI sidecar lifecycle management

Inference runtime:
- separate sidecar binary for local summarization
- started on demand
- shut down after idle timeout
- no persistent context
- no remote inference

Transport:
- remove Fastify and internal REST API in the target architecture

## High-Level Decisions

### Keep conceptually

Preserve these current concepts:

- `Day`, `Entry`, settings, validation, push summaries
- local-only notes
- summary as the Tempo worklog description
- dry run before push
- idempotent push behavior for synced entries
- issue-id cache
- separation of concerns between UI, validation, persistence, and external integrations

### Replace

Replace these implementation layers:

- `server/index.ts`
- `server/routes.ts`
- local `/api/...` transport
- `.env` as the long-term user-facing configuration mechanism

### Rebuild natively

Rebuild these backend responsibilities in Rust:

- SQLite schema and repository layer
- settings storage and merge/default behavior
- Jira client
- Tempo client
- push orchestration
- local summary suggestion orchestration
- app configuration and secrets handling

### Defer

Do not mix these into the migration:

- major notes-first UX redesign
- commit/calendar/external-context AI enrichment
- update/delete sync with Tempo unless required for parity
- multi-user or cloud sync concerns

## Why Tauri-Native Instead of Sidecar Node

We are explicitly choosing a full Tauri-native core instead of keeping Node as a sidecar because the project is still early and we want the cleanest long-term architecture.

Benefits:
- no internal web server
- no localhost port management
- smaller runtime surface
- cleaner trust boundary
- better packaging story
- better fit for local-only desktop behavior
- simpler process model for AI sidecars

Tradeoff:
- rewrite of current Node server logic into Rust

This tradeoff is acceptable and preferred.

## Current System Inventory

### Frontend responsibilities today

Current frontend responsibilities worth preserving:
- day loading and editing
- local row editing UX
- validation display
- notes editing
- push and dry-run actions
- settings UI

Current frontend files of interest:
- `src/App.tsx`
- `src/EntryRow.tsx`
- `src/TicketField.tsx`
- `src/Settings.tsx`
- `src/api.ts`

### Shared logic today

Current shared logic worth preserving conceptually:
- `shared/types.ts`
- `shared/validation.ts`
- `shared/worklog.ts`
- `shared/settings.ts`

### Backend responsibilities today

Current backend responsibilities to port to Rust:
- DB schema and repo:
  - `server/db/index.ts`
  - `server/db/repo.ts`
- config/auth:
  - `server/config.ts`
  - `server/auth/*`
- external HTTP:
  - `server/http.ts`
  - `server/jira/client.ts`
  - `server/tempo/client.ts`
- orchestration:
  - `server/push.ts`
- route surface to be replaced:
  - `server/routes.ts`

### Existing tested behavior worth preserving

Tests currently define useful behavior to preserve:
- validation rules
- worklog payload shaping
- push blocking on errors
- idempotent push
- issue ID caching
- dry-run auth redaction
- settings-based validation consistency

Useful existing tests:
- `shared/validation.test.ts`
- `shared/worklog.test.ts`
- `shared/settings.test.ts`
- `server/push.test.ts`

## Recommended Target Repository Shape

```text
src/
  app/
    App.tsx
    routes-or-screens/
    components/
    hooks/
    state/
  api/
    desktopApi.ts
    commands.ts
  domain/
    types.ts
    validation.ts
    settings.ts
    formatting.ts
  features/
    day/
    notes/
    push/
    settings/
    ai/
  styles/

src-tauri/
  Cargo.toml
  tauri.conf.json
  capabilities/
    default.json
  src/
    main.rs
    lib.rs
    state.rs
    error.rs
    commands/
      day.rs
      entry.rs
      notes.rs
      settings.rs
      push.rs
      jira.rs
      ai.rs
      health.rs
    core/
      db/
        mod.rs
        schema.rs
        repo.rs
      settings/
        mod.rs
      validation/
        mod.rs
      jira/
        mod.rs
        client.rs
      tempo/
        mod.rs
        client.rs
      push/
        mod.rs
      ai/
        mod.rs
        manager.rs
        prompt.rs
      auth/
        mod.rs
        secrets.rs
      paths/
        mod.rs
      http/
        mod.rs
  resources/
  binaries/
```

Notes:
- `src/domain` should hold frontend-safe logic only
- `src-tauri/src/core` should hold native logic
- `src-tauri/src/commands` should be thin wrappers over core services

## Migration Strategy

### Strategy summary

Do this as a staged migration, not a big bang rewrite of UI and UX at the same time.

Recommended phases:

1. Freeze current product scope
2. Define target contracts
3. Scaffold Tauri shell and React integration
4. Port persistence and settings to Rust
5. Port external API clients and push flow to Rust
6. Replace frontend HTTP layer with Tauri invoke layer
7. Re-establish functional parity
8. Add local AI infrastructure
9. Harden packaging, signing, and enterprise-readiness
10. Only then start notes-first UX redesign

## Phase 0 - Scope Freeze

### Objective

Prevent product churn during architecture migration.

### Deliverables

- Explicitly freeze current functional scope
- Define parity checklist:
  - day navigation
  - local notes persistence
  - entry CRUD
  - validation
  - Jira ticket lookup
  - push day
  - dry run
  - settings persistence
- Defer notes-first redesign
- Defer additional AI features beyond summary suggestion infrastructure

### Sub-agent tasks

- inventory all current features and current UX behaviors
- produce parity checklist
- flag any hidden dependencies on Fastify/Node assumptions

## Phase 1 - Define Shared Contracts

### Objective

Create stable frontend/native contracts before implementation.

### Decisions

- Frontend will call typed Tauri commands, not generic fetch wrappers
- IPC contracts should be explicit and versionable
- Native commands return structured errors suitable for UI display

### Deliverables

Define command contract list such as:

- `get_day(date) -> Day`
- `save_notes(date, notes) -> Ok`
- `save_entry(entry_input) -> Entry`
- `delete_entry(id) -> Ok`
- `list_dates() -> string[]`
- `get_settings() -> Settings`
- `save_settings(settings) -> Settings`
- `get_profile() -> JiraProfile`
- `search_tickets(query) -> TicketSuggestion[]`
- `push_day(date) -> PushSummary`
- `dry_run_day(date) -> DryRunSummary`
- `suggest_summary(entry_id) -> SuggestedSummaryResult`

### Sub-agent tasks

- extract all request/response shapes from current TS app
- propose canonical command payloads and result types
- define error model for UI consumption

## Phase 2 - Scaffold Tauri App

### Objective

Create the new desktop runtime shell without yet porting all behavior.

### Deliverables

- Tauri 2 app scaffold with React/Vite frontend
- working `invoke` bridge
- capability file with minimum required permissions
- app identity, bundle IDs, icons, names configured
- dev workflow documented for macOS first

### Technical notes

- Use Tauri capabilities conservatively
- Prefer explicit plugin permissions
- Do not expose broad shell/fs access to the frontend unless necessary
- Native code should own external process execution

### Sub-agent tasks

- create Tauri scaffold plan
- propose initial `tauri.conf.json`
- define initial capability model
- document dev prerequisites for macOS and Windows

## Phase 3 - Port Persistence and Settings

### Objective

Move local data model into Rust first. This gives the app a stable native core.

### Deliverables

- Rust SQLite schema equivalent to current tables:
  - `days`
  - `entries`
  - `issue_cache`
  - `settings`
- repository functions matching current behavior
- app-data directory based DB path, not project-local `data/`
- initial settings persistence
- migration strategy for existing local SQLite data if needed

### Important decisions

- Store DB under Tauri app data directory
- Decide whether to migrate old `data/tempo.db` automatically or manually
- Use a migration mechanism rather than one big startup SQL block long term

### Sub-agent tasks

- map current SQLite schema and repo behavior to Rust
- define DB path strategy on macOS and Windows
- propose migration/import path from existing DB
- identify crate choice:
  - likely `rusqlite` for simplicity
  - or `sqlx` if async/query ergonomics justify it

Recommended default:
- `rusqlite`

Reason:
- local app
- simple schema
- direct control
- lower complexity than `sqlx`

## Phase 4 - Port Validation and Domain Rules

### Objective

Preserve trusted business behavior before external API rewrite.

### Recommendation

Duplicate small validation logic in both TS and Rust.

Why:
- UI needs instant validation feedback
- native side must revalidate before push
- rules are compact enough to justify duplication

### Deliverables

- TS validation retained or reorganized in `src/domain`
- Rust validation module with behavior parity
- parity tests for:
  - invalid tickets
  - time validation
  - overlaps
  - summary warnings
  - day total warnings

### Sub-agent tasks

- convert current validation rules into language-neutral spec
- implement parity test matrix
- identify any current behavior ambiguities

## Phase 5 - Port Jira and Tempo Clients

### Objective

Recreate remote integrations in Rust.

### Deliverables

- Jira client:
  - `myself`
  - `resolveIssue`
  - `pickIssues`
- Tempo client:
  - `listWorklogs` if needed
  - `createWorklog`
  - preview request builder for dry-run
- retry and timeout policy equivalent to current behavior
- TLS/corporate trust handling strategy documented

### Important considerations

- Corporate TLS interception matters
- Rust HTTP stack must be tested on managed networks
- Need explicit logging and error messages for cert/proxy failures

### Recommended crate direction

Candidates:
- `reqwest` for HTTP
- `serde` for payloads
- `thiserror` / `anyhow` for errors

### Sub-agent tasks

- map current HTTP behaviors and retries
- recommend Rust HTTP client configuration
- define redaction rules for sensitive headers in dry run / logs
- review corporate CA trust behavior on macOS and Windows

## Phase 6 - Port Push Orchestration

### Objective

Recreate `pushDay` and `dryRunDay` exactly.

### Deliverables

- native push orchestration
- issue cache use preserved
- validation gate preserved
- dry-run preview preserved
- per-entry error reporting preserved
- idempotent skip of already-synced entries preserved

### Preserve these behaviors specifically

- invalid entry blocks whole push
- dry run builds exact requests, sends nothing
- token redaction in preview
- already-synced entries skipped
- per-entry failures do not necessarily abort the rest after validation gate
- stored settings determine runtime validation config

### Sub-agent tasks

- port `push.ts` behavior to Rust design
- derive acceptance criteria directly from existing tests
- propose unit/integration test suite

## Phase 7 - Replace Frontend API Layer

### Objective

Swap out fetch-based API access without rewriting the whole UI first.

### Deliverables

- replace `src/api.ts` with Tauri invoke wrapper
- preserve current UI flows as much as possible
- introduce row-level async state where needed
- keep current day-view UX stable during platform migration

### Notes

This phase should aim for minimal user-facing changes.

### Sub-agent tasks

- map existing `src/api.ts` calls to command wrappers
- identify all `App.tsx` assumptions about fetch/promise/error behavior
- recommend minimal frontend adapter structure

## Phase 8 - Credentials and Settings UX

### Objective

Remove `.env` as the long-term operational model.

### Deliverables

- in-app settings for:
  - Jira base URL
  - Jira email
  - Jira API token
  - Tempo API token
  - validation settings
  - optional AI settings
- secure persistence strategy
- initial import path from `.env` for development convenience

### Recommended storage strategy

Short term:
- normal settings in app config/store
- secrets in OS keychain if feasible, otherwise encrypted local secret store

Preferred Tauri-native options to investigate:
- keychain/credential plugin if suitable
- `stronghold` only if it materially improves the setup and is worth complexity

Recommendation:
- do not overcomplicate v1 with Stronghold unless it clearly pays off
- for corporate acceptance, OS-native secret storage is ideal

### Sub-agent tasks

- evaluate Tauri secret storage options for macOS and Windows
- recommend production credential storage approach
- define migration path from `.env` to UI-managed settings

## Phase 9 - Local AI Infrastructure

### Objective

Add the infrastructure for local summarization without over-expanding scope.

### Scope for this phase

Only build:
- AI runtime manager
- model configuration plumbing
- on-demand summary suggestion command

Do not yet redesign the notes-first workflow.

### Recommended design

- Rust native `ai::manager`
- bundled or separately managed sidecar binary
- model stored outside app bundle when appropriate
- process starts on first summary request
- idle timeout kills process
- no persistent context
- output constrained to one short summary string

### Packaging recommendation

Runtime:
- sidecar binary via Tauri `externalBin`

Model:
- not bundled into main app initially unless very small
- preferred location: app data directory
- install/download/configure separately

### Corporate caution

Bundled external binaries and spawned child processes are exactly the sort of thing some EDR tools inspect aggressively. This is not a reason not to do it, but it should be treated as a first-class packaging/security workstream.

### Sub-agent tasks

- recommend specific local runtime strategy for macOS-first:
  - `llama.cpp` sidecar likely preferred
- recommend initial model family and quantization class
- define lifecycle manager behavior
- define AI command and prompt contract
- define packaging and update strategy for runtime vs model

## Phase 10 - Packaging, Signing, and Enterprise Hardening

### Objective

Make the app installable and usable on corporate machines.

### macOS requirements

Minimum serious distribution path:
- Apple Developer account
- Developer ID signing
- notarization
- test on managed macOS machine if possible

Without that:
- locally packaged builds may work for personal use
- but will create real friction in enterprise environments

### Windows requirements

Minimum serious distribution path:
- signed installer
- SmartScreen expectations documented
- test with WebView2 scenarios
- likely NSIS first for flexibility

### Tauri packaging concerns to explicitly handle

- app signing
- sidecar signing
- updater signing if auto-update is used
- resource and model placement
- Windows WebView2 install mode
- macOS minimum system version
- machine-local vs user-local install strategy
- crash logging and diagnostics

### Recommended Windows defaults

- prefer NSIS initially
- user-local install by default unless there is a strong reason for per-machine
- choose WebView2 installer mode based on target environment:
  - managed online environment: bootstrapper or embed bootstrapper
  - restricted/offline environment: offline installer

### Corporate networking concerns

The app talks to:
- Jira
- Tempo
- optional update endpoint
- optional model download endpoint if that path is chosen

Need documentation for:
- outbound domains
- TLS interception behavior
- proxy handling
- update mechanism behavior
- whether local AI makes any external calls

### Sub-agent tasks

- produce macOS distribution checklist
- produce Windows distribution checklist
- define signing/notarization pipeline
- recommend initial Tauri updater stance:
  - likely defer auto-updater until baseline packaging is stable
- define sidecar signing requirements

## Phase 11 - QA and Verification

### Objective

Re-establish confidence after the rewrite.

### Test layers

Rust:
- unit tests for validation
- repo tests
- push orchestration tests
- client payload mapping tests

Frontend:
- component tests for critical interactions
- integration tests for key flows

End-to-end:
- create/edit/delete entry
- save notes
- lookup ticket
- dry run
- push
- settings save/load
- AI summary suggestion once added

### Regression checklist

- time calculations match current behavior
- warnings/errors match current behavior
- synced entries preserve skip logic
- dry run redaction works
- settings affect both UI and native push validation
- app works after restart with persisted data
- app paths behave correctly on macOS and Windows

### Sub-agent tasks

- translate existing behavior into explicit acceptance tests
- propose E2E harness for Tauri app
- identify what should remain unit-tested vs E2E-tested

## Phase 12 - Notes-First UX Overhaul

### Objective

Only after migration parity is stable, redesign the product around notes-first capture and inferred time entries.

### Not in migration scope now

This phase is intentionally separate.

Potential future direction:
- notes timeline first
- inferred segments or suggested entries
- structured worklog extraction from notes
- optional AI-assisted summary + segmentation
- keyboard-heavy capture flow

### Constraint

Do not start this until:
- native core is stable
- packaging is viable
- settings/credentials are no longer `.env`-based
- current functionality is verified in Tauri

## Corporate Machine Risk Register

### 1. Unsigned or non-notarized macOS app blocked or heavily warned

Mitigation:
- Developer ID signing
- notarization
- test on managed macOS

### 2. Windows SmartScreen warnings

Mitigation:
- signed installer
- reputation-building
- possible enterprise distribution channel
- document initial warning expectations

### 3. EDR blocks sidecar LLM runtime

Mitigation:
- sign sidecar
- keep AI optional
- document binary behavior
- test on representative corporate machine
- allow feature disablement

### 4. TLS interception breaks Jira/Tempo access

Mitigation:
- test Rust HTTP client with corporate CA setup
- expose meaningful error messages
- document trust-store expectations

### 5. WebView2 unavailable or restricted on Windows

Mitigation:
- choose proper `webviewInstallMode`
- test install on clean machine
- consider offline installer for restricted environments

### 6. Corporate policy rejects local token storage approach

Mitigation:
- use OS-native secret storage if possible
- document local data and credential handling clearly

### 7. App updates blocked or untrusted

Mitigation:
- defer auto-updater initially
- ship signed releases manually first
- add updater only after trust pipeline is stable

### 8. Model or sidecar size too large for easy deployment

Mitigation:
- separate runtime/model from base app where possible
- support post-install model setup

## Recommended Initial Technical Choices

### Frontend

- React
- TypeScript
- Vite
- current MUI can stay initially unless migration uncovers strong reasons to change

### Tauri

- Tauri 2
- capabilities locked down tightly
- use plugins sparingly

### Rust

- `reqwest`
- `serde`
- `thiserror`
- `rusqlite`
- structured modules with thin command layer

### Secrets

- prefer OS-native secret handling
- do not rely on `.env` beyond dev bootstrap

### AI runtime

- sidecar process
- `llama.cpp`-style runtime likely best first fit
- tiny instruct model
- on-demand startup + idle shutdown

### Packaging

- macOS first:
  - signed + notarized `.app` / `.dmg`
- Windows second:
  - signed NSIS installer first
- updater:
  - defer until baseline packaging is solid

## Suggested Work Breakdown For AI Sub-Agents

### Track A - Architecture and Contracts

Owns:
- command contract definition
- target module layout
- migration sequencing
- parity checklist

### Track B - Rust Persistence Core

Owns:
- SQLite schema
- repo layer
- app data paths
- settings persistence

### Track C - Rust Integrations

Owns:
- Jira client
- Tempo client
- retry/timeout behavior
- auth/token handling

### Track D - Push and Validation Core

Owns:
- Rust validation port
- worklog payload builder
- push orchestration
- dry run behavior
- tests

### Track E - Frontend Adapter Migration

Owns:
- `src/api.ts` replacement
- Tauri invoke wrapper
- minimal UI changes for parity

### Track F - Packaging and Enterprise Readiness

Owns:
- macOS signing/notarization plan
- Windows installer/signing/WebView2 plan
- corporate deployment risk mitigation
- update strategy

### Track G - AI Infrastructure

Owns:
- sidecar runtime strategy
- model placement strategy
- prompt/input contract
- idle lifecycle manager
- packaging implications

### Track H - Post-Migration UX Redesign

Owns later:
- notes-first product model
- inferred time-entry workflow
- AI-assisted extraction/summarization UX

## Recommended Sequence of Execution

1. Architecture/contracts
2. Tauri scaffold
3. Rust DB/settings core
4. Rust validation + push domain
5. Rust Jira/Tempo clients
6. Frontend command adapter
7. Parity verification
8. Packaging/signing foundation
9. AI infrastructure
10. Notes-first UX redesign

## Non-Goals During Migration

- no internal HTTP server in final architecture
- no web deployment target preservation unless explicitly reintroduced later
- no major UX rewrite during parity migration
- no background always-on AI runtime
- no cloud AI dependency
- no broad file-system or shell permissions exposed to frontend

## Open Questions To Resolve Early

1. Do we want automatic migration/import of the existing SQLite file, or is manual import acceptable?
2. What is the desired minimum macOS version?
3. Do we want Windows support to include offline/restricted corporate environments from the first public Windows build?
4. Should AI be included in the first Tauri release, or land after packaging parity?
5. What secret-storage approach do we want to standardize on for production?
6. Do we want the first packaged builds to support auto-update, or should updates be manual initially?
7. Is local AI an opt-in advanced feature, or a built-in default feature once ready?

## Recommendation Summary

Recommended end state:
- Tauri 2 + React frontend
- Rust-native local core
- no internal Fastify server
- SQLite in app-data directory
- in-app settings and token management
- signed/notarized macOS distribution
- signed Windows installer distribution
- local AI as optional on-demand sidecar
- notes-first UX redesign after platform migration stabilizes

Recommended immediate next step:
- create the Tauri scaffold and define the command contract before any implementation-heavy porting work begins.
