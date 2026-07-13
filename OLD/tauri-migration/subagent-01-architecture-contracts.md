# Sub-Agent 01 - Architecture and Contracts

## Mission

Define the target Tauri-native architecture and the frontend/native command contract surface, without doing large implementation work.

## Scope

You own:

- target module boundaries
- command surface definition
- transport replacement plan for `src/api.ts`
- migration parity checklist reference
- identification of behavior that must be preserved exactly

You do not own:

- full Rust implementation
- major frontend rewrites
- packaging implementation

## Inputs

- `tauri-migration-plan.md`
- current app structure under `src/`, `server/`, and `shared/`
- existing tests that define behavior

## Required Outputs

Produce and, if appropriate, commit the following kinds of artifacts:

- architecture notes for the Tauri-native module split
- explicit command contracts
- request/response type mapping from current REST endpoints to Tauri commands
- parity checklist extracted from current behavior

## Acceptance Criteria

- all current REST endpoints are mapped to target Tauri commands
- there is a clear separation between frontend-safe logic and native privileged logic
- the plan does not keep Fastify as part of the long-term runtime path
- the command surface is concrete enough for scaffold, core, and frontend agents to implement against

## Return Format

Return one final report containing:

- what contracts were defined
- what files were changed
- what unresolved architecture questions remain
- exact recommendations for sub-agents 02, 03, 04, 05, and 06
