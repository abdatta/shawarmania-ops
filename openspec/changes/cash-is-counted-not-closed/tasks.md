## 1. Rehearsal and baseline evidence, before any migration

- [ ] 1.1 Read `openspec/specs/daily-cash-reconciliation/spec.md`, `openspec/specs/manual-ledger/spec.md` and this change's `design.md` end to end before writing anything; verify the four decisions a fresh session most often gets backwards are understood: the carry-forward anchors to the counted figure (D3), the opening is stored across rows and derived within one (D4), an exact bill-run coincidence may be reported but a nearby instant may never be suggested (D7), and this change drops and renames nothing (D16).
- [ ] 1.2 Confirm against production that `daily_cash_records` holds zero rows and that `public.expenses` holds zero rows; verify both counts are recorded in the change notes, because the claim that the dead tables are free to leave in place rests on them.
- [ ] 1.3 Capture the production spread between `bills.paid_at` and `bills.synced_at` per outlet for the last thirty trading days; verify the distribution is recorded, since it is the evidence for open question 4 on whether a mid-day boundary needs an additional clock guard.
- [ ] 1.4 Build an offline rehearsal that replays August 2026's real `manual_ledger_days` rows and every bill from each outlet's first tablet day onward through the derived reader; verify each month total lands on the figure already known from the manual ledger, and record any date that does not with its cause.
- [ ] 1.5 Settle open question 1 with the owner: whether an outlet's first observation takes an owner-supplied books-opening figure or starts from zero and absorbs the float into its first difference; verify the answer is written into `design.md` before the table is created.

## 2. Schema, policies and isolation

- [ ] 2.1 Create `drawer_observations` with outlet, counted instant, recorded instant, stored opening, counted total, expected total, difference, approximate flag and tolerance window, recording account, correcting account, on-site evidence and off-site reason; verify a check constraint enforces `difference = counted_total - expected`, all money is `bigint` paise, and no client role holds insert, update or delete.
- [ ] 2.2 Enforce the counted-instant bounds in the database: not after the recorded instant, strictly after the previous observation's counted instant at that outlet, and not before that outlet's earliest drawer activity; verify each is refused with a message naming what it collided with, and that the previous-observation check takes an advisory lock on `(outlet_id)` so two concurrent counts cannot interleave.
- [ ] 2.3 Create `drawer_cash_out` with outlet, kind in `('collection','spend')`, amount, occurrence instant, recording account, nullable observation link, nullable reason, and on-site evidence; verify a `spend` without a reason is refused, a `collection` requires neither reason nor actor, and no client role writes it directly.
- [ ] 2.4 Create `drawer_observation_adjustments` with the observation, the corrected counted total, a required reason, an instant and an account; verify an adjustment against an observation that no later observation has anchored on is refused, since that case is an edit rather than an adjustment.
- [ ] 2.5 Create `ledger_day_verifications` with outlet, business date, account, instant and optional note, unique per outlet and date per account; verify re-verifying replaces nothing and is recorded as its own row.
- [ ] 2.6 Add nullable `occurred_at` to `public.expenses` and `public.manual_ledger_expenses`; verify every existing row is untouched and reads back through `coalesce(occurred_at, created_at)`, and that `public.cash_withdrawals` is left untouched because nothing writes it and #12 drops it.
- [ ] 2.7 Add RLS to all four new tables: Super Admin reaches every outlet, Franchise Admin reaches only the outlets their live assignment names, Biller and Employee reach none; verify assigned, cross-outlet, deactivated, ended-assignment and hand-crafted SELECT/INSERT/UPDATE/DELETE cases in `test:db` and `test:rls`, one case per table.
- [ ] 2.8 Prove the Super Admin drawer reach is a grant and not an accident: verify a Super Admin holding no assignment writes an observation, a collection, a spend and an adjustment at both outlets, and that the identical request from a Franchise Admin at an unassigned outlet is refused.
- [ ] 2.9 Confirm the migration contains only `create table` and `add column ... null`; verify a grep of the migration finds no `drop`, no `rename`, no `alter ... type` and no `update`, because decision 16 is the revert story.
- [ ] 2.10 Regenerate `src/data-access/database.types.ts`; verify `npm run db:types` leaves no unexpected generated-type diff.

## 3. The interval arithmetic

- [ ] 3.1 Write the pure domain module computing expected total, difference and carry-forward in integer paise; verify a non-integer input throws rather than rounding, and that the module has no import from the data layer.
- [ ] 3.2 Implement the receipts term as the latest accepted effective Cash allocation of settled bills whose payment instant falls in `(previous counted_at, this counted_at]`; verify a superseded original allocation and an earlier correction revision each contribute nothing, that UPI, Swiggy and Zomato contribute nothing, and that a payment exactly at the previous instant belongs to the earlier interval.
- [ ] 3.3 Implement the expenses term over `coalesce(occurred_at, created_at)` restricted to cash; verify a spend at 18:10 and one at 23:00 fall on opposite sides of a 22:00 count.
- [ ] 3.4 Implement the cash-out term excluding rows linked to the observation being written; verify an observation saved together with a ₹7,500 collection has that collection in neither its expected total nor its counted total, and that the next observation's opening is the counted total less ₹7,500.
- [ ] 3.5 Compute expected inside the writing transaction from a `security definer` function that is the only insert path; verify a direct insert, a client-supplied expected total and a client-supplied difference are each refused.
- [ ] 3.6 Prove the anchoring rule with a three-observation sequence where the middle one is ₹500 short; verify the third observation's opening and difference are identical to a run where the middle one balanced, so the shortfall does not propagate.
- [ ] 3.7 Prove the stored-opening rule: verify that adjusting an earlier observation changes no later observation's stored opening, and that the surface reports the resulting break rather than repairing it.
- [ ] 3.8 Prove the multi-day interval: verify an observation whose previous one was three days earlier sums three days of receipts, expenses and cash out by the same code path as a single evening.

## 4. Approximate times and what may be said about them

- [ ] 4.1 Mark an observation approximate whenever its counted and recorded instants differ, with a plus-or-minus fifteen minute window and a control asserting certainty; verify the flag and window are stored, not recomputed on read.
- [ ] 4.2 Compute the rupee tolerance from cash throughput inside the window; verify a ₹50 difference against ₹914 of nearby cash and a ₹3,100 difference against the same ₹914 render differently.
- [ ] 4.3 Detect an exact coincidence between the difference and a contiguous run of adjacent cash bills, and report it naming those bills and their instants; verify the ₹854 case from `design.md` is reported and that a ₹500 difference against the same bill set is not.
- [ ] 4.4 Assert the refusal directly: verify that for a difference with no exact match the surface emits no alternative instant, no ranked boundary and no balancing hint, in the rendered output and in whatever the component returns.
- [ ] 4.5 Build the movable count boundary over nearby cash bills; verify dragging it updates the expected total and the difference live, and that the position is a stated instant rather than a chosen bill identity.
- [ ] 4.6 Show both instants and the lag on every observation; verify the recorded instant is the server's and cannot be supplied by a client.

## 5. Corrections, exceptions and late arrivals

- [ ] 5.1 Allow full edit of the most recent observation at an outlet with no reason and no trail on the row; verify the edit recomputes expected and difference and that an edit to any earlier observation is refused.
- [ ] 5.2 Implement adjustments with a required reason; verify both the original and corrected figures, both accounts and the reason remain readable, and that the next observation's stored opening does not move.
- [ ] 5.3 Record and surface reconciliation exceptions for cash whose payment or occurrence instant falls inside an already-observed interval; verify the exception names the rows, amounts, occurrence and arrival instants, and the difference that would have resulted.
- [ ] 5.4 Handle the explaining case: verify a late arrival equal to a recorded excess leaves the recorded excess in place and marks it explained with its date.
- [ ] 5.5 Implement acknowledge-with-a-note and record-a-fresh-observation as the two resolutions; verify neither alters a stored observation figure.
- [ ] 5.6 Surface unsynced devices as an advisory on the count sheet, naming how many and since when, marking the expected figure possibly understated; verify a count is still accepted while a device is behind.
- [ ] 5.7 Prove the whole-system rule: verify no code path recomputes a stored observation figure in response to a bill, an expense, a settlement or a sync.

## 6. The Cash drawer surface

- [ ] 6.1 Build the surface opening on the running balance, with the last observation, what was left, and cash receipts and cash expenses since with their row counts; verify it opens on a balance and offers no date picker, and that it states how many days the pending interval covers once it exceeds one.
- [ ] 6.2 Build the count sheet with its three inputs; verify the difference appears on entry of the counted amount before submission, states direction in words as well as by sign, and that a shortfall reads as negative.
- [ ] 6.3 Build the time step with a `Just now` default and relative chips; verify choosing an earlier instant recomputes the expected figure live and states the cash excluded by that choice.
- [ ] 6.4 Build the collection step inside the count sheet, showing what will be left as it is typed; verify no actor picker and no reason field are presented.
- [ ] 6.5 Build standalone `Collect cash` with two fields; verify it records no reason and no actor, states the balance before and after, and says on its face that nothing is being verified.
- [ ] 6.6 Build `Record a cash spend` as a secondary link with a required reason; verify it states that it will not enter the month's operating expenses, and that it is not reachable as prominently as a collection.
- [ ] 6.7 Build the adjustment sheet for a locked observation; verify it names why the observation is locked, requires a reason, and states that the following observation re-anchors the balance so nothing after it moves.
- [ ] 6.8 Build the exception card with its two resolutions; verify it names the arriving rows and what the difference would have been.
- [ ] 6.9 Walk the surface on a phone and a tablet in light and dark themes; verify no layout reflow, that money never truncates, and that `npm run contrast` passes.

## 7. The derived ledger statement

- [ ] 7.1 Build the derived day reading from bills, expenses, `aggregator_channel_days`, cash out and observations, with no stored row; verify a business date with nothing recorded still renders in full.
- [ ] 7.2 Render the revenue section with Cash and UPI from allocations and each aggregator's gross, commission, net and settlement state; verify an undetermined commission reads as not known yet rather than nought, and that the month is presented as a ceiling while any day's commission is undetermined.
- [ ] 7.3 Render the drawer section ordered by instant; verify an expense before an observation appears above its block and one after appears below it, and that a day with two observations shows two blocks.
- [ ] 7.4 Render an unexplained variance as its own line inside the observation block; verify the section still adds to the closing balance with the variance present.
- [ ] 7.5 Name the float left and the closing balance separately and never with one word; verify the worked example renders ₹1,450 left and ₹3,504 closing, and that the surface states the float is not the next day's opening. Verify the word "Kept" appears nowhere in the surface, its tests or the docs it updates.
- [ ] 7.6 Mark a day with no observation as `carried` on both balances, naming when the drawer was last confirmed; verify the month view carries the same marker per row.
- [ ] 7.7 Assert the surface has no editable figure; verify a test enumerates the rendered controls and finds only the date stepper, row expansion and verification.
- [ ] 7.8 Measure the derived month against a real August at both outlets; verify the timing is recorded against open question 3, and that if it does not hold the remedy taken is a read model rather than a stored day row.

## 8. Verification

- [ ] 8.1 Implement day verification recording account, instant and optional note; verify it freezes nothing and that a day computes and renders identically before and after.
- [ ] 8.2 Detect and surface a change to a verified day's inputs; verify the day is marked changed since verified and names the figure that moved, including the case of an aggregator cycle settling afterwards.
- [ ] 8.3 Verify each day joins a verification by its own action; verify no control verifies more than one day and that none exists for selecting a range.

## 9. Gates, navigation and the overlap

- [ ] 9.1 Add `cash-drawer` and `ledger-statement` to `src/gates/registry.ts` as `live` for Super Admin and Franchise Admin shells; verify Biller and Employee shells mount neither and that no route resolves for them.
- [ ] 9.2 Remove the manual ledger's navigation entry while leaving its gate `live` and its route resolving; verify the route renders in full and that both readings can be open at once.
- [ ] 9.3 Set the demo-gated Daily cash surface to `hidden` and delete its mock adapter usage from the navigation; verify the four-role demo walkthrough no longer offers a day close and still walks.
- [ ] 9.4 Confirm no runtime toggle was introduced; verify a search of configuration, storage and the interface finds no control selecting between the two ledger readings, and that `docs/DEMO_MODE.md`'s build-time rule still holds.
- [ ] 9.5 Update the demo fixtures so the mocked outlet carries observations, a collection, a spend, an approximate count with an exact coincidence, a genuine shortfall and a late-arrival exception; verify the demo walkthrough reaches every one of those states.

## 10. Docs, roadmap and gates

- [ ] 10.1 Update `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/GLOSSARY.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/OFFLINE_AND_SYNC.md`, `docs/LIMITATIONS.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md` and `docs/TESTING.md`; verify the glossary no longer defines a closing figure, that "Business date" is unchanged, that the `paid_at` skew limitation is recorded, and that no page still describes a day close as a thing that happens.
- [ ] 10.2 Sweep every stale reference to `daily-cash-live` and `expenses-and-inventory-live` outside `openspec/changes/archive/`; verify each now points at this change or at #12, and that archived changes are left as the dated record they are.
- [ ] 10.3 Amend the #11 and #12 rows, the dependency graph and the Wave E narrative in `openspec/changes/ROADMAP.md`; run `npm run roadmap:sync` and verify no hand-stamped status drift.
- [ ] 10.4 Read `.github/workflows/` and run every job it runs, not a remembered list; verify the non-Docker gates and the Docker-backed gates each pass with recorded evidence.
- [ ] 10.5 Walk all four demo roles and both real shells on a phone and a tablet in both themes; verify no regression in billing, attendance or the aggregator surfaces.
- [ ] 10.6 PHASE GATE — Cash is counted, not closed: a count taken at 22:00 mid-service is measured against cash received up to 22:00 and no further, and the cash rung afterwards opens the next interval; the same path records a count after two skipped days and states that it covers three; a count entered an hour later with an approximate time reports how much the timing could explain, names an exact bill-run coincidence as a fact, and proposes no instant when none matches, proved by a test asserting the absence; a collection takes an amount and an instant with no reason and no actor, while drawer cash spent on equipment takes a reason and leaves the month's operating expenses unchanged; a shortfall is recorded once and does not reach the next interval; an observation is editable until the next one anchors on it and only adjustable afterwards, with both figures readable; cash syncing into an observed interval reports beside the observation and never inside it, including the case where it explains a recorded excess; a Super Admin with no assignment counts at both outlets and the record says where they stood, while a Biller and an Employee are refused every drawer read and write by the database, proved by a hand-crafted request; the Ledger renders every day with no typed field, orders the drawer by instant, names the float left and the closing balance differently, and marks an uncounted day `carried`; the migration contains no drop and no rename, so the previous surface still works at its route; and the four-role demo walkthrough still walks.
