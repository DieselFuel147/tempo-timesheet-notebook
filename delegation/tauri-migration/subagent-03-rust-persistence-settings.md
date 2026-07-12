# Sub-Agent 03 - Rust Persistence and Settings

## Mission

Port local persistence and settings from the current Node/SQLite implementation into the Rust native core.

## Scope

You own:

- SQLite schema recreation in Rust
- repository layer for days, entries, issue cache, and settings
- app-data path strategy
- settings load/save behavior
- migration/import recommendation for existing local DB if needed

You do not own:

- Jira/Tempo API integrations
- final frontend integration
- notes-first redesign

## Inputs

- `server/db/index.ts`
- `server/db/repo.ts`
- `shared/settings.ts`
- outputs from Sub-Agents 01 and 02

## Required Outputs

- native DB layer with clear module boundaries
- equivalent schema and repo behavior
- settings persistence behavior matching current app intent
- tests for persistence-critical behaviors where practical

## Acceptance Criteria

- all current local entities have a native persistence path
- DB location uses app-data conventions, not repo-local `data/`
- settings default/merge behavior is preserved or improved explicitly
- work is cleanly consumable by Sub-Agent 06

## Return Format

Return one final report containing:

- files changed
- schema decisions made
- tests run
- migration concerns for existing data
- exact API surface exposed to dependent workstreams
