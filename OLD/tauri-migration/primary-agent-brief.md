# Primary Agent Brief

You are the primary OpenCode agent responsible for migrating this project from:

- Vite + React + Fastify + SQLite

to:

- Tauri 2 + React + Rust + SQLite

using the cleanest long-term desktop-native architecture.

## Your Role

You are the orchestrator and integrator, not just an implementer.

You should:

1. Read `tauri-migration-plan.md`.
2. Read `delegation/tauri-migration/workstream-index.md`.
3. Spawn sub-agents using the `delegation/tauri-migration/subagent-*.md` briefs.
4. Sequence the work by dependency wave.
5. Review and integrate sub-agent outputs.
6. Resolve conflicts between parallel workstreams.
7. Keep the repo in a coherent, buildable state.
8. Preserve existing behavior until explicit redesign phases.

## Primary Constraints

- The target architecture is Tauri-native, not Tauri plus a permanent Node sidecar.
- The internal Fastify server is not part of the final architecture.
- The migration must prioritize parity before UX reinvention.
- The notes-first, inferred-entry UX is deferred until after migration parity.
- Local AI summarization is also deferred until the core app is stable enough to support it cleanly.

## Your Deliverable Standard

For each completed wave, produce:

- a concise integration summary
- what landed
- what remains
- blockers
- exact verification status

Before merging sub-agent work, check:

- the work matches the target architecture
- the work does not reintroduce internal HTTP as the main runtime path
- the UI remains usable
- tests and builds still make sense for the current state

## Expected Execution Order

Use the waves from `workstream-index.md`.

Recommended order:

1. Wave 0: architecture/contracts + scaffold
2. Wave 1: persistence/settings + validation/push domain + integrations
3. Wave 2: frontend adapter and parity integration
4. Wave 3: packaging/enterprise hardening
5. Wave 4: AI infrastructure
6. Deferred later: notes-first UX overhaul

## Parallelization Guidance

You should parallelize where the dependency graph allows it.

Safe parallel work examples:

- architecture/contracts can begin alongside Tauri scaffold planning
- persistence/settings can run in parallel with integrations after contracts are stable
- packaging research can begin before full implementation, but packaging changes should not destabilize earlier waves

Unsafe parallel work examples:

- frontend adapter work before command contracts settle
- notes-first UX redesign during parity migration
- AI integration before app packaging and command boundaries stabilize

## Acceptance Standard For Sub-Agents

Require each sub-agent to return a single final report containing:

- summary of work completed
- exact files changed
- tests run
- unresolved questions
- contract changes introduced
- follow-ups for dependent workstreams

If a sub-agent returns architecture drift or broad speculative rewrites, reject that direction and steer it back to the plan.

## Non-Goals

Do not:

- preserve Fastify as the long-term internal transport
- combine migration with the notes-first redesign
- add unnecessary abstractions before parity exists
- over-engineer cross-platform packaging before macOS is solid

## Final Success Criteria

The migration is successful when:

- the app runs as a Tauri desktop app
- the internal Fastify server is no longer required
- local data lives in app-data storage
- credentials and settings are moving out of `.env`
- Jira/Tempo behavior is preserved
- dry-run and push behaviors are preserved
- the architecture is ready for later local AI and notes-first UX work
