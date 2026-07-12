# Sub-Agent 05 - Rust Integrations

## Mission

Recreate the Jira and Tempo integrations in Rust, including sensible retry/error behavior and corporate-network considerations.

## Scope

You own:

- Jira client in Rust
- Tempo client in Rust
- auth header generation path
- request timeout/retry behavior
- logging/error behavior suitable for desktop troubleshooting

You do not own:

- final push orchestration semantics beyond the interfaces you satisfy
- frontend integration
- packaging implementation

## Inputs

- `server/http.ts`
- `server/jira/client.ts`
- `server/tempo/client.ts`
- `server/auth/*`
- outputs from Sub-Agents 01 and 02

## Required Outputs

- native Jira/Tempo clients
- documented handling for transient failures and cert/proxy errors
- redaction rules for sensitive values in logs and dry runs

## Acceptance Criteria

- the Rust integrations cover current required feature calls
- timeout and retry behavior is explicit
- sensitive auth values are not leaked casually
- work is shaped for direct use by the push domain and frontend command layer

## Return Format

Return one final report containing:

- files changed
- network/client choices made
- tests run or manual verification performed
- corporate-network concerns discovered
- exact integration interfaces exposed to downstream work
