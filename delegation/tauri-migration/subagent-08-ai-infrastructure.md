# Sub-Agent 08 - AI Infrastructure

## Mission

Add the local AI infrastructure for on-demand summary suggestion without redesigning the product around AI yet.

## Scope

You own:

- AI command surface
- sidecar/runtime manager design and implementation
- model path/config approach
- idle shutdown behavior
- privacy-preserving local-only constraints

You do not own:

- notes-first redesign
- broad AI enrichment from commits/calendar/history
- remote model usage

## Inputs

- `tauri-migration-plan.md`
- outputs from Sub-Agents 01, 04, 05, 06, and 07

## Required Outputs

- native AI manager surface
- command contract for summary suggestion
- packaging-aware strategy for runtime and model placement
- documentation of any required sidecar/resource configuration

## Acceptance Criteria

- AI runtime is on-demand, not always loaded
- design allows true idle shutdown
- no persistent context is required
- implementation does not destabilize the core migration architecture

## Return Format

Return one final report containing:

- files changed
- runtime/model decisions made
- security or corporate-distribution caveats
- what still needs UI work versus backend infrastructure work
