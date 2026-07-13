# Sub-Agent 06 - Frontend Adapter and Parity

## Mission

Replace the frontend's HTTP API usage with Tauri command invocation while preserving the current UI behavior as much as possible.

## Scope

You own:

- replacing `src/api.ts` transport assumptions
- wiring frontend actions to Tauri commands
- preserving current day-view UX during migration
- introducing minimal new async/error state where necessary

You do not own:

- large UI redesign
- command-contract redesign unless blocked
- packaging

## Inputs

- `src/App.tsx`
- `src/EntryRow.tsx`
- `src/Settings.tsx`
- `src/TicketField.tsx`
- outputs from Sub-Agents 01 through 05

## Required Outputs

- command-backed frontend adapter
- functioning UI flows for the current app model
- minimal UI changes required for parity
- verification that current core behaviors are still usable from the frontend

## Acceptance Criteria

- core user flows no longer depend on internal REST fetches
- current editing, notes, settings, dry-run, and push interactions still work or have explicitly documented gaps
- no broad UX rewrite is introduced under the guise of transport migration

## Return Format

Return one final report containing:

- files changed
- user flows now working
- remaining broken or unimplemented flows
- tests or manual verification run
- any frontend cleanup that should happen after parity
