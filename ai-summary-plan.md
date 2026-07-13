# Local AI: on-device note → worklog summary via the "Suggest" button

## Context

The notebook captures freeform notes per time block and derives a worklog
**description** from them. Today that description is either the user's manual
`summaryOverride` or a dumb first-7-words `autoSummary` fallback
([shared/notebook.ts](shared/notebook.ts)). The per-block **Suggest** button
([App.tsx:401](src/App.tsx#L401)) is wired into the UI but disabled with
`title="Coming soon"`.

Goal: make **Suggest** produce a genuinely useful 1–2 sentence description from
that block's notes, using a **local-only, on-device LLM** — no network calls off
the machine. Scope is deliberately minimal: one manually-triggered command that
summarizes a single block's notes. No auto-suggestion, no commit/calendar
enrichment, no day-wide summarization.

**Decisions (confirmed with user):**
- Runtime = **bundled llama.cpp `llama-server` sidecar**: on-demand spawn + idle
  shutdown + stateless requests (matches the documented Phase 9 acceptance
  criteria in [tauri-migration-plan.md](tauri-migration-plan.md) and
  [delegation/tauri-migration/subagent-08-ai-infrastructure.md](delegation/tauri-migration/subagent-08-ai-infrastructure.md)).
- Model = **GGUF Gemma-3-1b**, lightweight quant (e.g. `gemma-3-1b-it-Q4_K_M.gguf`)
  as the default, but the model **path is user-configurable** in Settings.
  (Note: the user's preferred *MLX* Gemma build is not runnable under llama.cpp —
  llama.cpp is GGUF-only — so we use the GGUF build of the same model.)
- The **Fastify/web runtime and other legacy code have been removed**; this
  feature is **desktop (Tauri) only** and adds **no** web/HTTP fallback.

The delegation/migration docs predate the Tauri migration + UI rework; their
*concept* holds but concrete details are re-grounded against current code below.

## Architecture this slots into

- **Desktop-only, single path**: the legacy Fastify `/api` layer and the
  `isDesktopRuntime()` fork in [src/api.ts](src/api.ts) have been removed, so
  the AI call uses the Tauri `invoke` path only — **no web branch exists**,
  and there is no legacy server code to integrate with or extend.
- **Rust commands**: modules under [src-tauri/src/commands/](src-tauri/src/commands),
  registered in [lib.rs](src-tauri/src/lib.rs) `generate_handler!`, each returns
  `Result<T, AppError>`; async commands are supported (see
  [commands/jira.rs](src-tauri/src/commands/jira.rs)).
- **Shared state**: [AppState](src-tauri/src/state.rs) is `manage`d; holds `repo`
  + `secrets`. We add the AI sidecar manager here.
- **Errors**: [AppError](src-tauri/src/error.rs) already has `NotConfigured`,
  `NetworkError`, `ExternalApiError`, `InternalError` — reused, no new variants.
- **Settings**: mirrored TS/Rust merge logic in
  [shared/settings.ts](shared/settings.ts) + [src-tauri/src/core/settings.rs](src-tauri/src/core/settings.rs),
  persisted as one JSON blob in SQLite; edited in [src/Settings.tsx](src/Settings.tsx).

## Step 0 — persist this plan in the repo

First action on execution: copy this document to **`ai-summary-plan.md`** at the
repo root (sibling to `tauri-migration-plan.md` / `plan.md`) so it's
referenceable independent of the plan-mode scratch file.

## Plan — Milestone 1 — ✅ SHIPPED & verified

Working end-to-end feature using a locally-obtained `llama-server` + GGUF
Gemma-3-1b whose paths are set in Settings. Binary bundling and signing are
**deferred to Milestone 2** (below). Verified on Apple Silicon with
`brew install llama.cpp` + `ggml-org/gemma-3-1b-it-GGUF` (Q4_K_M);
45 Rust tests pass, `cargo check` + `tsc` clean.

The subsections below (1–4) are the as-built record. Two follow-ups shipped on
top of them — see **Follow-ups shipped** after section 4.

### 1. Settings: add an `ai` section (mirror existing pattern both sides)

- **[shared/settings.ts](shared/settings.ts)**: add
  `interface AiSettings { enabled: boolean; binaryPath: string; modelPath: string; idleTimeoutSecs: number }`,
  add `ai` to `Settings`, `defaultSettings`
  (`{ enabled: false, binaryPath: '', modelPath: '', idleTimeoutSecs: 300 }`),
  `cloneSettings`, and `mergeSettings` (add an `ai` merge block alongside the
  `connections` one). Non-secret → no keychain involvement.
- **[src-tauri/src/state.rs](src-tauri/src/state.rs)**: add `AiSettings` struct
  (`#[serde(rename_all = "camelCase")]`, matching defaults via `Default`) and an
  `ai: AiSettings` field on `Settings`.
- **[src-tauri/src/core/settings.rs](src-tauri/src/core/settings.rs)**: extend
  `merge_settings_value` with an `ai` object merge; optionally validate
  `idleTimeoutSecs >= 0` in `validate_settings`. Add a merge unit test.
- **[src/Settings.tsx](src/Settings.tsx)**: add an "AI (local summaries)" section
  — an enable toggle + text fields for binary path, model path, idle timeout —
  threaded through `DraftState`/`buildDraft`/save like the connection fields.

### 2. Rust AI module: sidecar lifecycle + summarization

New module `src-tauri/src/core/ai/` (declared in
[core/mod.rs](src-tauri/src/core/mod.rs)):

- **`mod.rs`** — public surface:
  - `AiConfig` built from `Settings.ai` (+ `require_ai()` returning
    `AppError::not_configured` when disabled or paths empty, mirroring
    `require_jira` in [core/config.rs](src-tauri/src/core/config.rs)).
  - `build_prompt(notes) -> (system, user)` and
    `sanitize_summary(raw) -> String` (trim, strip wrapping quotes, collapse to
    at most two sentences; scale to ~one sentence for short notes). Both
    **pure + unit-tested**.
  - `async fn summarize(manager, config, notes) -> Result<String, AppError>`.
- **`sidecar.rs`** — `SidecarManager` (held in `AppState`, behind
  `tokio::sync::Mutex`), storing `Option<Running { child, port, last_used }>`:
  - `ensure_running`: if none, pick a free port (bind `127.0.0.1:0`, read, drop),
    spawn `llama-server --model <path> --host 127.0.0.1 --port <port>
    --ctx-size <n>` via `tokio::process::Command` (kill_on_drop), then poll
    `GET /health` until ready or timeout.
  - `complete`: POST to `/v1/chat/completions` with system+user messages,
    `temperature ~0.2`, small `max_tokens` (~80); **stateless** each call → no
    persistent context. Reuse [core/http.rs](src-tauri/src/core/http.rs)
    `HttpClient`/`JsonRequest` (localhost, low retries).
  - Idle shutdown: a background tokio task kills the child once
    `now - last_used > idleTimeoutSecs` and clears the slot → true idle
    shutdown, process not always loaded.

Add tokio `process` feature in [Cargo.toml](src-tauri/Cargo.toml)
(`features = ["macros", "rt-multi-thread", "time", "process"]`). Store
`SidecarManager` on `AppState` and construct it in `AppState::new`.

### 3. Command + contract wiring

- **`src-tauri/src/commands/ai.rs`**: `#[tauri::command] pub async fn
  suggest_summary(text: String, state: State<'_, AppState>) -> Result<String, AppError>`
  — loads settings → `AiConfig::require_ai()` → `ai::summarize(...)`. Register in
  [commands/mod.rs](src-tauri/src/commands/mod.rs) + `generate_handler!` in
  [lib.rs](src-tauri/src/lib.rs).
- **[shared/tauri-contracts.ts](shared/tauri-contracts.ts)**: add
  `suggestSummary: 'suggest_summary'` to `tauriCommandNames`, a
  `SuggestSummaryInput { text: string }`, and the `suggest_summary` contract
  entry (`output: string`).
- **[src/api.ts](src/api.ts)**: add `suggestSummary(text)` that calls
  `invokeCommand(tauriCommandNames.suggestSummary, { text })` directly — **no
  `isDesktopRuntime()` fork, no web branch** (the legacy web layer has been removed).

### 4. Frontend: enable the button

- **[src/App.tsx](src/App.tsx)** `NotebookEditorPanel`: drop `disabled`/
  "Coming soon" from the Suggest button; add an `onSuggest(blockId)` prop and a
  per-block pending state (single `suggestingId: string | null` in `App`, one at
  a time). Disable while pending or when `block.text` is blank.
- `App.handleSuggest(id)`: read the block's `text`, `await api.suggestSummary`,
  and on success populate the editable Summary field via the existing
  `handleSummaryChange(id, suggestion)`. Surface errors through the existing
  `setError`. The suggestion lands in `summaryOverride` — user can edit before
  pushing to Tempo.

### Follow-ups shipped (on top of 1–4)

- **Configurable system prompt.** `AiSettings.systemPrompt` added both sides.
  The built-in text lives in two must-stay-identical constants:
  `DEFAULT_SYSTEM_PROMPT` ([core/ai/mod.rs](src-tauri/src/core/ai/mod.rs)) and
  `DEFAULT_AI_SYSTEM_PROMPT` ([shared/settings.ts](shared/settings.ts)).
  `build_prompt(system_prompt, notes)` now takes the prompt; `require_ai` falls
  back to the default when the field is blank. Settings UI has a multiline field
  + "Reset prompt to default" button.
- **Model loaded/unloaded status in the bottom bar.** `SidecarManager::is_running()`
  (`try_wait`, reaping a dead child) → `ai_status` command → `api.aiStatus()`.
  [App.tsx](src/App.tsx) polls every 4 s **only while `settings.ai.enabled`** and
  renders an `ai · loaded` / `ai · unloaded` dot next to the day stats. Contract:
  `AiStatus { running: boolean }` in [tauri-contracts.ts](shared/tauri-contracts.ts);
  Rust `AiStatus` in [state.rs](src-tauri/src/state.rs).

Final `AiSettings` shape: `{ enabled, binaryPath, modelPath, idleTimeoutSecs, systemPrompt }`.
Registered AI commands: `suggest_summary`, `ai_status`.

## Plan — Milestone 2 (NEXT SESSION — bundling, model delivery, signing)

> Everything above ships and runs today with a **user-supplied** binary + model.
> Milestone 2 makes the app **self-contained and distributable** so a user
> doesn't have to `brew install llama.cpp` or download a GGUF by hand. Tackle the
> three tracks below roughly in order; A is independently shippable and unblocks
> real dogfooding, B removes the last manual step, C is required only for
> distribution beyond your own machine.

### Guardrails carried over from Milestone 1

- Desktop-only; no web/Fastify path.
- Keep `binaryPath` / `modelPath` **overridable** — bundling only changes their
  *defaults*. A power user pointing at their own `llama-server`/GGUF must still work.
- On-demand spawn + idle-kill + stateless requests stay exactly as-is; this
  milestone changes only *where the binary and model come from*, not the
  lifecycle in [core/ai/sidecar.rs](src-tauri/src/core/ai/sidecar.rs).

### Track A — bundle `llama-server` as a Tauri sidecar (`externalBin`)

Goal: ship the binary inside the app so `binaryPath` can default to it.

1. **Obtain per-target binaries.** Grab prebuilt `llama-server` from the
   [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) (or build
   from source) for each target you ship. Tauri sidecars are resolved by
   **target triple suffix**, so name them exactly:
   - `llama-server-aarch64-apple-darwin` (Apple Silicon)
   - `llama-server-x86_64-apple-darwin` (Intel mac, if supported)
   - `llama-server-x86_64-pc-windows-msvc.exe` (Windows)
   Confirm your triple with `rustc -Vv | grep host`.
   ⚠️ `llama-server` is **not statically linked** — it needs its backend/runtime
   libraries (Metal `.metallib` / `ggml`/`llama` dylibs on macOS, `.dll`s on
   Windows). A bare binary will fail to launch. Options: (a) build a static/
   self-contained variant, or (b) ship the companion libs as `bundle.resources`
   and set the library search path (`DYLD_*` is blocked under hardened runtime —
   prefer co-locating libs next to the binary or an `@rpath`/`--lib` arg). This
   is the single biggest risk in the milestone — spike it first with a
   hand-copied binary before wiring config.

2. **Declare the sidecar.** In [tauri.conf.json](src-tauri/tauri.conf.json):
   ```jsonc
   "bundle": {
     "externalBin": ["binaries/llama-server"],   // Tauri appends the triple
     "resources": ["resources/llama/**"]           // if shipping companion libs
   }
   ```
   Put the triple-named binaries in `src-tauri/binaries/`.

3. **Resolve the bundled path at runtime.** Add
   `tauri-plugin-shell` (gives `app.shell().sidecar("llama-server")`) **or**
   resolve the resource path via `app.path().resolve("binaries/llama-server-<triple>", BaseDirectory::Resource)`.
   Currently [core/ai/sidecar.rs](src-tauri/src/core/ai/sidecar.rs) spawns with
   raw `tokio::process::Command::new(binary_path)` and has **no `AppHandle`** —
   so either (a) pass the resolved default path into `SidecarManager` when
   `binaryPath` is blank (store an `AppHandle` on `AppState`/`SidecarManager` and
   compute the default in `require_ai`/command layer), or (b) switch spawning to
   the shell plugin's sidecar command. Prefer (a) to keep the direct-process
   lifecycle (kill-on-idle, `try_wait`) unchanged.
   Net change to config semantics: **blank `binaryPath` → bundled sidecar**;
   non-blank → user override (today blank just errors via `require_ai`).

4. **Verify:** fresh `npm run tauri:build`, install the bundle, leave `binaryPath`
   blank, confirm Suggest spawns the *bundled* server (check the port/process),
   and that idle-kill still fires.

### Track B — model delivery

Goal: remove the manual `huggingface-cli download` step. `modelPath` already
supports any location, so this only changes the default source.

- **Option B1 (recommended): download-on-first-use.** On first Suggest with a
  blank `modelPath`, download a pinned GGUF (default `gemma-3-1b-it-Q4_K_M.gguf`
  from `ggml-org/gemma-3-1b-it-GGUF`) into the app-data dir
  (`app.path().app_data_dir()`, already used for `tempo.db` in
  [state.rs](src-tauri/src/state.rs)), then set that as the effective path.
  Needs: a download command with **progress events** (Tauri `Channel` or
  `emit`), checksum verification, resumable/retry, and UI in the AI settings
  section ("Download model (~800 MB)" + progress). This is the only place the AI
  feature makes an **outbound network call** — document it (see Track C / PACKAGING).
- **Option B2: bundle a tiny GGUF as a resource.** Simplest, but adds ~500–800 MB
  to the installer and bakes in one quant. Only sensible for the very smallest
  model. Probably not worth it vs B1.
- Either way keep `modelPath` override working, and surface a clear
  `NotConfigured`/download-prompt state when no model is present (today
  `require_ai` just errors on blank path).

### Track C — signing, notarization, hardening (required to distribute)

Per [PACKAGING.md](PACKAGING.md) "Future Sidecar Constraints" + migration Phase 10.
Bundled child processes are exactly what EDR/`hardenedRuntime` scrutinize.

- **macOS** (`hardenedRuntime: true` is already set in
  [tauri.conf.json](src-tauri/tauri.conf.json)):
  - Developer ID sign the app **and** the embedded `llama-server` (and any
    companion dylibs), then notarize + staple.
  - Metal library loading almost certainly needs the entitlement
    `com.apple.security.cs.disable-library-validation` (and possibly
    `...cs.allow-jit` / `allow-unsigned-executable-memory` depending on the
    backend). Add an entitlements plist and reference it from the macOS bundle
    config.
  - Spawning a child under hardened runtime is fine once the child is signed with
    the same team ID; unsigned/ad-hoc children get killed.
- **Windows:** sign the installer *and* `llama-server.exe` (unsigned child +
  SmartScreen friction). NSIS `currentUser` install is already configured.
- **Docs:** update [PACKAGING.md](PACKAGING.md) outbound-domain + EDR notes —
  inference is 100% localhost (no network), the *only* outbound call is the
  optional model download in Track B (HuggingFace CDN). Call that out explicitly.

### Milestone 2 verification checklist

- Clean machine (no Homebrew llama.cpp, no pre-downloaded model): install the
  signed bundle → enable AI (blank paths) → download model → Suggest works.
- Gatekeeper: bundle passes `spctl -a -vvv` and `stapler validate`; launches
  without the "unidentified developer" / "damaged app" prompt.
- Idle-kill + respawn still work with the bundled binary.
- User override still works: point `binaryPath`/`modelPath` at custom locations.
- `cargo test` / `cargo check` / `tsc` stay clean.

### Suggested Milestone 2 file touch-list

- [tauri.conf.json](src-tauri/tauri.conf.json) — `externalBin`, `resources`,
  macOS entitlements ref
- `src-tauri/binaries/llama-server-<triple>[.exe]` (+ `resources/llama/**` libs)
- `src-tauri/entitlements.plist` (new)
- [core/ai/sidecar.rs](src-tauri/src/core/ai/sidecar.rs) / [state.rs](src-tauri/src/state.rs)
  — `AppHandle` access + resolved default binary path; model-download command
- [commands/ai.rs](src-tauri/src/commands/ai.rs) — `download_model` (+ progress channel)
- [shared/tauri-contracts.ts](shared/tauri-contracts.ts), [src/api.ts](src/api.ts),
  [src/Settings.tsx](src/Settings.tsx) — download UI + progress
- `Cargo.toml` — `tauri-plugin-shell` if chosen; download deps if not reusing `reqwest`
- [PACKAGING.md](PACKAGING.md) — sidecar signing + outbound-domain docs

---

### (original Milestone 2 sketch — superseded by the tracks above)

Bundling + distribution, per [PACKAGING.md](PACKAGING.md) "Future Sidecar
Constraints" and migration Phase 10:
- Ship `llama-server` as a Tauri `externalBin` (target-triple-named binaries in
  `src-tauri/binaries/`, declared in [tauri.conf.json](src-tauri/tauri.conf.json));
  resolve its path from resources so `binaryPath` can default to the bundled one.
- Decide model delivery (download-on-first-use into app-data vs bundle the tiny
  GGUF Gemma-3-1b) — `modelPath` already supports a custom location.
- macOS: `hardenedRuntime: true` means the sidecar must be signed + notarized and
  likely needs `com.apple.security.cs.disable-library-validation` (Metal libs);
  Windows: sign the binary. Document outbound-network posture (none at inference
  time) for EDR review.

## Files touched (Milestone 1, as-built incl. follow-ups)

- **new (repo)**: `ai-summary-plan.md` (Step 0)
- `shared/settings.ts` (`AiSettings` incl. `systemPrompt` + `DEFAULT_AI_SYSTEM_PROMPT`),
  `shared/tauri-contracts.ts` (`suggest_summary`, `ai_status`, `AiStatus`)
- `src/api.ts` (`suggestSummary`, `aiStatus`), `src/Settings.tsx` (AI section +
  system-prompt field), `src/App.tsx` (Suggest button + status-bar poll)
- `src-tauri/Cargo.toml` (tokio `process`), `src-tauri/src/lib.rs`,
  `src-tauri/src/state.rs` (`AiSettings`, `AiStatus`)
- `src-tauri/src/core/mod.rs`, `src-tauri/src/core/settings.rs`
- **new (rust)**: `src-tauri/src/core/ai/mod.rs` (`DEFAULT_SYSTEM_PROMPT`,
  `AiConfig`, `require_ai`, `build_prompt`, `sanitize_summary`),
  `src-tauri/src/core/ai/sidecar.rs` (`SidecarManager`, `is_running`),
  `src-tauri/src/commands/ai.rs` (`suggest_summary`, `ai_status`)

## Verification

- **Rust**: `cargo test` (new pure-unit tests for `build_prompt`,
  `sanitize_summary`, `require_ai` not-configured, `ai` settings merge) and
  `cargo check` clean.
- **TS**: `npm run typecheck` clean.
- **End-to-end (user runs — do not auto-start the app, per
  [[verification-workflow]])**: `npm run tauri:dev`; in Settings, enable AI and
  set the `llama-server` binary path + a GGUF Gemma-3-1b model path; on a block
  with a few lines of notes, click **Suggest** and confirm a 1–2 sentence
  description populates the Summary field and is editable. Check: short notes →
  one sentence; longer notes → up to two; the sidecar process exits after the
  idle timeout; a second Suggest respawns it cleanly. With AI disabled/paths
  blank, Suggest shows a clear "not configured" error.

## Out of scope

Auto-suggestion on save, day-wide summaries, commit/calendar enrichment, remote
models, and the Milestone 2 bundling/signing work.
