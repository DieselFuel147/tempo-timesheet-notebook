# Sub-Agent 07 - Packaging and Enterprise Hardening

## Mission

Make the app realistically packageable and explain the concrete constraints for corporate-machine usage on macOS first and Windows second.

## Scope

You own:

- packaging path recommendations
- signing/notarization requirements
- Windows installer recommendations
- WebView2 strategy
- corporate-machine risk documentation
- sidecar packaging/signing implications

You do not own:

- large runtime rewrites
- AI implementation itself
- notes-first redesign

## Inputs

- `tauri-migration-plan.md`
- outputs from scaffold and native-core workstreams
- Tauri packaging constraints implied by current repo state

## Required Outputs

- concrete packaging checklist for macOS
- concrete packaging checklist for Windows
- repo/config changes if appropriate
- recommendation for how to phase in signing, notarization, and updater support

## Acceptance Criteria

- macOS-first distribution path is explicit and realistic
- Windows constraints are documented without overcommitting too early
- corporate risks are documented in a way a future release owner can act on
- no packaging shortcuts are recommended that undermine likely enterprise use

## Return Format

Return one final report containing:

- files changed
- packaging decisions made
- unresolved release risks
- recommended next steps before any broad internal distribution
