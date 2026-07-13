# Sub-Agent 04 - Rust Validation and Push Domain

## Mission

Port and preserve the core domain behavior around validation, worklog shaping, and push orchestration semantics.

## Scope

You own:

- Rust validation rules matching current behavior
- worklog payload shaping behavior
- push orchestration behavior design and implementation
- dry-run behavior and redaction behavior
- use of stored settings for runtime validation

You do not own:

- Jira/Tempo transport implementation itself beyond interface expectations
- frontend wiring
- packaging

## Inputs

- `shared/validation.ts`
- `shared/worklog.ts`
- `server/push.ts`
- `server/push.test.ts`
- outputs from Sub-Agents 01, 02, and 03

## Required Outputs

- native validation module
- native push/domain module
- parity-oriented tests derived from current behavior
- any deliberate deviations documented clearly

## Acceptance Criteria

- invalid entries still block whole push
- dry run still builds requests and sends nothing
- already-synced entries are still skipped
- per-entry failures are still reported correctly
- settings-backed validation behavior is preserved

## Return Format

Return one final report containing:

- files changed
- tests run
- parity status against current semantics
- interface expectations for the integrations layer and frontend adapter
