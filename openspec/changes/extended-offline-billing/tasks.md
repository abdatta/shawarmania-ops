## 1. The Resume Record

- [x] 1.1 Extend the Dexie schema beside the existing envelope stores with a versioned resume record holding tablet identity, label and outlet; shift identity, operator name, opened time, business date and expiry; outlet cutover; menu; the outlet pipeline and this shift's bills as last read; exact-phone customer results; last successful read instant with the server time observed at it and the device clock beside it; and a schema version.
- [x] 1.2 Write a record only from a successful authorised online read, in one transaction, and make it readable only once every part has committed.
- [x] 1.3 Add compatibility readers and a migration test proving an unsupported record refuses to resume rather than being erased, and that no resume-record migration touches an envelope, dependency, result or tombstone.
- [x] 1.4 Define and enforce retention for remembered exact-phone results, keep them out of logs and telemetry, and record the cap in `docs/SECURITY_AND_PRIVACY.md`.

## 2. Opening The Counter Offline

- [x] 2.1 Add the counter-path fallback in session resolution: an `indeterminate` first resolution on a set-up tablet resolves from a complete same-installation resume record whose shift has not ended and whose expiry and cutover are both ahead; every other case keeps `UnconfirmedSession`.
- [x] 2.2 Feed the resume record into the live adapter as the server side of the overlay it already performs for orders and bills, so `overlayDurableOrders` and `overlayDurableBills` need no second reducer and no second source of truth.
- [x] 2.3 Keep every counter command available after the cold start — create, revise, mark prepared, reprepare, pay, void payment, cancel after payment, correct tender, cancel, and record an expense — with dependency chaining, integer paise, the locally-refused-before-minting rule and the short local reference all unchanged, and no bill number allocated locally.
- [x] 2.4 Reuse only exact normalized full phones this tablet resolved online, label them remembered, and leave an unrecognised number unresolved until sync.
- [x] 2.5 Stop new commands at the earlier of the stored shift expiry and the outlet cutover, and show unsent and needs-attention status with the path back beyond it.
- [x] 2.6 Keep every shift operation online: request, confirm, hand over and leave are unreachable offline, and the tablet says the connection and the operator's own phone are what is needed.

## 3. What The Operator Sees

- [x] 3.1 Add the persistent offline line with the last successful read, label the menu grid, the outlet pipeline and Bills this shift as of that read, and show last observed server time against device time when they materially disagree — in both themes, without disturbing the existing sync indicator.
- [x] 3.2 Refuse Finish Day offline through the existing readiness sheet: state that server state is unavailable, name the outstanding categories, offer only to keep billing, and present no countdown and no local confirmation.
- [x] 3.3 On reconnect, re-resolve tablet and shift status first, stop ordinary delivery and new work if removal is learned while retaining every envelope, otherwise drain in dependency order, and only then replace remembered projections with authoritative reads.
- [x] 3.4 Give the demo counter — which mounts the same `CounterShell` — a walkable outage: resume, capture, reconnect and drain, so the offline boundary can be shown rather than described.
- [x] 3.5 Carry the `app-shell` correction from [`openspec/todos/pipeline-rename-left-two-sentences-behind.md`](../../todos/pipeline-rename-left-two-sentences-behind.md): the Counter workspace is the composer and Bills this shift in the middle column beside the **outlet's** preparation pipeline, and the resizable pair is middle and activity. Verify against the rail itself rather than against the paragraph; then narrow the todo to the `counter-billing` half that #35 owns.
- [x] 3.6 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/SECURITY_AND_PRIVACY.md` and `docs/LIMITATIONS.md` with the V2.1 boundary, replacing the statement that a reload does not open from cache.

## 4. Verification And Phase Gate

- [x] 4.1 Unit tests for atomic record write, incomplete and unsupported records, foreign-installation refusal, the earlier-of-expiry-or-cutover stop, overlay composition from a persisted base, remembered exact-phone isolation, and retention leaving no PII in logs.
- [x] 4.2 Browser tests for cold start offline, capture, a second restart mid-outage, expiry, cutover, clock skew, an application update across the record's schema, a lost response replayed, a manager's cancellation refusing a later command as not open, and a removal learned at reconnect.
- [x] 4.3 Drive twenty mixed commands across compose, save, prepare, reprepare, pay, take-back, tender correction and cancel through a cold start and reconnect, proving exactly-once server effects and refusals arriving as refusals with ancestry intact.
- [x] 4.4 Prove Finish Day refuses offline, that no end-of-day confirmation is created or implied offline, and that `billing_day_readiness` keeps naming the tablet until it reconnects, drains and confirms online.
- [x] 4.5 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then inspect the tablet counter in light and dark.
- [x] 4.6 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth` against the local backend, confirming no RPC, policy or grant changed.
- [x] 4.7 PHASE GATE — Billing V2.1 extended offline: after one online shift approval the tablet is closed, updated and reloaded with no backend and reopens the same counter with everything labelled as of its last read; twenty mixed commands survive an extended outage and a second restart and land exactly once on reconnect; the counter stops at expiry and cutover and opens no shift without the backend and the operator's phone; Finish Day refuses offline and says why; readiness keeps naming the tablet until it confirms online; and the four-role demo walkthrough still walks.
- [x] 4.8 Unplanned release-gate repair: make the attendance server-time pgTAP independent of the wall clock by using the legal 24:00 and 00:00 cutover boundaries, after the first production push exposed the relative-time setup wrapping both outlets onto the same business date just after midnight IST.

## 5. Post-Release Repair

The gate was signed on a suite that never exercised the production write path.
Every item here is a defect in the shipped change, found by reviewing it against
the schema and the CI workflow rather than against its own tasks.

- [x] 5.1 The resume record was never written in production. `cutoverInstant`
      pasted `:00` onto `outlets.business_day_cutover`, which is a Postgres
      `time` and therefore reaches the client as `04:00:00`, so every commit
      threw `RangeError` into an unawaited chain — silently, and poisoning it
      for the life of the coordinator. Remove the function: `expires_at` is
      already `app_next_cutover(now(), cutover)` and `loadCounterShift` admits a
      shift only while it is ahead, so the server's own instant is the stop.
      Drop `outletCutover`/`outletCutoverAt`, bump the record schema, and pin
      the format with a test that drives the coordinator from an outlet row in
      the shape PostgREST actually returns.
- [x] 5.2 Make a failed resume write loud. The commit chain now catches and
      reports rather than rejecting unobserved, so the next silent stop is not
      silent.
- [x] 5.3 Resume only on a **first** resolution, as 2.1 and the spec both say.
      The fallback returned a counter session from any failed revalidation, so
      one blink on a healthy online tablet relabelled every current read as
      remembered, disabled Hand over, refused Finish Day and stopped the record
      being refreshed. The decision moves to `apply`, which is what knows
      whether there is a live session to preserve.
- [x] 5.4 Prove the cold start against the real backend. `e2e-auth` still
      asserted that an offline reload left the counter closed — the behaviour
      this change exists to remove. It now reopens the counter from its record,
      captures more work, survives a second restart, refuses Finish Day, and
      lands every command exactly once on reconnect.
- [x] 5.5 Drop `operatorName` from the record. It was a hardcoded
      `'Counter operator'` for every shift, read nowhere: `CounterShift` holds
      `personId` and no name, and the only name the server offers is a
      manager-facing snapshot this tablet neither reads nor is granted. The
      spec asked for a fact the tablet has never had; unmake the promise rather
      than add a read and a grant to keep it.
- [x] 5.6 Give queued expenses a real sender and a way out. Delivery was a side
      effect of reading an expense list — no schedule, no lock, no ordering
      guarantee — and a permanently refused row retried forever while blocking
      Finish Day with no explanation. Move the queue into `src/outbox`, drain it
      on the command coordinator's own tick and mutex, park a server *refusal*
      as `needs_attention` rather than retrying an answer, count refusals as
      attention and only pending rows as unsent, scope readiness to the shift's
      business date, label a queued row on the list, and let the operator
      discard a refused one.
- [x] 5.7 Queue an expense on an ordinary drop, not only after a reload. The
      queue opened solely for a session that had already resumed from a record,
      so one outage behaved two ways depending on whether the page refreshed.
      Apply the rule the billing adapter already applies to a settled bill.
- [x] 5.8 Enforce remembered-customer retention on the read path as well as the
      write path, so the cap `docs/SECURITY_AND_PRIVACY.md` states holds for a
      record that stopped being rewritten.
- [x] 5.9 Re-run every job in `.github/workflows/verify.yml`, read rather than
      remembered, including the Docker-backed database job.
- [x] 5.10 Say why a resumed counter is still filling in. Proving 5.4 measured
      the cost of preferring the server: each remembered read runs its request
      and falls back only once the browser gives up, so the menu, pipeline and
      bills arrive around seven seconds after a cold start. The app's
      placeholders are deliberately wordless, which is right for a moment and
      wrong for seven seconds with no connection — silent shimmer reads as a
      frozen tablet, and the operator's recovery is another force-close, which
      starts the wait again. Each waiting column now carries one line, and it
      goes with that column rather than standing as a notice. The latency
      itself is kept and recorded in `docs/LIMITATIONS.md`: preferring the
      record would be faster and would show a stale menu to a shop whose wifi
      is up and whose line is dead.
