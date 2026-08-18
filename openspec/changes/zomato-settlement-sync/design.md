## Context

The ledger's aggregator revenue is the only money figure with no independent check. It is typed from the Zomato dashboard against a commission rate typed once, and nothing compares it to the payout that reaches the bank.

Investigation against the live account on 2026-08-16 established the facts this design rests on. All were measured, not assumed.

- Settlement is **per order**, each order carrying its own post-commission figure, and orders are dated by **placement**. An order at 23:19 stays on that day.
- The effective commission rate moves between roughly **24% and 35%** day to day. A stored rate cannot reproduce a day's net.
- The live dashboard's per-order net **omits cancellation refunds**. When an order is rejected after the kitchen has cooked it, Zomato refunds the restaurant a share and pays it, while the orders tab shows that order at zero. One cycle at Kanchrapara was ₹79.15 short for exactly this reason.
- The settlement workbook's per-order payout column, summed and less that cycle's deductions, reproduces the stated payout **exactly**.
- Deductions carry a real spend timestamp and settle **4 to 11 days** later, sometimes in a later cycle than the one containing their date.
- Tax deductions arrive disguised as rejected orders with a null date and a negative amount, referring to a week other than the one paying them.
- Zomato's date filter **snaps to the enclosing Mon-Sun payout cycle**. A single day cannot be queried.
- The account lists a third restaurant id, `21881022`, which the owner confirmed on 2026-08-17 is a discontinued outlet. It is ignored, and the outlet list is the two trading outlets.
- Zomato does not email settlement statements, confirmed by the owner on 2026-08-17. Driving the session is the only ingestion path available.

The reader itself is built and proven in the private repository `abdatta/shawarmania-sync`, kept out of this public repo because it holds a live merchant credential and the shop's revenue. Its session survives across GitHub runner IPs and renews on a sliding 24-hour idle timeout, so a twice-daily job keeps itself authenticated.

Constraints from `AGENTS.md` that bind this design: money is integer paise, outlet isolation is enforced in Postgres, business dates are explicit columns with a per-outlet cutover and never derived at read time, and the service-role key never reaches the browser.

## Goals / Non-Goals

**Goals:**

- A day's Zomato revenue arrives without being typed, and is exact rather than estimated.
- A settled week's figures reconcile to the payout, and a week that does not reconcile is refused rather than written.
- A late-night order lands on the trading day the counter would put it on.
- Deductions land on the day the money was spent.
- The owner can tell a provisional figure from a settled one, and can see what their own typed guess had been.
- The blast radius of a leaked automation credential is "can post settlement rows", not "full database".

**Non-Goals:**

- Swiggy, item-level aggregator sales, the OAuth refresh token that would remove the one-time password, and any change to cash, UPI or drawer arithmetic. All are named in the proposal's non-goals.
- Automatically deleting the owner's hand-entered supply expenses. See the duplicate decision below.

## Decisions

### Two sources, not one: dashboard for the live week, workbook for settled weeks

The live cycle is only available from the JSON dashboard, and the settled truth is only available from the workbook. Neither alone is sufficient.

- *JSON only* was rejected: it silently omits cancellation refunds, so the ledger would under-report revenue forever and every check would still pass.
- *Workbook only* was rejected: it does not exist until a cycle settles, so the owner would see nothing for the current week, which is most of what they look at.

The cost is two parsers and a swap. The swap is not incidental complexity, it is the mechanism by which a provisional number becomes a correct one, which the owner asked for explicitly.

### Store gross, commission and net as measured paise, not a rate

The existing `zomato_commission_bp` stored an integer basis-point rate and derived net. Reproducing one measured day, 15 Aug at Kalyani, gross ₹2,970.03 and net ₹2,131.11 implies 2824.89 bp; rounded to 2825 bp the ledger recomputed ₹2,131.02, nine paise adrift.

The first version of this change kept that column for Swiggy and for pre-sync days, which left two representations of one idea. The owner cut it instead [2026-08-17]: commission is an amount everywhere, typed days included, existing production rows are converted, and there is no carry-forward. What made a rate defensible was that a typed day had nothing better; what makes it indefensible is that a rate is not one number. Zomato publishes a 14% base service fee, and the actual take on one sampled order was 37.8%, because the charge is that fee plus a per-kilometre fulfilment fee less a capping discount plus a payment fee plus tax on all of it.

Nine paise is nothing as money and fatal as a check: the entire value of this change is being able to say a week matched to the paisa, and a derived net can never be exactly zero against Zomato.

- *Keeping the rate and widening it to more decimal places* was rejected: it makes the drift smaller without making it zero, and still stores a derivation where a measurement is available.
- The rate column **stays** for Swiggy and for days recorded before the sync, so no historical month moves.

### The database decides the business day, not the job

`app_business_date(ts, cutover)` already exists in SQL, mirrored by `resolveBusinessDate` in TypeScript, and `validate_business_date()` rejects rows whose stated date contradicts their timestamp. A third implementation inside the sync job would be a third thing to keep identical.

The job therefore submits **order placement timestamps** and lets the write path resolve the business date through the existing function. This also means the existing trigger guards the sync exactly as it guards the counter.

Consequence: the finance rows carry a date but no time, so placement timestamps must be joined from Zomato's Order History on `order_id`. That is a second endpoint the job must call and keep working, accepted deliberately because the alternative is misdating every order between midnight and 04:00.

### The job writes through an Edge Function, not directly to Postgres

The sync runs on GitHub Actions in a separate repository. Whatever credential it holds can leak.

- *Direct Postgres with the pooler password*, or *the service-role key in GitHub secrets*, were both rejected: either grants full read and write over staff records, attendance and billing. The automation needs to append settlement rows for two outlets and nothing else.
- The chosen path is a dedicated Supabase Edge Function authenticated by its own secret. It validates the payload, resolves business dates, enforces the reconciliation rule, and writes with the service role **inside the function**, which never leaves the server.

This also gives the contract a version, so a Zomato shape change breaks the job rather than the database.

### A cycle is written atomically, and the reconciliation check gates the write

The reconciliation identity is a property of a whole cycle, not of a row, so it cannot be enforced per insert. The function accepts one cycle for one outlet as a unit: its per-order rows, its deductions, and Zomato's stated payout. It recomputes the identity server-side and commits all rows or none.

Tolerance is **one rupee**. Zomato renders every figure to two decimal places, so summing a hundred displayed values drifts a few paise against its own unrounded arithmetic. Four of eight measured cycles drifted 4 to 8 paise and meant nothing; the one that mattered was ₹79.15. A tolerance of zero would cry wolf nightly, and a tolerance of, say, a hundred rupees would have missed the real finding.

The tolerance is not applied to the *stored figures*, only to the decision to accept the cycle. Stored figures are always Zomato's own.

### Three outcomes when the workbook disagrees with the daily figures, and all three are labelled

A settled week can land three ways against the provisional days already stored, and each needed a name.

1. **It agrees.** The day becomes `settled`. Nothing else to say.
2. **It differs, and the week still reconciles to the payout.** The workbook wins, and the day becomes `settled` and is marked **revised**, retaining the provisional figures it replaced. This is the ordinary case, usually a cancellation refund, so the figure goes up. Leaving it unmarked was rejected: the owner would find a day reading ₹79 higher than it did on Monday with no trace of why, which is exactly the kind of unexplained movement this change exists to remove.
3. **It differs and the week does not reconcile.** The cycle is refused, and its days become **disputed**. Leaving them reading `provisional` was rejected: a paid week that does not add up looks identical to the current week that has simply not been paid yet, so it would sit unresolved indefinitely. `provisional` means *not yet paid*; `disputed` means *paid, and we cannot account for it*.

The state machine is therefore `provisional → settled`, `provisional → disputed`, and `disputed → settled`. A settled day is terminal, as the existing constraint requires. `revised` is a marker on a settled day rather than a fourth state, because it describes the day's history rather than where it stands.

### A disputed week is resolved by re-checking or by recording the difference, never by absorbing it

A disputed week needs a person, and the obvious button, "approve", is the one that must not exist: approving would write figures already known not to add up. Two actions instead.

- **Re-check** re-reads and reconciles again. Zomato's own figures move after a payout, so most disputes should clear here without a decision being made at all.
- **Accept the difference** writes Zomato's per-order figures and records the leftover gap as its own cycle-level record, attributed to no business date, named as an unexplained settlement difference and stamped with who accepted it. The money then reconciles and the unexplained part stays visible as one line.

*Spreading the difference across the week's days* was rejected outright: it makes every day slightly wrong, makes the total look correct, and destroys the only evidence that anything was ever off.

The record uses the same cycle-level deduction shape TDS already needs, with its own kind, rather than a fourth table.

### The sync's surface lists events, not runs

The sync runs twice daily across two outlets, so a row per run is roughly 120 rows a month of which nearly all say nothing changed. The surface therefore reports the last run's time and outcome as a single line, and lists rows only for things that happened: a day written, a week settled, a day revised, a week disputed, a session lapsed, a possible duplicate expense.

This takes the shape attendance already uses, rows collapsed by default and only actionable ones open, which the owner asked for by name and which the codebase already has a pattern for.

- *A row per run* was rejected: a log nobody reads is the same as no log.
- *Alerts only, with no record of ordinary changes* was rejected: the point of the page is being able to answer "why did this day's number move", which needs the ordinary events too.

It absorbs the health readout and the reconnect prompt rather than adding a surface beside them, and it is where the possible-duplicate expense signal lives, since that is the other thing that needs the owner and had nowhere to appear.

### The owner can start a run, and repair a session, without leaving the app

Added 2026-08-17. The proposal made both of these non-goals: runs were scheduled
only, and the one-time password was to be dealt with out of band on the reasoning
that the sliding session would make it close to a one-off. That reasoning holds
for how *often* it happens and misses what happens *when* it does. A sync nobody
can start is a sync nobody can try, and a session that can only be repaired from
a terminal stays broken for as long as the owner is away from one, which for a
person running two counters is most of the day.

- **Starting a run** goes through an Edge Function that dispatches the reader's
  workflow with a token held server-side. *Putting a GitHub token in the browser*
  was rejected on sight: it would be readable by anyone with the page open, and
  it grants far more than starting one workflow.
- **The button reports the run, not the dispatch.** Dispatching succeeds long
  before the reader has done anything, so a button that went green on dispatch
  would say "synced" about a job that had not started. It resolves against the
  run's own outcome row.
- **The one-time password** is entered by the owner into a field on the sync
  surface and collected by the job. It is stored only until the job takes it,
  never logged, never echoed, never in a URL. It is a credential moving through
  the app, so it gets the same treatment the account invite codes already get.
- *Removing the password entirely* is still the better answer, and still later
  work: the login already requests `scope=offline`, so a refresh token exists.
  This relay is what makes the sync usable before that lands, not a reason to
  stop wanting it.

### Idempotency is keyed on Zomato's identifiers

Every row carries the Zomato `order_id` or expense id it came from, unique per outlet. Re-running an overlapping window updates in place. This is what makes the re-read windows safe: two cycles for orders, four for deductions, on every run.

### Possible duplicate supply expenses are flagged, never auto-deleted

Change #37 shipped free-text expense categories and the production rows already carry `Hyperpure`, so the owner has been entering these by hand. Once the sync writes them too, the same purchase can appear twice.

- *Auto-deleting the owner's row* was rejected. `manual_ledger_expenses` is append-only on delete by existing requirement, the owner's row may carry a note the synced one lacks, and silently removing somebody's record to resolve a guess is the wrong default for money.
- The synced row is marked with its source. Where a hand-entered row sits on the same outlet, near the same date, for a similar amount, the surface **shows both and marks them as a possible duplicate**, and the owner voids one. Voiding already leaves a trace by existing requirement.

**The two rows will not agree exactly, and the rule must not expect them to** [owner, 2026-08-17]. A hand-entered expense is typed off a paper bill or out of memory: the amount is often rounded to the rupee or to the nearest ten, and the date is frequently when the owner noticed the bill rather than when the money was spent. Zomato reports the invoice to the paisa, dated to the purchase. An exact match on amount and date would catch almost none of the duplicates that actually occur.

The tolerance is decided by an asymmetry rather than by taste. **A flag the owner dismisses costs one tap. A duplicate nobody flags overstates costs and understates profit, quietly, permanently, and in the one direction that makes the business look worse than it is.** So the rule is deliberately loose, and the surface carries the cost of that by showing both rows in full so the owner can judge:

- **Same outlet**, exactly. Not a tolerance; a Kalyani bill is not a Kanchrapara bill.
- **Amount within the larger of 2% or ₹50.** Proportional because rounding scales: ₹5 off ₹3,747 is a typo, ₹5 off ₹50 is a different purchase.
- **Date within four days either way**, which covers noticing a bill over a long weekend without reaching into the next week's shopping.
- **Neither row already voided**, and neither already settled as not-a-duplicate.

Category and description are deliberately **not** matched on. Categories are free text and the two sides name the same purchase differently by construction — "Hyperpure, paid online" against "Hyperpure invoice HP-88213" — so requiring them to agree would narrow the rule using the least reliable field on the row.

*Matching only on an exact amount* was rejected as the case that does not happen. *Matching on description similarity* was rejected as a second thing to tune with no evidence behind it. If the flag proves noisy in practice the tolerances tighten; being noisy is the recoverable failure and being silent is not.

### A per-outlet, per-channel "synced from" date

Days before the sync existed must keep computing from their typed figure and stored rate, exactly as recorded. This is the same problem `billing_go_live_date` already solved for cash and UPI, and it takes the same shape: an explicit stored date per outlet per channel, set deliberately, never derived from the presence of synced rows.

Deriving it would move the boundary onto a day that was already typed, and count that day twice.

### Money arithmetic

Two conversions, both traps.

- The JSON renders money as display strings such as `"₹1,234.56"` and `"- ₹311.24"`. These are parsed by string manipulation into signed integer paise. No float is constructed at any point.
- The workbook stores numbers as IEEE doubles. These are converted to paise by rounding to the nearest paisa at parse time, once, and every total thereafter is integer arithmetic. The cycle-level reconciliation assertion is the check that this conversion did not drift.

### Row-Level Security

Every new table carries policies matching what the ledger already grants: the owner across outlets, and Franchise Admin, Biller and Employee refused these financial rows entirely, proved by hand-crafted requests in the change's tests as `AGENTS.md` requires. The Edge Function writes with the service role and therefore bypasses RLS, so it validates the outlet in the payload against the credential's permitted outlets rather than trusting the caller.

### Offline

None of this is offline-capable and none of it should be. The sync is a scheduled server-side job; it touches no counter path, no outbox and no IndexedDB. The counter's never-block-on-network guarantee is unaffected because the counter never reads or writes these rows.

## Risks / Trade-offs

- **Zomato changes its response shape and the sync silently writes wrong numbers** → The reconciliation identity is re-verified every run against Zomato's own stated payout, so a semantic change fails loudly rather than passing an HTTP status check. This is what caught the ₹79.15.
- **The owner's Zomato session lapses while they are away** → Sliding 24-hour idle timeout with a twice-daily job means it should not, but if it does, the job writes nothing, reports a distinct failure state, and the owner reconnects. No zeros are ever written.
- **A cycle never reconciles, so its days never get settled figures** → The days keep their provisional figures rather than being blanked, are labelled disputed so they cannot be mistaken for the current week, and appear on the sync's surface with both totals and the two actions. Silence is the failure mode being designed out.
- **Disputes accumulate because re-checking is easier than deciding** → A disputed week stays disputed and stays on the surface until it is resolved, so the cost of not deciding is visible rather than hidden. Worth revisiting if disputes prove common enough to need chasing.
- **The Order History join fails and orders cannot be timestamped** → Those orders are held unattributed and reported rather than falling back to Zomato's midnight date, which would misdate every late-night order without anyone noticing.
- **The duplicate-expense signal is noisy or is ignored, and costs are double-counted** → The signal is a reading, not an automatic action, so the failure mode is a visible unresolved flag rather than a quiet deletion. Worth revisiting if it proves noisy in practice.
- **A leaked GitHub secret** → It authenticates one Edge Function scoped to posting settlement rows for named outlets. It is not a database credential. Rotating it is a secret change, not a password rotation.
- **Building on a table slated for replacement** → `manual_ledger_days` is the stopgap #36 introduced, and #12 and #13 will retire parts of it. The aggregator columns are the part #10 explicitly left in place, so this is the least-moving part of that table. The write path is a versioned function, so the destination can change without changing the job.

## Migration Plan

1. Additive migration only: new columns on `manual_ledger_days`, a source identity on `manual_ledger_expenses`, a new cycle-deduction table, and a per-outlet per-channel synced-from date. Nothing is dropped and no existing row is rewritten.
2. Ship RLS policies and isolation tests with the tables, in this change, as the agent contract requires.
3. Deploy the Edge Function and its secret. Nothing changes for the owner yet.
4. Set the synced-from date for one outlet, watch one full weekly cycle settle, then the second outlet. The owner checks the figures themselves; no report-only rehearsal is run, because the reconciliation gate already refuses a cycle that does not add up and the superseded typed figures remain readable if a comparison is ever wanted.
5. Update the docs named in the proposal, including `docs/LIMITATIONS.md`, which currently documents the inaccuracy this removes.

**Rollback**: clear the synced-from date. The form returns to accepting typed figures, historical synced days keep reading exactly as stored, and no data is destroyed. The migration itself is additive and needs no reversal.

## Open Questions

- **Does the workbook expose a cancellation refund per order, or only in aggregate?** The refund total is a column on the order-level sheet. If it is attributable per order, refunds land on their own trading day; if only per cycle, they need a placement rule of their own.
- **How often does the one-time password actually get asked for?** Expected to be close to never. If it proves frequent, the OAuth refresh token named in the non-goals moves from later work to necessary work.
