# Tasks: zomato-settlement-sync

## 1. Schema and policies

- [x] 1.1 Migration: add to `manual_ledger_days` the Zomato measured columns in integer paise (`zomato_gross_paise`, `zomato_commission_paise`, `zomato_net_paise`), a settlement state (`provisional | settled | disputed`, null when not synced), the superseded typed figure with the moment it was superseded, and the retained provisional triple a settled day replaced. All nullable and additive; `zomato_commission_bp` stays untouched for Swiggy and pre-sync days.
- [x] 1.2 Migration: CHECK constraints so a synced day is internally consistent — gross equals commission plus net, all three present or all three absent, settlement state present exactly when the three figures are, and the state moving only along `provisional → settled`, `provisional → disputed` and `disputed → settled`. Settled is terminal.
- [x] 1.3 Migration: add a source identity to `manual_ledger_expenses` (external system, external id, unique per outlet) so repeated runs update in place; existing hand-entered rows keep a null source.
- [x] 1.4 Migration: new `aggregator_cycle_deductions` table for records belonging to no trading day — outlet, kind, the period it names, amount in integer paise, source id unique per outlet. Its kinds cover both a tax deduction and an accepted unexplained settlement difference, the latter carrying who accepted it and when.
- [x] 1.5 Migration: new `outlet_channel_sync` table holding the per-outlet, per-channel **synced-from date**, set deliberately by a Super Admin and never derived from the presence of synced rows. Refuse a date that has already started, for the same reason `billing_go_live_date` does.
- [x] 1.6 Migration: new `aggregator_sync_runs` table recording each run's outcome — started, finished, outcome class (`ok | session_lapsed | shape_changed | reconciliation_failed`), and the detail a human needs to act.
- [x] 1.7 RLS policies on all three new tables and the new columns' read paths: Super Admin across outlets, Franchise Admin refused these financial rows entirely, Biller and Employee refused entirely.

## 2. Isolation and integrity tests

- [x] 2.1 pgTAP: `aggregator_cycle_deductions` isolation — Franchise Admin, Biller and Employee refused read and write on both outlets, including a hand-crafted request carrying an explicit `outlet_id`; Super Admin reads across.
- [x] 2.2 pgTAP: `outlet_channel_sync` isolation — same matrix; only a Super Admin may set a synced-from date.
- [x] 2.3 pgTAP: `aggregator_sync_runs` isolation — same matrix.
- [x] 2.4 pgTAP: the new `manual_ledger_days` columns are unreachable by every role the ledger already refuses, so widening the row widened no access.
- [x] 2.5 pgTAP: the CHECK constraints from 1.2 refuse a partial triple, an inconsistent triple, a settled-to-provisional downgrade and a settled-to-disputed downgrade, each by hand-crafted request.
- [x] 2.6 pgTAP: `outlet_channel_sync` refuses a synced-from date on a business date already under way.
- [x] 2.7 Add every new table to the coverage-enumeration test so an unclassified table fails the suite.

## 3. Write contract (Edge Function)

- [x] 3.1 Edge Function `ingest-aggregator-cycle`, authenticated by its own secret, accepting one outlet's one payout cycle as a unit: per-order rows carrying Zomato's order id, **placement timestamp**, gross, commission and net; the cycle's deductions; its cycle-level deductions; and Zomato's stated payout.
- [x] 3.2 Resolve each order's business date server-side through `app_business_date` with that outlet's `business_day_cutover`. Never accept a business date from the caller, and never reimplement the cutover in the job.
- [x] 3.3 Reject the whole cycle when any order lacks a placement timestamp, reporting the orders concerned rather than falling back to Zomato's own date.
- [x] 3.4 Enforce the reconciliation gate: recompute per-order payouts less deductions, compare against the stated payout, accept within one rupee, and refuse the entire cycle beyond it, marking its dates disputed. Commit all rows or none.
- [x] 3.4a Mark a settled day revised where its figures differ from the provisional ones it replaced, retaining those figures; leave an unchanged day unmarked.
- [x] 3.4b Accept-with-difference path: write the per-order figures for a disputed cycle and record the remaining gap as a cycle-level unexplained settlement difference with the accepting account and moment. Adjust no day's figures. Reject any request that would write a disputed cycle without either reconciling it or recording the difference.
- [x] 3.5 Validate the payload's outlet against the credential's permitted outlets, because the function writes with the service role and therefore bypasses RLS.
- [x] 3.6 Idempotent upserts keyed on Zomato's identifiers for orders, expenses and cycle deductions, so an overlapping re-run changes nothing.
- [x] 3.7 Supersede rather than overwrite: where a day carries an owner-typed Zomato figure, move it to the retained columns with a timestamp before writing the synced triple.
- [x] 3.8 Record the run's outcome in `aggregator_sync_runs`, distinguishing the three failure classes; write nothing for a date whose data could not be obtained, and never write a zero.
- [x] 3.9 Version the request contract so a Zomato shape change breaks the job rather than the database.

## 4. Write-contract tests

- [x] 4.1 A cycle whose total reconciles is written; every day gets its triple and a settlement state.
- [x] 4.2 A cycle out by more than a rupee is refused whole, previously stored figures for those dates are byte-for-byte unchanged, and those dates read disputed rather than provisional.
- [x] 4.2a A disputed cycle that reconciles on a later run becomes settled and stops reading disputed.
- [x] 4.2b Accepting a disputed cycle writes the per-order figures, records the difference once with its accepting account, adjusts no day's figures, and a second acceptance creates no second difference record.
- [x] 4.3 A cycle out by a few paise is accepted, and stored figures are Zomato's own rather than adjusted to close the gap.
- [x] 4.4 An order placed at 00:30 lands on the previous business date at an outlet cutting over at 04:00; an order at exactly 04:00 opens the new day.
- [x] 4.5 Re-running an identical cycle changes no row and creates none.
- [x] 4.6 A provisional cycle that later settles is rewritten in place, stays one row per outlet per business date, and a settled day is not downgraded by a later provisional read.
- [x] 4.6a A settled day whose figures moved is marked revised and retains what they moved from; one whose figures did not move is not marked revised.
- [x] 4.7 A typed figure is retained with its superseded moment, participates in no computation, and both figures are readable.
- [x] 4.8 A cycle-level deduction is stored against its named period and creates no ledger row for any business date, including none for the epoch date.
- [x] 4.9 A deduction expense lands on its spend date, is marked non-cash, and leaves that day's expected cash and difference unchanged.
- [x] 4.10 A payload naming an outlet the credential may not write is refused.

## 5. Ledger reading and arithmetic

- [x] 5.1 In `src/features/manual-ledger/ledger.ts`, compute a synced day's Zomato revenue from the stored net and a pre-sync day's from its stated figure and stored rate, choosing by the day's own stored values rather than by today's configuration.
- [ ] 5.2 The month's aggregator revenue and cash-basis profit read synced days from stored net, and a test proves a historical month's totals are unchanged by this change.
- [ ] 5.3 Present a synced day's effective rate as a computed reading only; prove no stored percentage participates in computing a synced day's net.
- [ ] 5.4 Prove commission is still never an expense and never a category, as `manual-ledger` already requires.
- [ ] 5.5 Integer paise throughout; no float is constructed on any path added by this change.

## 6. Owner-facing surfaces

- [ ] 6.1 Day form: where a channel is synced for that business date, present gross, commission, net and the settlement state as a reading, with no revenue field and no rate field for that channel.
- [ ] 6.2 Day form: a day with one channel synced and one not shows a reading beside an entry group, each labelled for what it is, and stores correctly.
- [ ] 6.3 Day form: show a superseded typed figure beside the synced one, marked as superseded and visibly not part of the total.
- [ ] 6.4 Extend the section's existing explanation affordance to say what provisional means and that it will be replaced when the week settles; keep it reachable by tap, self-reporting as open, and dismissable from the keyboard.
- [ ] 6.5 Zomato sync surface, owner-only, taking the collapsed-row shape the attendance screen already uses: a header line stating when the sync last ran and whether it succeeded, then a list of events. Runs that changed nothing produce no row.
- [ ] 6.6 Event rows: a day written, a week settled, a day revised, a week disputed, a session lapsed, a possible duplicate expense. Each collapsed row states in one line what changed, and where a figure was replaced, states what it changed from as well as to.
- [ ] 6.7 Rows needing the owner are presented expanded with their actions; ordinary rows stay collapsed. Prove both in one list.
- [ ] 6.8 A disputed week's row shows the outlet, the cycle, both totals and the difference, and offers exactly Re-check and Accept the difference. No action writes the cycle without reconciling it or recording the difference.
- [ ] 6.9 Accepting asks for confirmation naming the amount that will be recorded as unexplained, then calls the accept path from 3.4b.
- [ ] 6.10 A lapsed session reads as an action the owner can take rather than a generic failure, and offers reconnecting from this surface.
- [ ] 6.11 Possible-duplicate signal on this surface: a hand-entered expense sitting near a synced one at the same outlet, similar date and similar amount is shown as a possible duplicate for the owner to void. Never delete either row automatically.
- [ ] 6.12 The surface is reachable by a Super Admin only, and no other role can open it or read its rows.
- [ ] 6.13 Accessible names on any field or control this change adds or relabels identify the channel, the unit and the action unambiguously; no added field's font size crosses the mobile-zoom threshold; every action on this surface is reachable and operable from the keyboard.

## 7. Demo mode and fixtures

- [ ] 7.1 Demo fixtures cover a provisional day, a settled day, a revised day, a disputed week, a superseded typed figure and a possible duplicate expense, so every state and every action on the sync surface is demonstrable without live credentials.
- [ ] 7.2 The four-role demo walkthrough still walks, and no demo role gains sight of settlement records it should not have.

## 8. Reader job contract (private repo)

- [ ] 8.1 In `abdatta/shawarmania-zomato-sync`, build the cycle payload from the dashboard JSON for the live cycle and from the settlement workbook's `Order Level` sheet for settled cycles, converting workbook doubles to paise once at parse time.
- [ ] 8.2 Join Order History on `order_id` to obtain placement timestamps; report orders that cannot be timestamped rather than guessing.
- [ ] 8.3 Post cycles to the Edge Function; re-read two cycles for orders and four for deductions on every run.
- [ ] 8.4 Schedule twice daily at roughly 23:00 and 10:00 IST, with the timezone pinned; open a GitHub issue on failure and reuse the open one rather than filing a new one per run.
- [ ] 8.5 Restrict the job to the two trading outlets, 21917311 Kalyani and 22675834 Kanchrapara. The account's third restaurant id is a discontinued outlet and is not read.

## 9. Rollout

- [ ] 9.1 Set the synced-from date for one outlet and watch one full weekly cycle settle end to end.
- [ ] 9.2 Set the second outlet.
- [ ] 9.3 Confirm rollback: clearing the synced-from date returns the form to typed entry, leaves historical synced days reading exactly as stored, and destroys nothing.

## 10. Docs

- [ ] 10.1 `docs/BUSINESS_CONTEXT.md`: the app now reconciles Zomato payouts; say what that means and what it still does not cover.
- [ ] 10.2 `docs/PROJECT_OVERVIEW.md`: remove the statement that there is no Zomato integration.
- [ ] 10.3 `docs/DATA_MODEL.md`: the new columns, the three new tables, and which day computes by which rule.
- [ ] 10.4 `docs/OPERATIONS.md`: the owner stops typing Zomato revenue and Hyperpure expenses; what to do when the session lapses, and how to resolve a disputed week by re-checking or accepting the difference.
- [ ] 10.5 `docs/LIMITATIONS.md`: remove the aggregator inaccuracy this change closes, and record what remains — Swiggy still typed, no item-level aggregator sales, a one-time password roughly once.
- [ ] 10.6 `docs/SCREENS.md`: the day form's synced reading and the Zomato sync surface, including its event rows and the two actions on a disputed week.
- [ ] 10.7 Update `openspec/todos/aggregator-settlement.md`: its blocking question is answered (settlement is per order, dated by placement) and its settlement-reconciliation half is delivered here; leave the aggregator-billing half standing.

## 11. Phase gate

- [ ] 11.1 PHASE GATE (ROADMAP #42): both outlets' Zomato revenue arrives without being typed and reconciles to Zomato's stated payout within a rupee across at least two consecutive settled cycles, proved in the suite rather than by a production run; a week deliberately made not to reconcile is refused whole, leaves prior figures byte-for-byte unchanged, reads as disputed rather than provisional, and can be resolved from the sync surface by re-checking or by accepting it with the difference recorded; a settled day whose figures moved is marked revised and retains what they moved from; an order placed at 00:30 lands on the previous trading day; a Franchise Admin, Biller and Employee are each refused every settlement and deduction record by the database, proved by a hand-crafted request; a historical month's totals are unchanged; and the four-role demo walkthrough still walks.
