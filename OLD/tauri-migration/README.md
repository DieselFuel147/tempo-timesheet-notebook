# Tauri Migration Delegation Pack

This folder is the execution-oriented companion to `tauri-migration-plan.md`.

Use these files when delegating the migration to a primary OpenCode agent that will spawn sub-agents.

## Files

- `primary-agent-brief.md`
- `workstream-index.md`
- `subagent-01-architecture-contracts.md`
- `subagent-02-tauri-scaffold.md`
- `subagent-03-rust-persistence-settings.md`
- `subagent-04-rust-validation-push-domain.md`
- `subagent-05-rust-integrations.md`
- `subagent-06-frontend-adapter-parity.md`
- `subagent-07-packaging-enterprise.md`
- `subagent-08-ai-infrastructure.md`
- `subagent-09-notes-first-ux-deferred.md`

## Recommended Usage

1. Give `primary-agent-brief.md` to the primary OpenCode agent.
2. Tell it to use `workstream-index.md` as the source of truth for ordering, dependencies, and parallelization.
3. Tell it to spawn sub-agents using the matching `subagent-*.md` briefs.
4. Tell it not to start the deferred notes-first UX work until migration parity is complete.

## Execution Waves

Wave 0:
- `subagent-01-architecture-contracts.md`
- `subagent-02-tauri-scaffold.md`

Wave 1:
- `subagent-03-rust-persistence-settings.md`
- `subagent-04-rust-validation-push-domain.md`
- `subagent-05-rust-integrations.md`

Wave 2:
- `subagent-06-frontend-adapter-parity.md`

Wave 3:
- `subagent-07-packaging-enterprise.md`

Wave 4:
- `subagent-08-ai-infrastructure.md`

Deferred:
- `subagent-09-notes-first-ux-deferred.md`

## Rules For The Primary Agent

- Preserve the current working app behavior during migration unless a brief explicitly says otherwise.
- Prefer thin adapters and small reversible steps.
- Do not start the notes-first UX redesign during migration execution.
- Reuse current behavior and tests as acceptance references.
- Keep one integration branch of work moving; do not let sub-agents diverge on competing architecture choices.
- Require every sub-agent to return:
  - files changed
  - key decisions made
  - tests run
  - open issues / blockers
  - exact follow-up expectations for dependent workstreams
