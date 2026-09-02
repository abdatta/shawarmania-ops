## 1. Reshaping One Invariant, Once

- [ ] 1.1 Add the unproven-setup state: a redeemed code creates a row that is not an active tablet, appears nowhere, reaches nothing, and expires on the setup code's own `expires_at`, evaluated where the row is read rather than by any scheduled job — with the singleton index still in place, so the two halves of the invariant are never both loose at the same time.
- [ ] 1.2 Add active-label uniqueness per outlet, and the rename path, refusing a collision without disclosing another outlet's labels.
- [ ] 1.3 Add the per-tablet management metadata the collection surface needs, keeping every existing column and its meaning.
- [ ] 1.4 Prove existing tablet rows, machine credentials, pending local work and historical attribution migrate in place, unchanged, with no re-setup required at either outlet.
- [ ] 1.5 Drop `counter_devices_one_active_per_outlet` **only after** sections 2 and 3 pass with it still in place.
- [ ] 1.6 Regenerate schema types and update the typed demo and seed fixtures with two independently identified tablets at one outlet.

## 2. Setup, Management And Shifts

- [ ] 2.1 Stop setup refusing a valid code because the outlet already has a counter, and keep every other refusal — cross-outlet, reused, expired, exhausted — one indistinguishable response.
- [ ] 2.2 Rebuild the Tablets adapters and surfaces as a collection grouped by outlet, each action naming one explicit tablet, with the existing one-read-no-subscription rule, the stated reading time, the FA/SA authority boundary and the PII-free card contents all unchanged.
- [ ] 2.3 Label every reported count with the time that tablet reported it, and make a stale zero unreadable as an empty queue.
- [ ] 2.4 Keep shifts per tablet: one person may hold one on each of two tablets, each command carries the tablet and shift that produced it, and ending one leaves the other untouched.
- [ ] 2.5 Keep each tablet's Dexie stores, resume record and drain leader entirely local to it, with correction and discard available only on the originating tablet.
- [ ] 2.6 Make a resumed tablet refuse the neighbour's orders locally. The resume record holds the outlet's pipeline, so an offline tablet already sees work it does not own: refuse revise, pay, cancel and preparation on it without reaching the server, capture no command for delivery, and label the remembered pipeline with its read time so it never reads as the outlet's present.
- [ ] 2.7 Say plainly on the outlet pipeline which tablet took an order, so an operator understands a refusal before they meet it.

## 3. Concurrency, Isolation And Accounting

- [ ] 3.1 Database stress tests for simultaneous pay-now and order payments from two tablets, lost-response retries against a live competitor, UUID reuse with different content, and transactional per-outlet number allocation under contention.
- [ ] 3.2 RLS tests proving each tablet still reaches exactly one outlet, an FA still reaches only assigned outlets, and SA cross-outlet management uses only designed surfaces — each by a hand-crafted request rather than by a disabled control.
- [ ] 3.3 Removal tests proving one tablet is refused at the database immediately while the other tablet, its shift, its queue and every human assignment continue.
- [ ] 3.4 Ownership tests proving the neighbouring tablet is refused revise, pay, cancel and preparation on an order it does not own, and that a stranded order is cleared only by the outlet's manager with a reason.
- [ ] 3.5 Readiness tests proving the date stays not ready until both tablets confirm, that one confirmation never covers the other, and that a later accepted command invalidates only its own tablet's confirmation.
- [ ] 3.6 Update shift and outlet-history views so each counter shows only its own shift, outlet history counts every bill once and names the tablets involved, and nothing sorts accounting order by bill number.
- [ ] 3.7 Inject the setup failure genuinely — a redemption that commits followed by a sign-in that does not — and prove the outlet loses a code and not a counter, that a session proven inside the code's window still becomes a counter, that the row counts as nothing anywhere once that window passes, and that remove-and-reissue still works as the fallback. Then close [`openspec/todos/tablet-setup-consumes-its-slot-before-it-is-proven.md`](../../todos/tablet-setup-consumes-its-slot-before-it-is-proven.md).
- [ ] 3.8 Carry the `counter-billing` correction from [`openspec/todos/pipeline-rename-left-two-sentences-behind.md`](../../todos/pipeline-rename-left-two-sentences-behind.md): the composer's saved-order scenario says Preparing, matching the pipeline requirement beside it, while the standalone page and manager tab keep their Open orders heading. #34 took the `app-shell` half when it archived on 2026-09-02, so this is the last contradiction and closing it closes the todo.
- [ ] 3.9 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md` and `docs/LIMITATIONS.md` — removing **One active tablet per outlet at launch** and **A tablet setup that fails at the last step needs an admin, not a retry**, and recording that a bill number no longer implies the order of service. Re-evaluate [`openspec/todos/emergency-billing-continuity.md`](../../todos/emergency-billing-continuity.md) and record the outcome there.

## 4. Verification And Phase Gate

- [ ] 4.1 Drive two independent browser contexts as two tablets at one outlet through concurrent online payment, one tablet going offline and capturing while the other trades, a cold start on both during one outage so each resumes only its own record, interleaved reconnect, a lost response, an attempted action on the neighbour's order both online and from a resumed offline tablet, and the removal of one tablet mid-service.
- [ ] 4.2 Verify bill numbers are unique, sequential in server acceptance order, never reused, and independent of ordered and payment timestamps and business dates.
- [ ] 4.3 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then inspect the phone management surface and the tablet counter in light and dark.
- [ ] 4.4 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth` against the local backend.
- [ ] 4.5 PHASE GATE — Billing V2.2 multiple tablets: two tablets at one outlet bill concurrently online and offline, each owning its orders and draining its own queue, neither able to act on the other's order and both refused across outlets by hand-crafted request; bill numbers stay unique and sequential in acceptance order including after a late sync; removing one leaves the other trading and every assignment intact; the date is not ready until both have confirmed their own end of day; a setup that fails after redemption costs a code and not a counter; and the four-role demo walkthrough still walks.
