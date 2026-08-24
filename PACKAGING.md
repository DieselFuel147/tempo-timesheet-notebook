# Packaging And Enterprise Release Notes

This project runs as a Tauri 2 desktop app. Credentials are entered in-app and stored in the OS keychain via the native secret store; there is no server component and no `.env`-backed credential model.

These notes document the current packaging stance for realistic internal distribution, with macOS first and Windows second.

## Current Packaging Position

- Primary release target: macOS
- Secondary release target after validation: Windows
- Linux packaging is intentionally not part of the near-term enterprise path
- Auto-updates are enabled via `tauri-plugin-updater` against GitHub Releases, using Tauri's own minisign signing (not OS code signing)
- No AI sidecar is bundled today
- Credentials are entered in-app and stored in the OS keychain (no environment variables)

## Repo State That Helps Packaging Already

- The runtime is fully Tauri-native; there is no separate server process to package or run.
- The native database lives under the Tauri app-data directory, not a repo-local path.
- The frontend capability surface is still minimal (`core:default`, `updater:default`, and `process:allow-restart` only).
- Updater artifacts are produced with Tauri's minisign signing; the private key lives only in GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`) and the public key is pinned in `tauri.conf.json`.

## Release Artifact Decisions

The Tauri bundle config is intentionally constrained to the targets we can credibly support next:

- macOS: `.app` and `.dmg`
- Windows: NSIS installer

We are not enabling:

- MSI packaging yet
- sidecar packaging config
- per-machine Windows install defaults

Reasoning:

- macOS requires the most immediate hardening work for enterprise-friendly installs
- NSIS gives enough flexibility for an initial Windows path without committing to MSI fleet-management expectations yet
- OS-level signing and notarization remain the outstanding trust/distribution problem; updater signing (Tauri minisign) is separate from that and already in place

## Updater Design

The built-in updater uses `tauri-plugin-updater` pointed at GitHub Releases:

- Update feed: `https://github.com/DieselFuel147/tempo-timesheet-notebook/releases/latest/download/latest.json`
- The release workflow builds with `createUpdaterArtifacts: true`, producing a signed `.app.tar.gz` (macOS updater payload), uploads it alongside the DMG, and generates/attaches the `latest.json` manifest from the `.sig` output.
- The app checks at launch, shows a header badge when an update exists, and offers download/install/restart from Settings.
- Tauri's minisign signature verifies update payloads independently of Apple code signing. An unsigned app can therefore self-update once a user has launched it past Gatekeeper on first install.
- The private signing key is generated locally (`tauri signer generate`) and must never be committed. Losing it means shipping a new public key in a manually installed release.
- Windows updates will use the NSIS installer payload once a Windows build job is added to the manifest; SmartScreen friction for unsigned installers still applies.

## macOS Release Checklist

Treat this as the minimum serious distribution path for any broad internal use.

1. Prepare app identity and assets.
2. Keep the generated platform icon set current, including `.icns` and `.ico`, whenever the source artwork changes.
3. Confirm the bundle identifier remains stable: `com.dieselmitchell.tempotimesheettool`.
4. Keep the minimum macOS version at `13.0` unless there is a real support requirement to lower it.
5. Build unsigned local packages first with `npm run tauri:build`.
6. Enroll in the Apple Developer Program.
7. Create a `Developer ID Application` certificate for outside-the-App-Store distribution.
8. Import the certificate into the build Mac keychain or CI keychain.
9. Configure signing via Tauri environment variables or `bundle.macOS.signingIdentity`.
10. Notarize every release build.
11. Staple notarization tickets to the final `.app` and `.dmg`.
12. Install and launch the notarized build on a clean Mac that has never seen the app before.
13. Validate on at least one managed corporate Mac if possible.

### macOS Signing Requirements

- Developer ID signing is required for a credible non-App-Store distribution path.
- Notarization is required if using a Developer ID certificate.
- Hardened runtime should remain enabled.
- Any future bundled sidecar binaries must also be signed and included in notarization.

### macOS Operational Constraints

- Unsigned or merely ad-hoc-signed builds are acceptable only for local development or narrow evaluator use.
- Managed devices may still block or quarantine builds until security tooling reputation is established.
- If corporate TLS interception is in use, the corporate root CA must be installed in the macOS system trust store because the Rust runtime uses the OS trust store.

## Windows Release Checklist

Windows support should follow macOS stabilization, not race ahead of it.

1. Keep the first Windows installer target as NSIS.
2. Keep the first installer mode as per-user (`currentUser`).
3. Build with the default WebView2 bootstrapper flow first.
4. Sign the installer and app binaries before any broad internal sharing.
5. Test on a clean Windows machine that does not already have a developer toolchain installed.
6. Confirm the WebView2 bootstrapper can download successfully on the target network.
7. If the environment is offline or locked down, plan a separate release variant using an offline WebView2 strategy rather than overloading the default path.
8. Expect SmartScreen reputation warnings until code-signing reputation is established or distribution happens through a trusted internal channel.

### Windows Installer Choice

NSIS is the right near-term default because:

- Tauri supports it well
- it fits a user-local install model
- it avoids prematurely committing to MSI packaging and enterprise deployment expectations

MSI should be considered later only if internal deployment tooling explicitly requires it.

### Windows WebView2 Choice

The current recommended default is Tauri's download bootstrapper mode.

Use it when:

- target users have normal outbound access to Microsoft WebView2 distribution endpoints
- the environment is not strictly offline

Do not assume it works everywhere. Restricted enterprise environments may require:

- preinstalled Evergreen WebView2 Runtime
- an offline installer strategy
- a Windows-specific packaging override later

### Windows Signing Expectations

- Sign the NSIS installer and shipped executable.
- EV certificates provide the best SmartScreen behavior, but are not a day-one requirement for small internal rollout.
- OV certificates are acceptable for initial internal distribution, but SmartScreen warnings may persist while reputation builds.
- If builds are signed outside a native Windows machine, use a custom sign command or managed signing service.

## Enterprise Constraints To Document Up Front

### Credentials And Secrets

- Jira and Tempo tokens are entered in-app and held in the OS keychain via the native secret store.
- No credentials live in files or environment variables, which suits internal distribution.

### Network Egress

Current app traffic is limited to Jira and Tempo API access.

Document for IT reviewers:

- Jira base URL used by the deployment
- `https://api.tempo.io`
- updater endpoints: `github.com` and `objects.githubusercontent.com` (release asset download)
- whether any future release adds model-download or AI runtime endpoints

Today the answer for AI is simple:

- no AI sidecar is bundled
- no model download path is part of the release
- no AI-related external network call is required

### TLS Interception And Trust Stores

- The Tauri/Rust runtime uses the operating system trust store.
- On managed networks, corporate root CAs must be present in the system trust store.
- Cert or proxy failures should be tested on representative corporate machines before broad rollout.

### Local Data Placement

- SQLite data is stored in the Tauri app-data directory.
- This is the right packaging posture for desktop apps.
- Existing repo-local SQLite data is not automatically migrated today.

This means initial packaged releases need a clear expectation:

- existing local web-app data will not appear automatically in the desktop app
- a migration/import story is still pending

### Logging And Supportability

Current release risk is higher because there is not yet a documented crash-log or structured diagnostics path for internal support.

Before broad distribution, define:

- where runtime logs go on macOS and Windows
- what sensitive fields must be redacted
- how users can export diagnostics safely for support

### Future Sidecar Constraints

No sidecar ships today, but release owners should treat future sidecar work as a packaging/security milestone, not just a feature milestone.

If a local AI runtime is added later:

- sidecar binaries must be signed on both macOS and Windows
- sidecars must be included in notarization on macOS
- sidecar behavior should be documented for EDR review
- model placement should stay outside the app bundle unless size and update behavior are clearly acceptable

## Recommended Release Phasing

### Phase 1: Developer And Narrow Internal Builds

- Build local `.app` and `.dmg` artifacts
- No updater
- No Windows commitment beyond smoke builds
- Use only for engineering validation and packaging rehearsal

### Phase 2: Signed macOS Internal Release

- Developer ID signed
- notarized
- stapled artifacts
- tested on at least one managed Mac
- release notes include network, secret, and data-path caveats

This is the first phase that is realistic for broader internal evaluation.

### Phase 3: Signed Windows Internal Release

- NSIS installer
- code-signed binaries
- tested with WebView2 bootstrapper behavior on target networks
- documented SmartScreen expectations

### Phase 4: Only After Trust Pipeline Stabilizes

- OS code signing and notarization for macOS
- signed Windows builds
- sidecar packaging
- consider MSI or other enterprise deployment formats

## What Should Not Be Added Yet

- no AI runtime packaging
- no complicated dual-installer Windows strategy in the default config
- no machine-wide Windows install default

## Pre-Distribution Gate

Before any broad internal distribution, the release owner should be able to answer yes to all of these:

1. Is the macOS build signed, notarized, and stapled?
2. Have clean-machine installs been tested on the intended OS versions?
3. Are Jira and Tempo outbound domains documented for IT review?
4. Has TLS interception behavior been tested on a managed network?
5. Is there a documented statement about fresh-db behavior and lack of old-data migration?
6. Is there at least a minimal diagnostics/log collection path for support?

If any of those answers is no, keep the release scope narrow.
