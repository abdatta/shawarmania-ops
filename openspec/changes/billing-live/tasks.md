## 1. Local Delivery Store

- [ ] 1.1 Add the versioned Dexie billing envelope, dependency, result, tombstone, and lease records with migrations that preserve pending data across application updates.
- [ ] 1.2 Implement transactional local acceptance so a command is acknowledged and its form clears only after IndexedDB commit, with a non-destructive blocking state when storage fails.
- [ ] 1.3 Implement Web Locks leader election with the IndexedDB lease fallback and dependency-aware draining that does not freeze unrelated order chains.
- [ ] 1.4 Implement bounded retry/backoff and lifecycle triggers using actual request evidence, with browser connectivity events used only as retry hints.
- [ ] 1.5 Map accepted, exact-replay, retryable, version-conflict, idempotency-conflict, permanent-rejection, corrected, and discarded outcomes to durable local states.

## 2. Real Billing Adapters

- [ ] 2.1 Connect the live menu adapter so reachable sessions always fetch the latest outlet menu and an active session falls back only after a real backend failure.
- [ ] 2.2 Connect customer exact lookup and create-or-get adapters without exposing directory browse, cross-outlet bill history, or phone values in logs.
- [ ] 2.3 Connect local-first adapters for direct pay and create/revise/cancel/pay order commands, preserving provisional references until official server results arrive.
- [ ] 2.4 Connect live open-order, shift-summary, bill-history, void/replacement, quarantine correction/discard, and late/recovery status reads to their authorized contracts.
- [ ] 2.5 Connect FA/SA stranded-order transfer/recovery cancellation and revoked-device upload-only recovery without restoring device access.
- [ ] 2.6 Preserve typed adapter composition so screens import neither Supabase nor Dexie directly.

## 3. V1 Session, Cutoff, And Recovery Behavior

- [ ] 3.1 Keep pending and quarantined envelopes through operator logout, daily cutoff, browser restart, and compatible app updates while clearing ordinary human credentials.
- [ ] 3.2 Allow an already-open authenticated counter to continue from its active menu snapshot during a transient outage, with a persistent offline banner and captured line snapshots.
- [ ] 3.3 Require online authentication and a fresh menu to start or resume new billing after reload, missing grant, or cutoff while still permitting old queue delivery/status.
- [ ] 3.4 Stop ordinary drain after device revocation and expose authenticated FA/SA upload-only recovery for eligible historical envelopes.
- [ ] 3.5 Add pending, delivered, blocked, quarantined, late, recovered, void, and replacement indicators using semantic tokens in both themes.
- [ ] 3.6 Add the online finish-day flow that drains and verifies the date, refuses unresolved local states, ends the grant, writes the server seal/watermark, and locks further work under that grant.

## 4. Gate Promotion And Demo Preservation

- [ ] 4.1 Promote device enrollment, counter billing, open orders, customer lookup, billing history, and recovery surfaces from `demo` to `live` for their authorized contexts.
- [ ] 4.2 Verify personal Biller sessions retain Employee navigation while the enrolled device exposes only billing pages after daily operator authentication.
- [ ] 4.3 Keep `/demo` on the synthetic #31 adapters without opening the real Dexie queue or making Supabase writes.
- [ ] 4.4 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, and `docs/LIMITATIONS.md` for the exact V1 boundary and V2 follow-ups.

## 5. Verification And Phase Gate

- [ ] 5.1 Add unit tests for local acceptance, dependency ordering, leader failover, retry classification, envelope upgrades, correction linkage, and PII-free diagnostics.
- [ ] 5.2 Add integration tests for direct pay, deferred payment, conflict/quarantine, exact replay, cutoff delivery, revoked-device recovery, and current-menu fallback behavior.
- [ ] 5.3 Run browser tests that drop the backend before and after local commit, lose the response after server commit, logout/restart with pending work, reject offline restart of new work, prove eventual exactly-once settlement, and refuse finish-day until the queue is resolved and sealed online.
- [ ] 5.4 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`, then inspect phone/tablet light and dark layouts.
- [ ] 5.5 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls`, and `npm run test:e2e:auth` against the local backend.
- [ ] 5.6 PHASE GATE — Billing V1 live: at both outlets, one enrolled device records direct and deferred payment; accepted writes survive logout/restart and land exactly once after forced response loss; current-menu and cutoff rules hold; quarantine/recovery is accountable; an unresolved order/queue cannot receive a device-day seal; real gates are live and the demo walkthrough remains isolated.
