# Workstream Index

This file is the execution map for the primary agent.

## Source Of Truth

- Strategic plan: `tauri-migration-plan.md`
- Orchestration brief: `delegation/tauri-migration/primary-agent-brief.md`
- Execution briefs: `delegation/tauri-migration/subagent-*.md`

## Waves

### Wave 0 - Foundation

Workstreams:
- 01 Architecture and Contracts
- 02 Tauri Scaffold

Goals:
- lock target architecture
- define command boundaries
- stand up the Tauri app shell

Can run in parallel:
- yes, with frequent sync

Must complete before:
- frontend adapter migration
- major Rust core implementation

### Wave 1 - Native Core

Workstreams:
- 03 Rust Persistence and Settings
- 04 Rust Validation and Push Domain
- 05 Rust Integrations

Goals:
- stand up local native storage
- preserve validation and push semantics
- recreate Jira/Tempo integrations in Rust

Can run in parallel:
- yes, after contracts stabilize

Depends on:
- Wave 0

### Wave 2 - App Parity Integration

Workstreams:
- 06 Frontend Adapter and Parity

Goals:
- swap fetch-based API usage for Tauri commands
- preserve current UI behavior
- integrate the new Rust core behind the existing frontend

Depends on:
- Wave 0
- core pieces of Wave 1

### Wave 3 - Packaging and Enterprise Hardening

Workstreams:
- 07 Packaging and Enterprise

Goals:
- make the app realistically distributable on macOS first
- define Windows path next
- handle signing, notarization, SmartScreen, WebView2, sidecar concerns

Depends on:
- scaffold availability
- enough app functionality to package meaningfully

### Wave 4 - Local AI Infrastructure

Workstreams:
- 08 AI Infrastructure

Goals:
- add the on-demand local summarization infrastructure
- do not yet redesign the notes-first workflow

Depends on:
- command boundaries being stable
- packaging path being understood
- app parity largely complete

### Deferred - Product Redesign

Workstreams:
- 09 Notes-First UX Deferred

Goals:
- redesign the app toward notes-first capture and inferred time entries

Must not start until:
- migration parity is complete
- packaging is viable
- settings and credentials are no longer `.env`-bound

## Dependency Graph

- 01 blocks 06
- 02 partially blocks 03, 05, 06, 07
- 03 informs 06 and 07
- 04 informs 06 and 08
- 05 informs 06, 07, and 08
- 06 should land before 08 unless AI is implemented behind unused commands only
- 07 should begin research early, but packaging changes should not churn the runtime architecture
- 09 is explicitly deferred

## Review Gates

Primary agent should stop and review at these points:

1. after Wave 0 contracts are agreed
2. after Wave 1 native core is credible
3. before Wave 2 frontend integration merges broadly
4. before enabling packaging/distribution assumptions in repo defaults
5. before starting AI runtime work

## Expected Deliverables Per Workstream

Every workstream must return:

- summary
- files changed
- tests run
- exact acceptance status
- open blockers
- downstream implications
