# Tempo Timesheet Tool — UI / UX Roadmap

> Local product/design implementation backlog for frontend polish and premium UX.
> Intended for small, self-contained coding passes that can be handled one item at a time.
> Last updated: 2026-07-11

## Current baseline

The app already has the right core workflow:

- compact day view with row-based time entry editing
- live validation with day- and entry-level issues
- notes side panel
- dry run preview and push to Tempo
- dark Material UI foundation

What it lacks is mostly:

- stronger visual hierarchy
- faster expert workflows
- clearer save/sync confidence states
- richer feedback around validation, totals, and push readiness
- more intentional premium-feeling interactions

## How to use this file

- Start with `Phase 1` in order unless dependencies say otherwise.
- Each roadmap item is written to be implemented in a focused PR/task.
- Prefer small vertical slices over broad redesigns.
- Preserve the current compact power-user workflow; polish should not slow entry.

## Effort / impact scale

- Effort: `S` = small, `M` = medium, `L` = large
- Impact: `H` = high, `M` = medium, `L` = low

## Phase 1 — Start Here

These are the best first five improvements for premium feel per unit of effort.

### UX-01 — Day health header

- Status: completed
- Effort: `S`
- Impact: `H`
- Why: The app already computes total hours, error count, warnings, and unsynced entries, but the user has to infer overall day status from scattered UI.
- Goal: Add a compact summary header above the main entries list.
- Include:
- total logged hours
- target range or remaining hours from validation settings
- error and warning counts
- synced vs unsynced count
- a clear status pill such as `Ready to push`, `Needs fixes`, or `All synced`
- Acceptance criteria:
- the summary is visible without scrolling on desktop
- the summary collapses cleanly on mobile
- the push readiness state matches the existing validation logic
- no new backend/API work is required
- Likely files:
- `src/App.tsx`
- `src/theme.ts`

### UX-02 — Ticket color accents and visual grouping

- Status: backlog
- Effort: `S`
- Impact: `H`
- Why: Rows are functional but visually flat. Subtle color identity makes scanning easier and immediately lifts the UI.
- Goal: Give each ticket or ticket prefix a stable accent color and use it to improve row readability.
- Include:
- subtle accent rail or chip color per row
- visually group consecutive rows for the same ticket/project where practical
- preserve existing error/warning affordances
- Acceptance criteria:
- repeated tickets are visually recognizable at a glance
- validation colors still win over decorative accents when there is an issue
- colors remain readable in the current dark theme
- Likely files:
- `src/EntryRow.tsx`
- `src/App.tsx`
- `src/theme.ts`

### UX-03 — Save and sync microstates

- Status: backlog
- Effort: `M`
- Impact: `H`
- Why: Autosave exists, but the UI does not fully communicate whether a change is pending, saved, synced, or failed.
- Goal: Make saving and syncing feel trustworthy.
- Include:
- per-row state such as `Saving...`, `Saved`, `Sync failed`, `Tempo synced`
- day-level `All changes saved` or `Unsaved changes` indicator
- optional success pulse or subtle state transition after push refresh
- Acceptance criteria:
- editing a row produces visible pending/saved feedback
- save failures are shown at row or day level, not only as generic alerts
- synced rows remain clearly distinct from merely saved rows
- Likely files:
- `src/App.tsx`
- `src/EntryRow.tsx`
- `shared/types.ts` only if extra local UI state needs type cleanup

### UX-04 — Command palette and keyboard shortcuts

- Status: backlog
- Effort: `M`
- Impact: `H`
- Why: This is a repetitive operator workflow. Premium feel here comes from speed and fluency, not decoration.
- Goal: Add a lightweight command surface for common actions.
- Include:
- `Cmd+K` or `Ctrl+K` command palette
- actions for today/previous/next day, add entry, dry run, push, settings
- a first pass of keyboard shortcuts such as `N`, `[`, `]`, and `Cmd+Enter`
- visible shortcut hints where appropriate
- Acceptance criteria:
- the palette is reachable entirely by keyboard
- commands respect disabled states like blocked push
- keyboard shortcuts do not break text input editing
- Likely files:
- `src/App.tsx`
- new component under `src/` if needed

### UX-05 — Visual day timeline / day map

- Status: backlog
- Effort: `L`
- Impact: `H`
- Why: The app already models a day as time blocks and gaps. A visual timeline would make gaps, overlaps, and pacing instantly understandable.
- Goal: Add a compact visual timeline for the current day.
- Include:
- visible blocks for each entry positioned by start/end time
- visible gaps between entries
- overlap highlighting
- click-to-focus corresponding row
- start with read-only visualization; dragging can come later
- Acceptance criteria:
- the timeline reflects current row edits live
- gaps and overlaps are easier to detect than in the plain list alone
- mobile layout degrades gracefully, including the option to hide the timeline
- Likely files:
- `src/App.tsx`
- new timeline component under `src/`

## Phase 2 — High-Leverage Product Polish

These keep the same workflow but make the app feel much smarter and more complete.

### UX-06 — Smart autofill and repeat patterns

- Status: backlog
- Effort: `M`
- Impact: `H`
- Goal: Reduce repetitive entry work by predicting the next likely action.
- Include:
- smarter default times for new entries
- quick action to repeat yesterday's structure
- recent ticket and summary suggestions
- optional `fill remaining day` helper based on target hours
- Acceptance criteria:
- suggestions are optional and easy to dismiss
- default behavior remains predictable
- no accidental overwrites of existing rows

### UX-07 — Pre-push review mode

- Status: backlog
- Effort: `M`
- Impact: `H`
- Goal: Add a polished preflight surface before pushing to Tempo.
- Include:
- group planned logs by ticket
- show total time per ticket and overall push count
- highlight blocked items and suspicious summaries
- convert current dry run preview into something more review-oriented
- Acceptance criteria:
- the user can review what will be sent without parsing raw payload blocks
- blocked states are clearer than they are today
- raw payload view still remains available for debugging

### UX-08 — Richer row actions: duplicate, split, convert gap

- Status: backlog
- Effort: `M`
- Impact: `H`
- Goal: Make common row manipulations one-click operations.
- Include:
- duplicate row
- split one row into two rows
- convert visible gap into a new row
- cleaner delete affordance than the current top-right icon
- Acceptance criteria:
- actions preserve data and time math correctly
- split/duplicate actions update local validation immediately
- controls stay compact and do not clutter every row

### UX-09 — Weekly strip / heatmap navigator

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Make navigation across nearby days much faster and more informative.
- Include:
- week strip or mini heatmap above the day view
- color-coded day state such as empty, partial, warning, ready, synced
- click a day to jump directly
- Acceptance criteria:
- nearby day status is visible without opening the date picker
- selected day is obvious
- the control works on narrow screens

### UX-10 — Structured notes panel

- Status: backlog
- Effort: `S`
- Impact: `M`
- Goal: Make the notes area feel more intentional and useful without changing its local-only nature.
- Include:
- improved notes card styling and hierarchy
- optional quick sections like links or follow-ups
- auto-detect URLs and render them more cleanly if low effort
- Acceptance criteria:
- notes remain fast freeform text first
- the panel feels like part of the product, not a placeholder textbox

## Phase 3 — Premium Visual and Interaction Pass

These are worthwhile once the top workflow improvements are in place.

### UX-11 — Motion and transition pass

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Add subtle UI transitions that reinforce state changes.
- Include:
- animated row insertion/removal
- smoother validation appearance/disappearance
- success/failure feedback transitions after dry run and push
- Acceptance criteria:
- animations are short and restrained
- reduced-motion users are respected

### UX-12 — Date navigation redesign

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Upgrade the current icon-button-plus-picker header into a more cohesive navigation control.
- Include:
- cleaner arrangement for prev/next/today
- better visual emphasis for the selected date
- optional integration with the weekly strip
- Acceptance criteria:
- faster day switching on desktop
- no regression in mobile usability

### UX-13 — Empty, partial, and loading states

- Status: backlog
- Effort: `S`
- Impact: `M`
- Goal: Replace plain placeholder text with actionable states.
- Include:
- richer empty-day state with quick actions
- better partial/incomplete guidance
- more polished loading skeletons instead of bare `Loading...`
- Acceptance criteria:
- new users understand what to do on an empty day
- loading feels stable and intentional

### UX-14 — Dry run payload viewer polish

- Status: backlog
- Effort: `S`
- Impact: `M`
- Goal: Keep the technical trust of the current payload preview, but present it more cleanly.
- Include:
- collapsible request cards
- syntax-highlight-like styling or clearer formatting
- copy request/payload button
- clear redaction indicator for auth
- Acceptance criteria:
- power users can still inspect exact request details
- the viewer no longer dominates the side panel visually

### UX-15 — Inline Jira ticket metadata

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Show ticket title and maybe status near the selected ticket so the user can confirm they logged against the right issue.
- Include:
- render ticket summary inline after selection
- optional status badge if data is already available or cheap to fetch
- Acceptance criteria:
- ticket context appears quickly enough to be useful
- it does not make the row significantly taller in the default state

## Phase 4 — Advanced Workflow Enhancements

These are strong premium features, but they are more complex or depend on earlier polish.

### UX-16 — Editable timeline with drag-resize

- Status: backlog
- Effort: `L`
- Impact: `H`
- Goal: Make the timeline interactive so the user can adjust entries visually.
- Include:
- drag start/end handles
- snap to 5/10/15-minute increments
- collision/overlap handling
- Acceptance criteria:
- dragging updates row values live
- timeline edits and form edits stay in sync
- validation remains accurate during and after drag

### UX-17 — Multi-select and bulk row actions

- Status: backlog
- Effort: `L`
- Impact: `M`
- Goal: Speed up edits across many rows.
- Include:
- select multiple rows
- assign ticket to many rows
- bulk delete or bulk retime where sensible
- Acceptance criteria:
- selection model is clear and keyboard accessible
- bulk actions are hard to trigger accidentally

### UX-18 — Insights drawer

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Add lightweight analytics that help users spot patterns in their logging habits.
- Include:
- most-used tickets this week
- gap-heavy days
- admin time percentage
- average daily total compared to thresholds
- Acceptance criteria:
- insights are actionable, not decorative
- the core day-entry workflow remains primary

### UX-19 — Draft recovery / offline resilience

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Make the app feel robust when saves fail or the browser reloads mid-edit.
- Include:
- local draft recovery for unsaved edits
- visible `recovered changes` state when applicable
- clearer distinction between local-only pending edits and server-saved state
- Acceptance criteria:
- draft recovery never silently overwrites server state
- failure cases remain understandable

### UX-20 — AI-assisted summary suggestions

- Status: backlog
- Effort: `L`
- Impact: `M`
- Goal: Suggest concise worklog summaries from notes, recent activity, or repeated patterns.
- Include:
- per-row summary suggestion entry point
- transparent editable result, never auto-applied
- privacy-conscious source handling
- Acceptance criteria:
- suggestions are optional and easy to reject
- the user can see what context informed the suggestion

## Phase 5 — Setup and Trust Improvements That Affect UX

These are not purely visual, but they improve perceived quality and reduce friction.

### UX-21 — In-app credentials and connection setup

- Status: backlog
- Effort: `L`
- Impact: `H`
- Goal: Remove manual `.env` editing for normal users.
- Include:
- settings screen for Jira and Tempo credentials
- connection test actions
- clear explanation of what is stored locally
- Acceptance criteria:
- a user can get the app working without editing environment files manually
- secrets are handled carefully and not exposed in the frontend bundle

### UX-22 — Permissions and scope explainer

- Status: backlog
- Effort: `M`
- Impact: `M`
- Goal: Build user trust by showing exactly what each integration can read or write.
- Include:
- plain-language permission descriptions
- which features depend on which credentials
- Acceptance criteria:
- a user can understand the security model without reading code or docs

### UX-23 — Better app identity and naming pass

- Status: backlog
- Effort: `S`
- Impact: `L`
- Goal: Replace the generic `Timesheet` label with a clearer or more distinctive product identity.
- Include:
- app name exploration
- header naming update
- favicon/app metadata if desired
- Acceptance criteria:
- the name feels intentional and distinct from Tempo itself

## Suggested execution order after Phase 1

1. `UX-06` Smart autofill and repeat patterns
2. `UX-07` Pre-push review mode
3. `UX-08` Richer row actions
4. `UX-09` Weekly strip / heatmap navigator
5. `UX-15` Inline Jira ticket metadata
6. `UX-13` Empty, partial, and loading states
7. `UX-14` Dry run payload viewer polish
8. `UX-10` Structured notes panel
9. `UX-11` Motion and transition pass
10. `UX-12` Date navigation redesign

## Good implementation principles

- Keep the compact row-entry model; do not turn the product into a bulky dashboard.
- Prefer progressive enhancement over large rewrites.
- Maintain keyboard friendliness for every new interaction.
- Respect the current dark theme and avoid decorative clutter.
- Reuse existing validation and push-readiness logic instead of duplicating rules.

## Candidate foundation tasks if implementation gets messy

These are not user-facing roadmap items, but may be worth doing if multiple UI passes start colliding:

- extract a small `DaySummary` component from `App.tsx`
- extract a `PushPanel` / `ReviewPanel` from the current sidebar
- centralize derived day state such as `errorCount`, `warningCount`, `unsyncedCount`, `pushDisabled`
- add a small UI state model for row save status instead of ad hoc local flags
- add lightweight component tests for critical keyboard and timeline interactions
