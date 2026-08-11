## 1. Reproduce and bound the advisory set

- [ ] 1.1 Run `npm audit` before changing the lockfile and record every current high-severity advisory, vulnerable version, dependency path, and whether it is runtime- or build-reachable.
- [ ] 1.2 Run a compatible-resolution dry run and confirm the intended semantic changes are limited to patched transitive versions already admitted by parent ranges.

## 2. Refresh the dependency lock

- [ ] 2.1 Update the vulnerable transitive resolutions in `package-lock.json` without changing direct dependency ranges or adding overrides solely to force them.
- [ ] 2.2 Inspect the complete lockfile diff: verify the four vulnerable versions move to fixed releases and classify any added platform-specific entries as optional dependencies already owned by existing parents.
- [ ] 2.3 Run a clean `npm ci`, then `npm ls` for the affected packages and `npm audit`; require a reproducible tree and zero known vulnerabilities for the phase gate.

## 3. Prove build and PWA behavior

- [ ] 3.1 Run the targeted build-tool and service-worker tests, then generate a production build and confirm the PWA worker and precache are still produced.
- [ ] 3.2 Run the existing offline-shell and update-adoption Playwright coverage so patched Workbox dependencies do not alter install, caching, or safe-update behavior.
- [ ] 3.3 If the local Node engine warning becomes an actual install or verification failure, stop and seed a separate Node-toolchain change rather than widening this dependency correction silently.

## 4. Record the advisory policy

- [ ] 4.1 Update `docs/TESTING.md` with the clean-install, dependency-path, audit, and build evidence required for a dependency advisory refresh.
- [ ] 4.2 Update `docs/SECURITY_AND_PRIVACY.md` with the rule for fixing compatible high-severity advisories and documenting a time-bounded, runtime-reachability-based exception when no fix exists.
- [ ] 4.3 Remove `workbox-build-advisories.md` from the active backlog and move its index entry to Graduated / Absorbed, naming the patched dependency refresh.

## 5. Verification

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e` from the clean install.
- [ ] 5.2 Confirm no runtime dependency, application source, migration, policy, gate, demo seam, or roadmap row changed and `npm run roadmap:sync` leaves `ROADMAP.md` unchanged.
- [ ] 5.3 Inspect the built client bundle or dependency graph to confirm the remediated build-only packages did not become browser runtime dependencies.

## 6. PHASE GATE

- [ ] 6.1 **Non-roadmap gate**: every currently fixable high-severity advisory resolves to a compatible patched version; `npm ci` and `npm audit` are clean; the full non-database suite passes; and production/PWA build, offline shell, and update adoption behave exactly as before.
