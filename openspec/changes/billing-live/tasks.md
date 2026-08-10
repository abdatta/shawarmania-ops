## 1. The menu becomes real

- [x] 1.1 Promote `admin-menu` to `live` with full create, rename, reprice, reorder, availability and retirement, prices entered and stored in integer paise, scoped by assignment.
- [x] 1.2 Add RLS tests proving a manager writes only their own outlets' menu and reads no other outlet's.
- [x] 1.3 Prove from an empty database that an outlet's whole menu can be created through the UI with no SQL, and that a retired item leaves every captured line unchanged.
- [x] 1.4 Rebuild the manager menu screen around **items**, not categories, on the pattern the expense list already uses: no separate create-a-category step and no empty category to leave behind. One right-aligned `+ Add` at the top right meaning add an item; the category is a free-form field on the item form that suggests existing categories and creates an unrecognised one on the way through, confirming before it does so that "Burger" beside "Burgers" is deliberate. A new category takes `max(sort_order) + 1`, and the manager's menu screen gains the explicit reorder action this change's spec already promises — the counter's grouping order is a decision the manager makes, not an accident of typing order. Scroll a newly added item or category into view and highlight it briefly, respecting `prefers-reduced-motion` for the highlight but not the scroll; build it as a reusable primitive, because [`reveal-what-was-just-added`](../../todos/reveal-what-was-just-added.md) wants the same behaviour on every other add flow.
- [x] 1.5 Give every item row one actions menu on the right rather than loose Turn off and Edit buttons, with the price immediately left of it; put an `OFF` chip beside the item's name, and render an unavailable row in the disabled treatment the deleted-expense row uses, minus the strikethrough.
- [ ] 1.6 GATE: both outlets' real menus are entered through the app by the owner before any tablet is set up.

## 2. Local delivery store

- [ ] 2.1 Add the versioned Dexie envelope, dependency, result, tombstone and lease records, with migrations that preserve unsent data across application updates.
- [ ] 2.2 Implement transactional local acceptance so a command is acknowledged and its form clears only after the IndexedDB commit, with a non-destructive blocking state when storage fails; keep direct-payment commands ineligible for delivery during the six-second Undo window, and restore the complete composer when one is undone.
- [ ] 2.3 Implement Web Locks leader election with the IndexedDB lease fallback, and dependency-aware draining that does not freeze unrelated order chains.
- [ ] 2.4 Implement bounded retry and backoff driven by actual request evidence, with browser connectivity events used only as retry hints.
- [ ] 2.5 Map accepted, exact replay, retryable, order-not-open, identity conflict, permanent refusal, corrected and discarded outcomes to durable local states; permit correction/discard only on the originating tablet under its live shift, retaining actor, time, reason and refused trace.
- [ ] 2.6 Report the unsent count through `report_counter_device_state`, so the `last_reported_unsent` column and the Tablets surface column that #9 shipped start carrying real numbers, without logging payloads or customer phone numbers. **Moved here from #33 §4 on 2026-08-09**, with the rest of the store.

## 3. Real billing adapters

- [ ] 3.1 Connect the live menu adapter so reachable sessions always fetch the latest outlet menu and a live shift falls back only after a real backend failure.
- [ ] 3.2 Connect customer exact lookup and create-or-get adapters without exposing directory browse, cross-outlet history, or phone values in logs.
- [ ] 3.3 Connect local-first adapters for direct-payment and create, revise, cancel and pay-order commands, carrying exact one-or-more Cash, UPI, Swiggy or Zomato allocations unchanged and rejecting Card and Other, keeping a bill unnumbered on screen until the server result arrives, keeping `discount_paise` zero with no discount control, preserving Mark Paid's guaranteed Undo, and retaining the UI-only rule that either customer name or phone is entered before Order or Mark Paid.
- [ ] 3.4 Connect live open-order, shift-summary, revenue-business-date bill-history, manager void, manual counter re-ring guidance, manager cancellation of a stranded order, originating-tablet needs-attention correction/discard, and read-only non-identifying manager diagnostics to their authorised contracts; preserve the open-order hierarchy of complete preparation items with line amounts, optional customer and total over its `Order #` reference, show relative age for today's work, omit the current creator's redundant name, label payment Mark Paid, use the full composer for edits while restoring suspended drafts, keep all four supported method totals visible at zero, and create no manager payment command or cross-device draft.
- [ ] 3.5 Preserve typed adapter composition so screens import neither Supabase nor Dexie directly.

## 4. V1 session and cutover behaviour

- [ ] 4.1 Keep unsent and needs-attention envelopes through the shift ending, cutover, browser restart and compatible app updates.
- [ ] 4.2 Let an already-open counter continue from its shift's menu snapshot during a transient outage, with a persistent offline banner and captured line snapshots.
- [ ] 4.3 Require the backend and a freshly approved shift to start or resume new billing after a reload, a missing shift or cutover, while still permitting old queue delivery and status.
- [ ] 4.4 Stop draining once a tablet is removed, keep its envelopes, and warn on the Tablets surface before removing a tablet reporting unsent work.
- [ ] 4.5 Add not-sent-yet, retrying, sent, needs-attention, void and cancelled indicators using semantic tokens in both themes.
- [ ] 4.6 Add the online finish-day flow that drains and verifies the date, refuses while anything is unresolved, ends the shift, writes the end-of-day confirmation, and locks further work under it.

## 5. The ledger handover

- [ ] 5.0 Add `outlets.billing_live_from date NULL` with its RLS and a Super Admin control that sets it, refusing a business date that has already started — a day that begins hand-typed and ends sourced from bills is the double-count 5.3 exists to catch. Regenerate database types.
- [ ] 5.1 Source a live outlet's counter revenue from paid bills for business dates on and after that outlet's `billing_live_from`, labelled on screen as coming from the counter, with the typed field removed for those dates.
- [ ] 5.2 Leave earlier business dates, and an outlet that is not live yet, exactly as they are, each labelled for what it is.
- [ ] 5.3 Add the test that fails if a live outlet's day or month counts counter revenue more than once.
- [ ] 5.4 Leave aggregator commission, cash in and out, expenses and the counted drawer on the manual path, and say in `docs/LIMITATIONS.md` that #12 and #13 own their retirement.

## 6. Gate promotion and demo preservation

- [ ] 6.1 Promote tablet setup, counter billing, open orders, customer lookup and billing history from `demo` to `live` for their authorised contexts.
- [ ] 6.2 Verify personal Biller sessions keep Employee navigation while the tablet exposes only billing pages under an approved shift.
- [ ] 6.3 Keep `/demo` on the synthetic #31 adapters, opening no real queue and making no Supabase write.
- [ ] 6.4 Update `docs/ARCHITECTURE.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md`, `docs/TESTING.md` and `docs/LIMITATIONS.md` for the exact V1 boundary and the V2 follow-ups.

## 7. Verification and rollout

- [ ] 7.1 Add unit tests for local acceptance, the six-second direct-payment delivery hold and exact composer restoration on Undo, exact split-tender persistence and Cash-only drawer contribution, zero-discount commands, rejection of Card and Other with all four supported methods preserved, UI-only customer identification gating, full order editing with suspended-draft restoration, zero-valued shift totals, dependency ordering, leader failover, retry classification, originating-tablet correction linkage, reasoned discard and read-only manager diagnostics carrying no customer details, including a local-store schema upgrade that preserves unsent work across an application update, and a two-tab leadership test.
- [ ] 7.2 Add integration tests for upfront Mark Paid and Undo, payment on handover, an aggregator order collected by a rider, manager void followed by manual counter re-ring, needs-attention handling on the originating tablet, revenue-date history filtering across cutover, exact replay, delivery after cutover, and menu fallback.
- [ ] 7.3 Run browser tests that drop the backend before and after local commit, lose the response after the server commits, restart with unsent work, refuse to start new work offline, prove eventual exactly-once settlement, and refuse finish-day until the queue is resolved.
- [ ] 7.4 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then inspect phone and tablet layouts in light and dark.
- [ ] 7.5 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`.
- [ ] 7.6 Adversarial review pass: a separate session reads these spec deltas against the delivered adapters, gates and ledger handover, and reports every requirement it cannot find satisfied.
- [ ] 7.7 ROLLOUT — **Kalyani first**, which is the outlet that has a tablet: enrol it, enter its real menu through the app, run shadow smoke tests before any customer money, set `billing_live_from` to a business date that has not started, promote, hand its ledger over, and trade one full day closed cleanly. Only then repeat for Kanchrapara, whose hardware arrives later.
- [ ] 7.8 PHASE GATE — Billing V1 live: at both outlets, one tablet takes real immediate and on-handover payments against a menu entered through the app; Mark Paid retains its guaranteed Undo and no discount control exists; accepted writes survive restart and land exactly once after forced response loss; manager void is followed by a manual counter re-ring with no personal-device billing path; needs-attention work is corrected or discarded only on its originating tablet while manager diagnostics stay read-only; menu and cutover rules hold; a stranded order is cleared by a manager; an unresolved queue cannot receive an end-of-day confirmation; counter revenue appears exactly once in the ledger; the real gates are live and the demo walkthrough is still isolated.
