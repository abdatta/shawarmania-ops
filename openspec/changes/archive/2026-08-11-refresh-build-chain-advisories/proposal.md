# Proposal: Refresh Build-Chain Advisories

> **Kind**: dependency hygiene, not a roadmap change · **Gate**: the lockfile resolves every currently fixable high-severity advisory to its patched compatible version, `npm audit` reports no known vulnerability, a clean install succeeds, and the production/PWA build remains unchanged in behaviour.

## Why

The accepted Workbox build-chain warning has changed shape: patched compatible
versions now exist, and the current lockfile reports three high-severity
advisories instead of an unavoidable unfixed chain. Leaving fixable warnings in
place would hide the next advisory and preserve risk for no product benefit.

## What Changes

- Refresh only the vulnerable transitive lockfile resolutions to patched
  versions already permitted by their parent dependency ranges.
- Prove the resulting dependency tree installs reproducibly, audits clean, and
  still produces the application and generated service worker successfully.
- Replace the stale accepted-warning backlog state with the verified current
  state.
- Establish the durable rule that a fixable high-severity build dependency is
  updated, while an advisory with no compatible fix is explicitly assessed for
  runtime reachability and tracked rather than buried.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffold`: require high-severity dependency advisories to be either
  resolved with an available compatible patch or explicitly assessed and
  tracked when no safe patch exists.

## Impact

- `package-lock.json` changes; direct dependency ranges and application source
  do not.
- Clean-install, audit, test, typecheck, build, and PWA/offline-shell evidence
  verify the refresh.
- `docs/TESTING.md` and `docs/SECURITY_AND_PRIVACY.md` record how dependency
  advisories are verified and when an accepted exception is legitimate.
- No roadmap row, migration, policy, runtime data, feature gate, or demo seam
  changes.

## Non-goals

- Upgrading unrelated direct dependencies or adopting a new PWA toolchain.
- Adding the remote advisory feed as a deployment-blocking CI step; this change
  restores a clean baseline without making publication depend on mutable
  external advisory data.
- Claiming a build-time package is browser-reachable without bundle evidence.
- Changing service-worker caching, update adoption, or offline behaviour.

## Docs to update before archiving

- `docs/TESTING.md` — document the audit and clean-install verification used for
  dependency refreshes.
- `docs/SECURITY_AND_PRIVACY.md` — state how fixable and temporarily accepted
  dependency advisories are handled.
