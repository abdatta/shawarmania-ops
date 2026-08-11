## Context

The original backlog note accepted eight high-severity advisories on the
`vite-plugin-pwa` → `workbox-build` build-only chain because compatible fixed
versions did not exist. The current lockfile now reports three high-severity
advisories across Workbox, ESLint, and Vite transitive dependencies, and npm's
resolver identifies compatible patched releases for all of them:

- `brace-expansion` 5.0.8 → 5.0.9;
- nested `brace-expansion` 2.1.2 → 2.1.4;
- `fast-uri` 3.1.4 → 3.1.5;
- `nanoid` 3.3.16 → 3.3.18.

All remain development/build dependencies. The purpose of acting now is to
restore a clean signal without turning a maintenance correction into a general
toolchain upgrade.

## Goals / Non-Goals

**Goals:**

- Resolve every currently reported high-severity advisory with compatible
  patched transitive versions.
- Preserve a reproducible clean install and the existing application/PWA output.
- Define how a future fixable advisory differs from a documented, temporarily
  accepted one.

**Non-Goals:**

- Upgrade direct packages, change service-worker behavior, or replace Workbox.
- Add runtime dependencies or move build-only packages into the browser bundle.
- Make the deployment gate depend on the mutable remote npm advisory feed.
- Touch database, RLS, money, offline delivery, gates, or demo behavior.

## Decisions

### Change only compatible transitive lockfile resolutions

Use npm's compatible resolution path, inspect the resulting lockfile, and keep
`package.json` direct ranges unchanged. The expected semantic change is the four
patched package versions; platform-specific optional lock entries may be
normalized by npm and must be reviewed rather than mistaken for new runtime
dependencies.

The rejected alternative is adding overrides or direct dependencies solely to
force transitive versions. The parent ranges already admit the fixes, so an
override would preserve unnecessary policy after the ecosystem has caught up.

### Verify the installed tree and built artifact

After the lock refresh, perform a clean install, run `npm audit`, inspect the
dependency paths, and execute the standard non-database suite including the
production build and PWA/offline checks. `npm audit` must report no known
vulnerability for this change's gate.

The rejected alternative is accepting the dry-run output as proof. It predicts a
resolution but does not prove the committed lockfile installs or that Workbox
still generates the service worker.

### Keep advisory review out of the deployment gate

The project-scaffold contract will require fixable high-severity advisories to
be resolved and unfixable ones to be assessed and tracked. It will not add
`npm audit` to every CI/deploy run: the result depends on advisory data that can
change without a repository commit, so it could halt a release with no changed
artifact and no reviewed response.

The rejected alternative is permanent CI gating on the live audit feed. A clean
baseline is valuable; an externally mutable release gate is not.

### Do not widen the existing Node engine warning

The local Node 22.18 runtime warns that the current React Router release asks for
22.22 or newer, while CI's `node-version: 22` resolves a current Node 22. This
warning predates and is independent of the vulnerable transitive resolutions.
It becomes a blocker only if the clean install or verification fails; otherwise
it remains separate toolchain work.

## Risks / Trade-offs

- **Lockfile normalization creates a noisy diff** → verify that new entries are
  optional platform packages already declared by existing parents and that only
  the four intended vulnerable versions change semantically.
- **A patched build dependency changes generated output** → run production build,
  PWA installation/offline tests, and inspect the generated worker behavior.
- **A new advisory appears after this proposal** → apply the stated rule to the
  current audit result at implementation time and record any newly accepted
  exception rather than ignoring it.

## Migration Plan

There is no runtime or database migration. Commit the reviewed lockfile and docs
only after a clean install and verification. Rollback is the lockfile revert;
the previously deployed application is unaffected because these packages are
not browser runtime dependencies.

## Open Questions

None. A newly reported advisory without a compatible fix is handled by the
contract's explicit assessment path, not by silently widening this proposal.
