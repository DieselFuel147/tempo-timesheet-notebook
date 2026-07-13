# Sub-Agent 02 - Tauri Scaffold

## Mission

Create the Tauri application scaffold and baseline desktop runtime structure needed for the migration.

## Scope

You own:

- Tauri 2 setup
- `src-tauri/` scaffold
- initial capabilities file
- initial config for app identity and bundling basics
- React/Vite integration with Tauri

You do not own:

- full Rust business logic port
- final packaging hardening
- UI redesign

## Inputs

- `tauri-migration-plan.md`
- outputs from Sub-Agent 01 when available

## Required Outputs

- working Tauri scaffold in repo
- initial `tauri.conf.json`
- baseline Rust entry points and command registration structure
- development workflow instructions updated as needed

## Acceptance Criteria

- app can run in Tauri dev mode or is very close with clearly stated blockers
- repo structure supports later native core modules cleanly
- no permanent Node sidecar is introduced
- capability configuration is conservative, not permissive by default

## Return Format

Return one final report containing:

- files added or changed
- current dev/build status
- missing pieces for Sub-Agents 03, 05, 06, and 07
- any config decisions that should now be treated as fixed assumptions
