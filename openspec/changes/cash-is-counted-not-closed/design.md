## Context

The cash schema landed in `20260726000008_daily_cash.sql` with one record per
outlet per business date, written only by `close_business_day()`, immutable once
written. Every requirement in `openspec/specs/daily-cash-reconciliation/spec.md`
elaborates that shape. The surface was built to match in #7 and has been
`demo`-gated ever since, so **none of it has ever run against production data**,
and `daily_cash_records` has never held a live row.

That is fortunate, because the model is wrong. It assumes the drawer is counted
at the end of a business day. It is counted in the middle of one, at a time the
collector picks, sometimes after skipping a day or two, and sometimes entered an
hour later from somewhere else. The proposal states the owner's own account.

**Everything below was verified against the production database on 2026-08-26**,
by read-only query, rather than inferred from the repo. The figures are the
baseline this change is sized against.

| | Kalyani | Kanchrapara |
|---|---|---|
| Settled bills, first business date | 364, from 2026-08-12 | 320, from 2026-08-14 |
| Of those, Cash | 88 | 106 |
| `manual_ledger_days` rows | 19, 2026-08-01 to 08-23 | 19, 2026-08-01 to 08-22 |
| Of those, carrying a count | 15 | 15 |
| `manual_ledger_expenses` rows | 42 | 65 |
| Live Franchise Admin assignments | **0** | **0** |

`daily_cash_records`, `cash_withdrawals` and `public.expenses` each hold
**zero rows**. `billing_live_from` is null at both outlets.

**Re-read 2026-08-27, immediately before the migration was written (task 1.2).**
Every figure decision 16 depends on still holds: the three tables hold zero rows,
`billing_live_from` is null at both outlets, and no live Franchise Admin
assignment exists anywhere — the live rows are two business-wide Super Admins
plus one Biller and two Employees per outlet, which is what makes decision 11 the
only path that works on day one. Bill counts and dates are unchanged; the last
settled date has moved on to 2026-08-26 as trade continued.

**One row of the table above is measured on the wrong basis, and the correct
figure is larger.** "Of those, Cash" counted `bills.payment_method = 'cash'`,
which is the nullable *single-tender summary* column — it is null on a
split-tender bill, so a bill settled part cash and part UPI was not counted at
all. This change's own receipt basis is the latest accepted effective Cash
allocation (decision 2), and on that basis the figures are **93 at Kalyani and
125 at Kanchrapara**: 88 and 106 single-tender, plus 6 and 18 split-tender bills,
adjusted by the two tender corrections below. The original numbers are left above
as the dated record of what was read; this paragraph is what the change is sized
against.

**Production already contains a correction in each direction**, which is a
better fixture for task 3.2 than anything a test could invent: on 2026-08-19 a
Kalyani bill moved `cash:20000` to `upi:20000`, removing a cash allocation
entirely, and on 2026-08-20 a Kanchrapara bill moved `upi:20000` to
`upi:15000, cash:5000`, creating one. A receipts term reading `bill_payments`
rather than `effective_bill_payments` gets both of those wrong today, not
hypothetically.

Four facts about the current codebase and its data shape what is possible here:

- **A payment instant already exists.** `bills.paid_at` is a `timestamptz`, and
  `bill_payments.created_at` carries the per-allocation instant. `pay_billing_order`
  bounds `paid_at` to within 300 seconds of the command's own `created_at` and
  refuses a `payment_business_date` that disagrees with
  `app_business_date(paid_at, cutover)`. So the interval model has something real
  to filter on.
- **An expense has no instant.** `public.expenses` and
  `public.manual_ledger_expenses` carry `business_date` plus a server
  `created_at`. A date cannot be placed on one side of a 22:00 boundary.
- **`billing_live_from` does not gate any of this.** It controls one thing:
  whether the *manual ledger form* asks for typed Cash and UPI at that outlet.
  Bills are rung and stored either way. A derived reader over `bills` needs no
  handover to have been performed. The `ledger-handover-per-outlet` todo, written
  12 Aug, is stale in two ways: it records that Kanchrapara has no tablet, and
  that outlet has been ringing real bills since 2026-08-14. The flag is dead once
  the form it serves is gone, and #12 drops it.
- **Device clock skew is sub-second, so a mid-day boundary is safe.** Across all
  684 settled bills, `synced_at - paid_at` has a median of 1.2 to 1.3 seconds and
  a 95th percentile of 2.4 to 3.2 seconds. Twenty-eight bills carry a device clock
  marginally ahead of the server, by at most 0.9 seconds. The worst lag, 14.9
  hours at Kanchrapara, is delivery rather than skew: an offline queue draining
  later, which is the reconciliation-exception case in decision 10 and which has
  therefore **already happened in production**.

The only genuine history gap is dates before an outlet's tablet was ringing
bills: twelve such days at Kalyani and thirteen at Kanchrapara. Those live in
`manual_ledger_days` and are carried across by #12.

One more thing the production data settles, and it is worth knowing before
writing decision 4. **The notebook's opening-cash chain is already broken in
places.** At Kalyani, 2026-08-12 opens at ₹340 where the previous day counted
₹490, and 2026-08-14 opens at ₹510 where the previous day counted ₹310. Days
2026-08-18 to 08-20 are simply missing. So "report the break and repair nothing"
is not a hypothetical safeguard: it is what the surface will do on the first day
it renders real history.

**The rehearsal ran on 2026-08-27 and found eleven breaks, not three**
(`scripts/rehearse-august-drawer.mjs`). The three above are real; the dates
attached to two of them name the day whose *count* is involved rather than the
day whose stored *opening* disagrees, which is the day after, and the missing run
is 08-19 to 08-21 rather than 08-18 to 08-20. The dates the surface will actually
mark, verified against the raw rows:

| Outlet | Date | Break |
|---|---|---|
| Kalyani | 2026-08-11 | 2026-08-10 absent; the chain has nothing to join to |
| Kalyani | 2026-08-12 | opens ₹340 where 08-11 counted ₹440 (−₹100) |
| Kalyani | 2026-08-13 | opens ₹340 where 08-12 counted ₹490 (−₹150) |
| Kalyani | 2026-08-15 | opens ₹510 where 08-14 counted ₹310 (+₹200) |
| Kalyani | 2026-08-22 | 08-19 to 08-21 absent |
| Kalyani | 2026-08-22 | opens ₹550 where 08-18 counted ₹350 (+₹200) |
| Kanchrapara | 2026-08-15 | 2026-08-14 absent |
| Kanchrapara | 2026-08-17 | opens ₹160 where 08-16 counted ₹300 (−₹140) |
| Kanchrapara | 2026-08-20 | 2026-08-19 absent |
| Kanchrapara | 2026-08-20 | opens ₹140 where 08-18 counted ₹470 (−₹330) |
| Kanchrapara | 2026-08-22 | 2026-08-21 absent |

The rehearsal **asserts these rather than describing them**: a run that finds no
breaks exits non-zero and says so, because a clean result would mean the chain
check does not work rather than that the data is sound.

**Three further findings, each of which sizes something in this change.**

- **The mid-day boundary is worth ₹4,640 in one month, measured.** Placing a
  22:00 count on every real trading date and splitting that date's cash by
  payment instant, ₹740 at Kalyani (4 bills, 3 dates) and ₹3,900 at Kanchrapara
  (21 bills, 8 dates) was rung *after* the count. `close_business_day()` would
  have reported every paisa of that as a shortfall on a drawer that was never
  short. The proposal argues this is fiction on every ordinary night; this is the
  figure. Kanchrapara trades past 22:00 on 8 of its 13 cash dates, so it is the
  ordinary case there rather than an edge.
- **The notebook and the counter already disagree on the dates both cover.**
  From each outlet's first tablet day, 5 of 9 Kalyani dates and 1 of 6
  Kanchrapara dates disagree on typed versus derived cash revenue, and the
  notebook has **no row at all** for 3 Kalyani and 7 Kanchrapara dates the
  tablet billed. Kalyani's month differs by ₹10,150. Two causes are visible and
  both belong to #12 rather than here: 2026-08-12 is a go-live day part typed and
  part billed — exactly the double-count `billing_live_from` exists to prevent,
  and it is null at both outlets — and the notebook simply stopped being kept
  after 08-23 while the counter kept trading. **This is a finding for #12's
  carry-over, not a defect in the derived reader**, and it is why the reader is
  not asked to reconcile the two.
- **A negative cash-out already occurs in production**, once at each outlet
  (Kalyani 2026-08-23, Kanchrapara 2026-08-22) as a non-zero `cash_added_paise`.
  Decision 5's claim that this needs no concept of its own is therefore replayed
  against real rows rather than invented ones: `removed − added` produced the
  right expected figure on every date, with no branch.

## Goals / Non-Goals

**Goals**

- Make a mid-shift count the ordinary case, with no special path for a skipped
  day and no special path for a late entry.
- Make the arithmetic anchor on physical cash, so a variance is recorded once
  and never propagates.
- Make the Ledger fill itself, with two facts typed by a human anywhere in the
  system: an expense, and a count.
- Keep the one rule worth keeping from the old model, in words that survive the
  loss of the ritual it was attached to.
- Ship it in one push that reverts by opening a different tab.

**Non-Goals**

- Suggesting a count time. See decision 7.
- Dropping, renaming or migrating anything. See decision 16.
- Re-homing the billing-readiness gate. See decision 12.
- A runtime toggle. See decision 17.

## Decisions

### 1. The drawer is a continuous balance; an observation is the unit

A `drawer_observation` records that a named person saw a specific amount in a
specific outlet's drawer at a specific instant. The business day is not its
container; it has none. Days remain real for revenue, expenses and reporting,
and are derived for the drawer.

**Rejected: keep the day and require counts at the cutover.** It is the smaller
change and it asks the business to work at 04:00 to suit a schema. It would also
not fix the late-entry case, because a count typed at 23:00 for a day that ends
at 04:00 is still measured against cash that has not arrived.

**Rejected: keep the day record and store a count time on it.** Two counts in
one day break it, a count spanning three days breaks it, and the arithmetic
still has to reach across day rows to be correct. At that point the day row is
carrying no weight.

### 2. Interval boundaries are timestamps, not business dates

Cash receipts belong to an observation's interval when their payment instant
falls in `(previous observation's counted_at, this observation's counted_at]`.
Half-open at the start, closed at the end: a payment at exactly the previous
count's instant belonged to that count, and one at exactly this instant belongs
to this one.

The receipt basis is the **latest accepted effective Cash allocation** of a
settled bill, exactly as the superseded rule already works for tender
corrections. A superseded original allocation and an earlier correction revision
contribute nothing. UPI, Swiggy and Zomato never move the drawer.

**Rejected: filter by `payment_business_date`.** It is what
`close_business_day()` does and it is precisely the bug: a date cannot express
22:00.

### 3. Carry-forward anchors to the counted figure, never the expected one

```
expected     = opening
             + cash receipts in the interval
             - cash expenses in the interval
             - cash out in the interval not belonging to this observation
difference   = counted_total - expected
next opening = counted_total - this observation's own cash out
```

The physical drawer is the truth going forward. A ₹500 shortfall is recorded as
a variance on the observation that found it and is not carried into the next
interval as phantom cash.

**This is the property that makes the whole design safe**, and it should be
stated in the surface and in `docs/DATA_MODEL.md`: **every observation
re-anchors the balance to physical cash, so a mistake, or a correction posted
three weeks late, can only ever pollute the one interval it sits in.** It cannot
ripple through a month.

**Rejected: carry the expected figure forward.** It makes the books agree with
themselves and disagree with the drawer, which is the wrong way round, and it
compounds one bad night into every night after it.

### 4. `opening_paise` is stored on each observation, not derived across rows

The value is written at insert from the previous observation's counted total
less its own cash out. It is never recomputed on read.

This is the same treatment `manual_ledger_days.opening_cash_paise` gets and for
the same stated reason (`docs/DATA_MODEL.md`): correcting Tuesday must not
silently move every row after it. Where a stored opening disagrees with the
previous observation's carry-forward, **the surface reports the break and
repairs nothing.**

Note this is the opposite of the rule inside one row, where a third derivable
column is refused because it could disagree with the two it comes from. Within a
row, derive. Across rows, store. Both rules exist to stop a figure changing
without anybody deciding it should.

### 5. One cash-out table with a kind, not two tables and not one kind

`drawer_cash_out` carries `kind` in `('collection', 'spend')`.

- **`collection`** is the nightly act. Amount and instant only. **No reason and
  no actor field**: the person is the session, and asking why the owner took the
  day's takings collects a column of the word "collection". A negative collection
  is cash added, see below.
- **`spend`** is rare, requires a reason, and exists for drawer cash that buys
  something. It must not become an expense, because `docs/DATA_MODEL.md` records
  that there is deliberately no capital marker and the month is a cash-basis
  **operating** estimate: a ₹40,000 fridge routed through expenses would move
  the drawer correctly and wreck the month. The escape hatch has to survive, and
  it survives as a small link well away from the primary action.

**A negative amount is cash going in, and there is no separate concept for it.**
`amount_paise` is non-zero and signed: positive is cash leaving the drawer,
negative is cash added to it. The scenario is real and the owner named it: a day
with weak sales or heavy cash expenses leaves too little in the till, so the
collector puts some of their own back at the moment of counting.

The arithmetic needs no new term, which is the whole argument for the sign:

```
expected     = opening + receipts - expenses - cash out in interval
next opening = counted_total - this observation's own cash out
```

Subtracting a negative adds. A ₹1,000 top-up recorded against a ₹450 count leaves
₹1,450, by the existing formula, with no branch anywhere.

Two constraints keep it honest. `kind = 'spend'` requires a positive amount,
because drawer cash cannot un-buy a fridge. And **the surface must state what a
negative means at the moment it is typed**, not on submit: the verb flips from
collecting to adding, the balance preview flips direction, and a plain line says
that a negative is money put in rather than taken out. That alert is the entire
protection against a mistyped minus, and it is required rather than advisory.

A negative requires no reason, because the owner asked for no extra fields and
the alert carries the meaning. Carried historical rows may still hold one, and
the column stays nullable so their reason survives.

**Rejected: a third kind, or a separate cash-in table.** It is the shape I first
proposed and the owner cut it. It doubles the write paths, adds a term to the
arithmetic, and asks a person standing at a till to choose between two buttons
that differ only in sign.

**Rejected: renaming the table to `drawer_cash_movements` for the signed
values.** More accurate in the abstract, but the arithmetic subtracts this term
and the owner's own words are "negative cash withdrawn". A name that matches both
the formula and how the business talks is worth more than one that matches the
sign domain.

`cash_withdrawals` is not extended into this role and is **not touched at all**.
It was only ever written by the day-close path, which never ran, so it should be
empty; it is left exactly as it is, written by nothing, and
`retire-the-manual-ledger` (#12) drops it after asserting that. Adding a column
to a table this change has no use for would break the additive-only rule in
decision 16 for no benefit.

**Rejected: collapse to a single reasonless collection.** It is what the owner
first asked for and it is right for the common path, but it leaves capital
spending with nowhere to go that does not corrupt the P&L.

**Rejected: two separate tables.** The interval arithmetic would have to sum
both, and a future third kind would mean a third table and a third term.

### 6. A count time that differs from the entry time is approximate, and the tolerance is derived in rupees

`counted_at` is human-supplied; `recorded_at` is `now()`. When they differ the
observation is **approximate by default**, with a plus-or-minus fifteen minute
window and one control to assert certainty.

The surface then states, in rupees, how much of a difference the timing could
account for, computed from actual cash throughput inside that window. A ₹50 gap
on an approximate count against ₹914 of nearby cash is noise. A ₹3,100 gap
against the same ₹914 is not, and the two read differently on screen.

Guardrails, enforced in the database:

- `counted_at <= recorded_at`. No counting in the future.
- `counted_at >` the previous observation's `counted_at` at that outlet. No
  slotting an observation into a settled interval.
- `counted_at >=` the outlet's first bill or its books opening, whichever the
  outlet has.

Both clocks are shown on the record with the lag visible, and `recorded_at` is
the server's, so the lag cannot be understated.

**Rejected: require an exact time.** People do not know it, and a required field
they cannot answer truthfully is a field they answer untruthfully.

**Rejected: ignore the approximation and treat every count as exact.** It
converts a timing artefact into a permanent unexplained variance, and after a
month of those nobody reads the column.

### 7. Report an exact coincidence as a fact; never suggest a nearby time

This is the most important refusal in the change.

Moving the count boundary does not move the expected figure smoothly. It jumps
by one bill at a time, so the reachable values in a window are a small discrete
set of prefix sums. In a representative hour around 22:15 the reachable
adjustments are roughly `-1768, -1450, -854, -715, -278, 0, +180, +780, +1200`,
about twenty-five values spread over a few thousand rupees.

Two consequences, and they point opposite ways:

- **An exact hit is unlikely to be chance.** If a difference equals a run of
  bills to the paise, saying so is an observation, not an excuse. The surface
  says: *"₹854 short. That is exactly the 3 cash bills rung between 22:04 and
  22:12."*
- **A near hit is almost always available.** A genuine ₹500 shortfall does not
  match any reachable value, but the nearest is `-278`, which would shrink it to
  ₹222. And ₹222 reads as rounding noise where ₹500 reads as a missing note. The
  denser the trade the denser the reachable set, so the ability to explain
  anything away is strongest on exactly the nights when a loss is easiest to
  hide.

Therefore the surface **must not** offer a nearby time, must not rank candidate
boundaries, and must not reveal where the balancing point is. It offers a
movable boundary over the nearby cash bills so the collector can correct the
time **from evidence they recognise**, and it lets the difference be whatever
that produces.

A test asserts the absence: given a difference with no exact match, the surface
proposes no alternative instant.

### 8. Editable until the next observation anchors on it, then append-only

An observation is fully editable by anyone who may record one at that outlet,
with no reason required and no trail on the row's face, until the next
observation at that outlet is recorded. That next observation reads its
`opening_paise` from this one, which is the moment the figure becomes
load-bearing.

After that, a correction is a `drawer_observation_adjustment`: dated,
attributed, reason required, with both figures readable. The original is never
overwritten.

Attribution names both the account that recorded and the account that last
corrected, as `manual_ledger_days` already does, so a count the owner recorded
and a manager later fixed does not read as though the owner entered what is on
screen.

**Rejected: freeze on save.** It is the old model's instinct. It makes a typo
permanent and would push people to record a compensating adjustment for a
mistake nobody has yet relied on.

**Rejected: always editable.** The next observation's stored opening came from
this figure; silently changing it would break the chain the surface promises to
report rather than repair.

### 9. The rule that survives, in the words that outlive the ritual

The old spec said a signed day is a snapshot and is never recomputed. There is
no signature and no day close any more, but the rule underneath both is intact
and must be carried verbatim into `cash-drawer`:

> **The app never changes a person's observation on its own.**

Everything the old freeze protected follows from that sentence, and none of it
depends on sessions, signatures or immutability.

### 10. Late-arriving work is reported beside an observation, never inside it

A cash allocation whose payment instant falls inside an interval that has already
been observed raises a reconciliation exception against that observation, naming
the bill, its amount, when it was rung, when it landed, and what the difference
would have been. Resolution is acknowledge-with-a-note or record a fresh
observation.

A late arrival may also **explain** a recorded variance rather than create one:
an over that turns out to be an unsynced tablet's cash. The recorded figure
stays, and the explanation sits beside it with its date.

Unsynced devices at the moment of counting are an **advisory, never a block**.
The collector is standing at the counter holding cash and must be able to record
what they counted. The advisory names how many devices and since when, and marks
the expected figure as possibly understated.

### 11. A Super Admin reaches every drawer; being on site is recorded, not required

Settled with the owner in this change, reopening the question #28 deliberately
left and the old #12 never answered.

- A Super Admin may record an observation, a collection, a spend and an
  adjustment at **any** outlet, holding no assignment there.
- A Franchise Admin may do the same at the outlets their live assignment names.
- A Biller and an Employee are refused every drawer read and write at every
  outlet, by the absence of a policy branch.

The observation records whether the person was inside the outlet's geofence,
reusing `app_distance_m` from `20260727000002_attendance_geofence.sql`. Inside
the fence it is one action with no reason. Outside it, a reason is asked for
first and is stored and shown on the row. **Nothing is refused for being
elsewhere**, exactly as attendance approval already works: a collector who
enters every count from home shows up as a column of reasons, which is oversight
that a refusal would not have produced.

The live fact that forced this: both Super Admins had their Franchise Admin rows
**deleted** rather than ended on 2026-08-01, so no live Franchise Admin
assignment exists at either outlet. Under the rule this change replaces, the
database would refuse everybody the primary action.

**Rejected: a manager-less-outlet flag the owner inherits.** Narrower and
genuinely attributable, but it is a new outlet state to maintain, it has to end
cleanly when a manager is appointed, and it answers a question about paperwork
with more paperwork.

**Rejected: require the owner to self-assign as Franchise Admin.** One action per
outlet, changes no rules, and the owner has called it what it is.

### 12. The billing-readiness gate is not re-homed

`billing_assert_day_ready()` has exactly one caller, `close_business_day()`. The
question it answers, whether a business date's billing is complete, is real, but
it cannot gate counting cash at 22:00 with orders open and tablets live, and no
day-level seal has ever been performed by anybody.

So it is not moved to a new surface. It stops being reachable when its caller
stops being called here, and both are dropped in #12. If a day-level billing
seal is ever wanted, it is its own change with its own justification.

### 13. Expenses gain a nullable occurrence instant

`occurred_at timestamptz null` on the expense table, defaulted from `created_at`
for rows that have no better answer, and supplied by the surface where the
person knows it.

Interval membership uses `coalesce(occurred_at, created_at)`. A backdated cash
expense whose instant lands inside an already-observed interval raises the same
reconciliation exception as a late bill, by the same code path.

**Rejected: use `created_at` alone.** A cash expense entered the next morning for
yesterday evening would land in the wrong interval with no way to say otherwise.

**Rejected: a required instant.** It would break every existing row and demand
precision nobody has for a ₹40 auto fare.

### 14. The ledger day is derived on read and is never stored

No table replaces `manual_ledger_days`. The day is computed from bills,
expenses, `aggregator_channel_days`, cash out and observations.

Two properties follow, and both are worth more than the read cost: the row can
never disagree with itself, and a day nobody touched still renders in full.

The drawer block is **ordered by instant, not grouped by category**, which is
what makes the collection legible: an expense at 18:10 sits above the 22:00
count and one at 23:00 sits below it.

The word **"Kept" is retired.** It conflated two different facts that this model
must keep apart: `You left`, the float the collector walked away from, and
`Closing`, the balance at the next cutover after trade continued. On the worked
example those are ₹1,450 and ₹3,504. The surface states plainly that the float
left is not the next day's opening.

### 15. Verification is an acknowledgement, not a freeze

`ledger_day_verifications` records outlet, business date, account, instant and
an optional note. It freezes nothing and gates nothing, because aggregator
settlement legitimately restates a day's figures days later and a verification
that forbade it would be a verification nobody could use.

A day whose inputs change after verification is marked **changed since you
verified it**, naming what moved. Each day joins a verification by its own tap:
no select-all, following the attendance precedent that the saving is in the
acting and never in the selecting.

### 16. Deliberately additive: this change drops and renames nothing

The migration in this change contains `create table` and `add column ... null`
and nothing else. No `drop`, no `rename`, no data movement.

That is the entire revert story, and it is worth more than any flag:

- `manual_ledger_days` and `manual_ledger_expenses` keep every row and keep
  their write path.
- `daily_cash_records`, `close_business_day()` and `public.expenses` are left in
  place, dead.
- The new tables are read by nothing that existed this morning.

So a revert is a one-line gate edit and a deploy, with no data to recover. The
one cost, which should be stated to the owner rather than discovered: **counts
recorded in the new surface during the overlap are stranded** if the new surface
is abandoned, because the old ledger cannot see them. Two days of counts is
twenty minutes of retyping, and the exposure shrinks the longer the new surface
is trusted.

### 17. The fallback is a tab, not a runtime toggle

`docs/DEMO_MODE.md` states that the gate registry is a build-time constant and
promotion is never a runtime toggle. That rule is about promotion, and this is an
operator fallback, but there is no need to test the boundary: during the overlap
both the derived Ledger and the manual Ledger are `live` in the registry, which
is honest because both genuinely work, and the manual one simply leaves the
primary navigation.

This is also better than a switch. A switch shows one surface at a time; two
entries let the owner open both and compare a day, which is the two-day
acceptance test they asked for with no engineering behind it.

**"Leaves the primary navigation" means it stops being the entry labelled
`Ledger`. It does not mean it loses its entry.** Recorded 2026-08-27 because the
looser wording was read the other way during apply, and task 9.2 said so
outright: the manual form was left resolving at its route with nothing pointing
at it. A fallback you have to remember a URL to reach is not a tab, and is not a
fallback anybody uses at 22:00 when the new surface is behaving oddly. It sits
after the derived statement, under its own name — **Notebook** — so the reader
lands on the new reading and the old one is one tap away. The Risks section
already priced this: two ledger entries on a crowded shell, temporary until #12.

### 18. An outlet's first observation is an anchor, and an anchor has no arithmetic

Settled with the owner 2026-08-27, closing open question 1 before the table was
created.

**The first observation at an outlet is a pure anchor. It carries no opening, no
expected total and no difference — not a fabricated opening, and not a zero.**
The drawer begins at what was counted, and from the second observation onward
every rule above applies unchanged.

The reasoning, because the alternatives are each wrong in a different way:

- **Zero with the first difference absorbing the float** is the candidate that
  looks cheapest and does the most damage. Kalyani has been trading since
  2026-08-01 and its drawer is not empty, so the first count would record a
  variance of roughly the entire float — around ₹8,950 — as an *excess*. That is
  not a display problem. Decision 3's entire safety property is that a recorded
  variance means something happened; a first-day variance of the whole float,
  permanent on the record, teaches every later reader to skip the column. A
  number nobody believes is worse than no number.
- **An owner-supplied books-opening figure carried from the notebook** is
  **forbidden by this change's own spec delta**, not merely undesirable.
  `manual-ledger`'s modified requirement carries the scenario *"WHEN the cash
  drawer or the derived ledger statement is rendered THEN neither queries a
  manual-ledger table."* Seeding the live drawer from `manual_ledger_days`
  would be the live surface reading the notebook, on day one, in the one place
  the arithmetic depends on it. #12 carries that history across; this change
  does not reach for it early.
- **A once-per-outlet figure typed by the owner from nothing** is honest but
  answers a question with a question. The owner does not know what the drawer
  held before the first count either, and the figure they would type is the
  count they are about to take.

**The shape: an explicit `is_anchor` flag, not bare nullable columns.** Both
express it, and the flag reads better in the constraint for two concrete
reasons rather than as a matter of taste:

- The arithmetic constraint survives **verbatim** behind one guard word, so the
  sentence the spec states and the sentence the database enforces stay the same
  sentence:

  ```sql
  constraint drawer_observations_difference_arithmetic check (
    is_anchor or difference_paise = counted_total_paise - expected_paise
  )
  ```

- **One anchor per outlet becomes a partial unique index** — `on
  (outlet_id) where is_anchor` — which has nowhere to hang without the flag.
  Written against nullness instead (`where expected_paise is null`) the same
  index restates the anchor definition in a second place, and two places is
  where a definition drifts.

Bare nulls would also make "is this the anchor?" an inference every reader
re-derives, and a SQL null carries two meanings — *not applicable* and *not yet
known*. Here it is permanently the first. The flag says so once.

**`opening_paise` is null on the anchor too**, which extends the owner's
instruction from two columns to three, deliberately. An anchor has no interval,
so it has no opening: decision 4 defines the stored opening as *the previous
observation's counted total less its own cash out*, and there is no previous
observation to read. Storing `0` there would be exactly the fabricated figure
this decision rejects one paragraph above, with the added defect that nothing
would ever check it. All three derived columns are null together, and a
constraint ties them to the flag in both directions so a half-anchor cannot
exist.

**The derived ledger needs a third word, and this is where it comes from.**
Business dates before an outlet's anchor have real bills and real expenses but
no drawer belief at all, and Kalyani will have fifteen such dates on day one
(2026-08-12 to 08-26). Those days render in full — revenue, expenses,
everything — with the drawer marked **`not tracked yet`**, naming the anchor
that begins the record. That is a different claim from `carried`, which means
*the app's belief, unchecked*, and the two must not share a word: before the
anchor there is no belief to leave unchecked. Decision 14's retirement of
"Kept" was the same mistake caught one surface earlier.

### 19. Every count time is approximate, and there is no control asserting certainty

Settled with the owner 2026-08-28, on the second reading of the count sheet.
**It reverses half of decision 6**, and the reversal is the owner's, in their
own words: *"it's always approximate, we do not need the I'm sure button ever.
Even now can be approx right, cuz there could be minor time mismatches (while
he was counting an order came in)."*

Decision 6 reasoned that a count taken *now* has nothing to be approximate
about, so it marked only a recalled time approximate and offered **I'm sure** to
take that back. Both halves were wrong about the same physical act. Counting a
drawer is not instantaneous: it takes a minute or two with a queue in front of
it, the counter keeps trading while it happens, and a bill rung during the count
lands on one side of a boundary nobody was watching. The instant a person
supplies is the *middle* of an act, never its edge — whichever button they
pressed.

So:

- **`certain` is `false` on every observation the surface records**, for all four
  time options including *Now*. Every count carries the ±15 minute window, and
  the surface always states what the timing alone could account for.
- **The I'm sure control is removed.** Nothing on the surface asserts an exact
  instant, so nothing has to be un-asserted.
- **The `~ approx` chip is removed from the sheet and from the recent-count
  rows.** A marker every row carries distinguishes nothing; it was information
  only while some counts were exact. The window is stated once, beside the time,
  where it is read.

**One window, not a graduated one.** The tempting refinement is a tighter
tolerance for *Now* than for a time picked out of the air. It is rejected: the
uncertainty this window models is the duration of the count and the trade during
it, which does not shrink because the recorder pressed the button sooner. A
window that varied by button would also make two counts of the same drawer
incomparable for a reason that has nothing to do with the drawer.

**`p_certain` survives in the database, unused by this surface.** The parameter,
its default of `false`, and `v_approximate`'s dependence on it are left exactly
as the migration shipped them. Editing an applied migration to delete a
parameter nobody passes buys nothing and costs the one property decision 16 was
written for: this change drops and renames nothing. The constraint
`drawer_observations_approximate_needs_a_gap` continues to hold, because a
counted instant captured when the sheet opens is always strictly earlier than
the server instant that records it.

### 20. Where the recorder stood is detected, and the reason field appears only when it has to

The spec has said since it was written that a record made outside the fence
*"SHALL require a reason first"*. The surface never implemented it. It read no
position, showed an always-optional **Not at the outlet? Say why** box, and sent
`position: null` on every write.

**That is not a cosmetic gap, it is a live defect.** `drawer_position_guard()`
recomputes `recorded_on_site` from the coordinates on the row, and no
coordinates reads as *not on site* — deliberately, because a missing fix and a
fix from home are the same claim as far as the record is concerned. So every
observation the surface writes is off-site, and
`drawer_observations_away_needs_a_reason` then requires the reason the box said
was optional. **A count saved with that box empty is refused by Postgres**, with
a constraint message, at 22:00, by somebody holding cash. The standalone
collection and spend sheets avoid the refusal in a worse way: they send the
literal string `'recorded from the app'`, which satisfies the constraint by
writing a sentence that is true of every row and evidence about none.

The fix is the one attendance already ships:

- The sheet reads one position when it **opens**, through `readPosition()` in
  `src/lib/geolocation.ts` — the only module that touches
  `navigator.geolocation`, and still the only one after this change. It is read
  in direct response to a person opening a sheet to record something, which is
  the same class of event as pressing **Check in**. There is no watch and
  nothing samples in the background.
- The read **never blocks the form**. Every field is usable while it resolves,
  and the save button is not gated on it. A collector standing at the counter
  with the drawer in their hands does not wait for GPS.
- Three outcomes, and only one of them asks a question:
  - **inside the fence** — a quiet *at the outlet* chip, no reason field at all;
  - **outside the fence** — the distance said plainly, and the reason field,
    **required**;
  - **no fix at all** (denied, unavailable, timed out, unsupported, or an outlet
    with no captured position) — the reason field, **required**, because nothing
    on the row can show the person was there.
- The position travels with the write, so `recorded_distance_m` and
  `recorded_on_site` are the database's own verdict on coordinates it was given,
  not a claim the client made.

**Nothing is refused for being elsewhere**, which is decision 11 unchanged. What
changes is that the reason is now asked exactly when it is evidence, and never
when it is noise — and that the hardcoded `'recorded from the app'` string is
deleted rather than made conditional.

**An unsurveyed outlet reads as away, and says so specifically.** Kalyani and
Kanchrapara both carry positions today, but an outlet onboarded without one
would otherwise present its collector with a permanent unexplained demand for a
reason. The copy names the cause: the outlet's position has not been captured,
so nothing can be measured.

### 21. A recent count is a disclosure, and the history is paged

Two problems in one list. It rendered every chip a count could carry on one
row — the verdict, the collection, the approximate marker, the away marker, the
opening break, the recorder, the reason, every adjustment — which on a phone is
five lines per count and a wall by the fourth. And it read whatever `getState()`
returned, which the Supabase adapter capped at `limit(12)` with no way to reach
the thirteenth. Two outlets counted daily produce that cap in a fortnight.

- **A row is a disclosure**, built the way `sync-event-row.tsx` already builds
  one: a full-width header button carrying `aria-expanded`, a chevron that
  rotates, and a body that is unmounted while closed. That component is the
  house pattern for exactly this, and reproducing its behaviour with different
  markup would be a second pattern to keep in step.
- **Closed, a row carries what the reader is scanning for, on one line**: the
  instant, the verdict beside it — `matched`, `₹200 short`, `₹40 over`, or
  `first count` — then the amount and the chevron held at the right edge, plus
  the opening-break warning, which is the one condition that wants a second
  look. **The verdict is shown even when it is `matched`**, settled with the
  owner 2026-08-28: a clean night reading blank is indistinguishable from a row
  that has not finished loading.

  The verdict began on a second line under the date, which spent a line per
  count on a chip that fits beside it — four counts were eight lines. It now
  **wraps rather than truncates**, and the direction of the give is deliberate:
  the amount and the chevron never shrink, so the rare row that cannot fit — a
  long date carrying both a shortfall and a broken opening — pushes its chips
  onto a second line instead of clipping money, which is `ChipRow`'s own rule
  and the one thing on the row that must never be cut off.
- **Open, it carries the rest**, and that is where the **Adjust** control now
  lives, as an ordinary `Button` — `size="phone"`, `variant="secondary"` — which
  is what every other disclosure in this app puts in its body. The underlined
  eleven-pixel text it replaces was not recognisable as a control at all.
- **The history is paged**, through a new `listObservations(outletId, {before,
  limit})` on the adapter, cursored on `counted_at` rather than on an offset so
  a count recorded while somebody scrolls cannot duplicate or skip a row.
  `getState()` keeps returning the first page, so the surface still renders from
  one read. More arrives when a sentinel below the list comes into view, and **a
  button does the same job for anybody the observer does not serve** — a
  keyboard walking the list, or a browser without `IntersectionObserver`. The
  end of the list says it is the end rather than going quiet.

**Not a virtual list.** The rows are a few dozen at a time and each is two lines
closed; windowing them would add a scroll container, a measurement pass and a
focus-restoration problem to a list that fits in the page's own scroll.

### 22. The primary action is named for both halves of the act it performs

The button said **Count the drawer** and the sheet it opened asked for the
collection too. The proposal's own sentence for this surface is *"the count and
the collection are one physical act"* — the button was the one place that still
described half of it. It reads **Count & Collect**, and the sheet takes the same
name.

The two secondary controls are then named by what makes them different from it,
not by what they do: **Only Collect** (take money without counting) and **Other
Spend** (drawer cash that bought something). Read as a set, the three now say
which one a person wants.

**Other Spend stops being a ghost.** Decision 5 put the escape hatch *"well away
from the primary action"*, and it stays where it was put — in the quieter second
row, after Only Collect. But it was rendered `variant="ghost"`, which on this
card is text with no boundary, and the owner could not tell it was a control.
Distance from the primary action is the separation that decision asked for;
invisibility is not. Both secondary controls are now `variant="secondary"`, and
the sheet behind Other Spend still says on its own face that it will not enter
the month's operating expenses.

### 23. The balance card puts the figure where a figure goes, and signs the three below it

Small, and all four parts are the same complaint: the card made the reader work
out what it was telling them.

- **The balance sits at the right end of its own label's line**, where every
  other money figure in this app sits, instead of below the label at the left
  margin. Nothing else on the surface is left-aligned money. The label is set
  heavier and a shade larger than the section headings under it — 15px at 800,
  measured on the device rather than picked off the type scale — because it is
  the card's headline and the only label sharing a line with a display figure:
  at the section-heading weight the two read as a number with a caption above
  it rather than as one statement.
- **The chips move up, directly beneath that line** — when it was counted, how
  many days are uncounted, how many tablets are behind. They qualify the figure,
  so they belong against it rather than below a divider that separates it from
  its own conditions.
- **The three figures are named for what they are**: **Last Left** (what the last
  count left behind), **Cash from Bills**, **Cash Expenses**. `Left`, `Bills`
  and `Expenses` each named a different kind of thing — a balance, a document, a
  category — and left the reader to infer that the middle one meant cash and the
  last one meant since the count.
- **The signs are shown, not implied.** Cash from Bills carries a leading `+`,
  Cash Expenses is negative **and** `--danger`. The direction of a term in a
  running balance is the whole content of that term, and it was carried only by
  a green tint that a colour-blind reader of this card cannot use. The `+` and
  the `−` are words in this context, not decoration.

### 24. Expenses are read where they are written, not where they ought to live

Found in production by the owner on 2026-08-28, hours after this change
deployed: the Ledger's Expenses card read **Nothing recorded** on a day with
real expenses.

**The premise was wrong, not the code.** Everything above assumed
`public.expenses` is where a live expense lands. It is not, and never has been:
expenses went live in #36 and #38 against `manual_ledger_expenses`, which is
what the Expenses tab writes today, for every role, at both outlets. Measured
against production the same evening: `public.expenses` **0 rows**;
`manual_ledger_expenses` **118 rows, 65 of them cash**, spanning 2026-08-01 to
2026-08-28. The proposal's own Impact section recorded the 0 and read it as
*"nothing to migrate"* rather than as *"nothing writes this"*.

The comment that shipped beside the defect is the tell:
*"`public.expenses` only. The notebook is never read by a live surface."* That
sentence is a good rule about **`manual_ledger_days`** — decision 18 refuses to
seed the drawer's opening from the notebook's day-close figures, and that
refusal stands unchanged. It was applied to the wrong table. A notebook *day
row* is a superseded belief about a closing balance; a notebook *expense row* is
the live record of money that left the drawer, written by the app, twenty
minutes ago.

**The visible half was the smaller half.** The Expenses card read nought, which
is wrong and obvious. `drawer_cash_expenses_paise()` also read nought, which is
wrong and invisible: the drawer's expected balance was overstated by every cash
expense since the last count — ₹290 at Kalyani on the day it was found — so the
**next count would have read short by exactly that.** A manufactured shortfall in
a cash-reconciliation app is the specific fiction this whole change exists to
remove, and it would have been read as a missing note. Both outlets held only
their anchor, which carries no difference, so no figure was actually produced
wrong; the first real count would have been.

**The fix names the live expense record wherever it currently lives.**
`public.effective_expenses` unions `public.expenses` with the un-voided rows of
`manual_ledger_expenses`, normalising the two payment-method shapes to one
`is_cash` boolean. Both callers point at that name for good: when #12 carries the
rows across, the view collapses to its first branch and not one caller changes.
`effective_bill_payments` is the same pattern, in the same schema, for the same
reason.

`security_invoker = true` is load-bearing rather than decoration. Without it the
view runs as its owner, RLS on the base tables is bypassed, and any authenticated
session reads every outlet's expenses through it — the precise tenancy failure
the base policies exist to prevent.

**Rejected: teach the Expenses surface to write `public.expenses`.** The correct
end state and #12's actual job. Done here it is a new write path, a category
mapping, a row migration and a void semantics decision, shipped at speed against
a live counter to fix a read. The view is smaller, reversible, and does not
prejudge how #12 carries the rows.

**Rejected: read `manual_ledger_expenses` directly in both callers.** Two call
sites to change again at #12 instead of one view to delete, and it spreads the
stopgap's name into the surfaces that are meant to outlive it.

### 25. The demo hid it, so the mock now reads the union too

Worth its own entry, because the failure is about this repo's central seam rather
than about expenses.

**The mock store holds the same two arrays and the seed fills both.** So every
mock reader could take `store.expenses` alone and the demo still showed a
populated Ledger: self-consistent by construction, and therefore silent about a
system that is not. The walkthrough, the component tests and the four-role demo
all passed while production read an empty table.

That is the seam failing at the one thing it is for. `AGENTS.md` says a fixture
the database could not serve must fail to compile; the shape here is worse,
because the fixture was one the database *could* serve and the two halves simply
answered different questions. So `src/data-access/mock/effective-expenses.ts`
mirrors the view — both sources, un-voided only, one normalised shape — and both
mock readers go through it.

The regression test that pins it does not assert against the store. It **records
an expense through the door a person uses** — `manualLedger.createExpense`, which
is what the Expenses tab calls — and then asks the Ledger and the drawer whether
they can see it. Three of its four cases fail against the mocks as they shipped.
An assertion written against the right array would have passed while the app
stayed broken, which is how this defect survived the first time.

### 26. The drawer's three interval readers ask who is calling

Found while fixing decision 24, in the function being edited, and fixed in the
same migration because it is a live violation of this repo's first hard rule.

`drawer_cash_receipts_paise()`, `drawer_cash_expenses_paise()` and
`drawer_cash_out_paise()` are `security definer` — correctly, since they are the
database's half of the drawer arithmetic and must see rows the caller's policies
would filter. All three are granted to `authenticated`. **All three took
`p_outlet_id` from the caller and checked nothing.**

Every drawer *table* carries `app_may_reach_drawer()` in its policy. These three
functions are the one path around those policies, and they were the one place the
predicate was not applied. Measured on a local stack on 2026-08-28: a Biller,
for whom `app_may_reach_drawer('Kalyani')` returns **false**, read
`drawer_cash_receipts_paise('Kalyani') = 100500` — ₹1,005 of an outlet's cash
receipts, through a valid session, with one HTTP request.

`AGENTS.md` states the rule they break in the first person: *"A Franchise Admin,
Biller, or Employee MUST NOT be able to read or write another outlet's rows —
including via a hand-crafted API request with a valid session."*

The guard is the same predicate the policies use, so the two cannot drift.
Nothing legitimate changes: `record_drawer_observation()` checks it before
calling all three, so a caller who may record a count may read the terms that
count is measured against. A caller without reach gets **nought rather than an
exception**, which is what a reader with no reach should learn — the same answer
an RLS-filtered select would give them.

### 27. The count is a tally, and neither editable field carries a placeholder

The sheet asked two questions in two labelled boxes and computed a third figure
into a chip underneath. The owner read it back on 2026-08-29 and the complaint
was structural: the arithmetic already has a shape, and the form was not it.

So the four figures sit in one column, as a tally:

```
Cash expected                        ₹2,733
Cash counted                    [          ]
Cash collected                  [          ]
Cash left                              ₹833
```

- **`Cash expected` is stated, and it was not before.** The sheet computed it
  and then only ever mentioned it inside the difference chip, which is the one
  place it appears *after* the reader has already typed. Showing it first is what
  makes the other three read as arithmetic rather than as three separate
  questions, and it is the figure the collector is checking against.
- **`Cash left` replaces the *leaving* chip.** Same number, but it is the line
  the tally produces rather than an aside about one of the fields.
- **Neither editable row carries a placeholder.** A greyed `8950` in an empty
  money field is read as a value at a glance, which is the one misreading this
  surface cannot afford; and the collection field's pre-filled `0` was a figure
  somebody had to clear before they could type. **Leaving the collection empty
  already means nothing was collected**, so nothing is lost by saying it with
  emptiness instead of a nought.
- Labels are `text-base` and the fields are `w-44`, because the first cut set
  both small and left a corridor of dead space down the middle of the sheet.
  Stated figures carry `pr-3` so they land on the same right edge as a typed one
  sitting inside its field's padding; without it the column is a few pixels out
  and stops reading as a column.

The difference — `₹400 short`, `matches ₹2,733` — stays exactly where it was, on
the keystroke, immediately under the counted row. It is the one thing on this
sheet that may never move behind anything. **It sits against the right edge**,
under the field it is about: at the left margin it read as a new paragraph
interrupting the tally, and the eye lost the column of figures it was
following.

### 28. A stated instant is picked, never typed

The fourth time option was a full-width `datetime-local` field under the three
relative buttons, editable by keyboard. Two things wrong with it: it took a row
of its own while the button row had space to spare, and **a half-typed date is
still a date.** This field decides which cash a count is measured against, so a
caret in it is a way to be silently wrong.

Now it is a fourth button, **Other**, beside `Now`, `15 min` and `30 min`. It
opens the platform's own picker through `showPicker()`. The input survives —
that is what carries the value and what `showPicker()` acts on — but it is
`aria-hidden`, `tabIndex={-1}` and `pointer-events-none`, so it is never
somewhere a person puts a caret. Keyboard users reach the picker through the
button, which is labelled *Pick another date and time*, and the picker itself is
keyboard-navigable. Where `showPicker()` is missing, focusing and clicking the
field is what older browsers open it on.

The four labels are short — `Now`, `15 min`, `30 min`, `Other` — because four
options must share one row on a 375px phone, and `15 min ago` cannot. **The
instant they produce is spelled out in full directly beneath**, so the button
carries the gesture and the line below carries the meaning. The spoken label
keeps the whole phrase for a reader who does not get the line.

**That line is text, not chips.** It reads `Today, 12:39 am · give or take 15
min` at `text-sm`, as the value of *Collection time*. A chip states a fact
*about* a thing; this **is** the thing, and at chip size the one number the
reader was choosing was the smallest text in the sheet. The `~ ±15 min`
shorthand becomes words for the same reason.

### 29. Nought is not a direction

Amends decision 23, which said the signs are shown rather than implied and left
it there. The rule needed one more clause, from the owner: **a figure of nought
carries neither a sign nor a colour.** `+₹0` in green says a direction about a
term that has none.

So one function decides both, for every term in the running balance:

```
0   → no prefix, no tone
> 0 → "+", success
< 0 → the minus formatPaise already renders, danger
```

**Cash Expenses goes through the same function, negated.** That is the whole of
the difference between the two figures, and it buys a case nobody wrote a rule
for: a *negative* expense is a refund, so it comes out green with a plus,
correctly, without a branch of its own. Two functions that agreed today would be
two functions to keep agreeing.

### 30. The newest count can finally be fixed

Decision 8 settled the boundary — an observation is editable until the next one
anchors on it, and only adjustable afterwards — and `edit_drawer_observation`
has enforced it in the database since the migration shipped. **No control ever
called it.** The one count most likely to need a quick correction, the one taken
two minutes ago, was the only count with no correction control at all.

The practical cost, which is why this is worth more than its size: a typo caught
immediately could not be fixed at all. The recorder had to wait until they took
another count, at which point the row locked and the only remaining path was an
adjustment — which demands a reason and leaves *"was ₹9,850, now ₹8,950"*
permanently on the record. A two-minute slip ended up wearing the costume of a
correction somebody had to justify, which is precisely the signal that treatment
exists to reserve for figures other figures were built on.

So the disclosure body now offers **Fix this count** on the newest observation
and **Adjust this count** on every other, never both. The fix takes an amount
and nothing else: no reason, no trail, no adjustment row. The sheet says *no
reason needed* on its face, with the reason for that behind a `Why`, because a
correction that asks for nothing is surprising enough to explain once.

The database remains the boundary rather than the screen: `edit_drawer_observation`
refuses the moment a later count reads this one as its opening, and the surface
stops offering it at the same instant, from the same fact.

### 31. The chip is the explanation's button, and the explanation is a modal

The owner's words on 2026-08-29: *"The info icons beside each chip and how they
expand to reveal more info is bad UI."* Both halves of that are right, and they
are separate faults.

**The icon.** Every explainable chip trailed its own ⓘ. On the balance card that
is three little glyphs in a row of five chips, and a row of icons reads as
clutter rather than as an offer. The chip and its explanation were also two
controls for one idea, so a reader who wanted to know what *2 days uncounted*
meant had to notice and hit a 20px target beside it.

**The expansion.** It opened a paragraph **in place**, which pushed everything
below it down the screen. On a card whose whole purpose is four figures, asking
a question moved the figures. That is the opposite of what a disclosure is for.

So: **the chip is the button**, and the explanation opens as a small modal over
the surface. Nothing reflows, and the top layer means no ancestor's `overflow`
can clip it — which matters, because these live inside a sheet that scrolls.
Escape, focus containment and backdrop dismissal come from `<dialog>` rather
than from code.

**The affordance is a dotted underline** plus `cursor-help`, the convention an
abbreviation has carried for thirty years. A chip that explains itself has to
look different from one that does not, or the offer is a secret — and the icon,
whatever else was wrong with it, was at least visible.

**The accessible name is the fact first, the offer second**: `2 days uncounted,
explain: what counting after several days means`. An `aria-label` would have
replaced the fact with the offer, which is the wrong way round — the chip's
content is what the reader came for. The separator is a comma rather than a
space because the accessible-name algorithm trims each node before joining them,
so a leading space is dropped and the two run together.

**Three things this shape cost, all found by building it rather than by
reasoning about it:**

- **The modal is portalled to the body.** Several triggers sit inside a `<p>`,
  which may not contain a `<dialog>`. Rendered in place the first version
  produced invalid nesting. The dialog is in the top layer once open either way,
  so where it lives in the DOM costs nothing.
- **`Modal` now stops the `close` event.** A `close` event does not bubble in
  the DOM, but React's synthetic system propagates it up the **React** tree — and
  a portalled modal's React parent is a component inside another modal. So
  dismissing an explanation opened over the count sheet closed the count sheet
  with it, **losing everything typed into it**. A dialog closing is its own
  business; no ancestor needs telling. This is a defect the pattern created and
  the pattern's own test caught.
- **It was not centred.** The first version pinned `inset-x-4` and translated on
  `top`, which centres nothing: with both `left` and `right` set, a box narrower
  than the gap between them stays at `left`. On a phone it sat hard against the
  left edge, which is where the owner found it. `inset-0` with `m-auto` is the
  one centring a dialog gets right in both directions without arithmetic, and
  `h-fit` keeps the box the height of its own words rather than the height of the
  viewport. Measured at 375 and 1280 wide: equal gaps on all four sides, once the
  scrollbar is taken out of the reckoning — `window.innerWidth` counts it and the
  layout viewport does not, which is worth knowing before concluding a box is off
  by fifteen pixels.

Where a trigger cannot wrap its subject, it becomes a short question of its own:
`why no difference?` in a count's disclosure body, whose chip lives in the row
header that is already a button, and `what does this do?` beside Verify. A
button inside a button is invalid, and inventing a way around it would be worse
than asking the question in words.

### 32. Uncounted days exclude the day that was counted, and one day is not worth saying

The owner, on a drawer counted at 23:16 the previous night, reading it at nine
the next morning: *"Why does it alert 2 days uncounted? I just counted
yesterday, and today has barely started."*

`daysCovered` is the **inclusive span** of the pending interval, which always
includes the business date the last count belongs to. That date was counted. So
the chip was reporting the counted day as uncounted, and would do so every
single morning at every outlet.

Two corrections, and the second matters more than the first:

- **The figure is `daysCovered - 1`**: business dates that have passed *since*
  the one the last count belongs to.
- **The chip appears from two upward.** At one there is nothing worth saying:
  the only uncounted day is today, it has barely started, and nobody counts a
  drawer at nine in the morning. A warning that fires every day is a warning
  nobody reads, and this one has real work to do at two — where a whole business
  date has passed with no count at all, and the next difference genuinely stops
  being attributable to one night.

`daysCovered` itself is left alone. It is a factual quantity the ledger's
`observationCoversDays` also uses, where the inclusive span is the right answer:
a recorded count really did cover that many days of trading. Only the drawer's
warning changes, because only the warning was making a claim about days nobody
counted.

**Correcting it silently emptied the demo, and that had to be paid for.** The
walkthrough's drawer opens on Kalyani, whose only explainable chip *was* this
one — wrongly labelled, but present, and the thing a reader would tap to see
what an explanation looks like. Getting the arithmetic right took it away, so
the demo's first screen had nothing to try. Task 9.5 had asked the walkthrough
to reach these states; a correction that quietly un-reaches one is half a
change.

Kalyani's demo tablet now reports **one unsent bill**, which restores an
explainable chip to the first screen and is the state production was actually in
when this was reported. The degrees still differ from Kanchrapara's three, which
is the contrast the tablet management surface exists for.

**Rejected: shifting the demo's whole count plan back a day.** It was tried, and
it worked — the newest count landing two days back put the uncounted-days chip
straight back on the first screen, which is the more on-point demonstration.
It also broke the owner console, the insights fixtures and two browser specs,
because the demo's calendar is load-bearing in more places than a chip is worth.
Thrown away rather than propped up.

### 33. The rupee sits inside the field

A tally of four money figures where two are typed and two are stated: the stated
ones carry `₹` and the typed ones carried nothing, so the column read as two
kinds of thing.

The mark is **inside the box, pinned left**, with the number still right-aligned
and the field padded so the two never collide. Outside the box it would sit
between the label and the field and read as part of the label. Hugging the
number would need the caret's own text metrics and would drift as digits are
typed.

Left mark, right number is what a bank's amount field does, and it is what keeps
this column a column: the typed figures land on the same right edge as the
stated ones above and below them. The mark is `aria-hidden` — the field already
says *in rupees* in its accessible name, so a reader who cannot see it loses
nothing.

### 34. Tablet state is a freshness-qualified unresolved snapshot

Production supplied the counterexample on 2026-08-29. Kalyani's tablet wrote
`last_reported_unsent = 1` at 23:19:33, 336 ms after the server accepted its
last `pay_order`. No later command reached the server. At 10:00 the next morning
the shift had expired, the row still said one, and the Cash drawer still said
**1 tablet behind** as if it were current. The database was not wrong: it held
exactly the last statement the tablet made. The screen and the reporting
protocol were wrong about what that statement could support.

Three implementation facts produced it:

1. `BillingUnsentReporter` is a Dexie `liveQuery`, so it reports when the local
   envelope set changes. It has no periodic heartbeat despite writing a column
   called `last_seen_at`.
2. A server acceptance and the local transaction that records that acceptance
   are separate events. Closing or losing the page between them leaves an
   envelope locally even though the server has committed it; idempotent replay
   is the recovery mechanism, but no recovery happens while the counter is
   closed.
3. The drawer reads `counter_devices` once, tests only whether the last count is
   positive, and uses `last_seen_at` as "since". That timestamp means **last
   heard from**, not **oldest work still held**.

#### One conservative concept: unresolved

The local envelope count already includes `pending`, `held`, `retrying` and
`needs_attention`, and that is the correct financial boundary. Rename the
concept in TypeScript and user-visible text from *unsent* to **unresolved**, but
do not filter `needs_attention` out. A refused `pay_now` may have been followed
by a customer handing over cash before the refusal appeared. The server knows
the command did not settle; it does not know what happened across the counter.
Billing diagnostics name the refusal and offer correction or attributed
discard. The drawer only needs the conservative fact that its expectation may
be missing physical cash.

This requires separating the store methods whose names currently blur two
jobs. The finish-day guard continues to count every unresolved envelope, and
the telemetry reporter reads a summary of that same set:

```ts
type UnresolvedSummary = {
  count: number
  oldestCreatedAt: string | null
}
```

`oldestCreatedAt` is the minimum `createdAtMs` across retained envelopes and is
null exactly when `count` is zero. It contains no payload, customer phone or
line item.

#### A heartbeat with four triggers

While the billing runtime is mounted, the reporter reads the current summary
and serialises/coalesces reports through the existing single in-flight queue:

- immediately on `start()`;
- whenever Dexie's unresolved envelope set changes;
- every 60 seconds while the counter runtime is open; and
- immediately on `visibilitychange` when the document becomes visible.

The interval is liveness telemetry, not a poll for business data. The counter
is the mains-powered, fixed-screen exception already recorded in
`docs/ARCHITECTURE.md`; one tiny authenticated RPC per minute is bounded and
buys an operational fact the cash surface acts on. A failed RPC stays swallowed
and is retried by the next trigger. `stop()` removes the Dexie subscription,
interval and visibility listener, then waits for the in-flight report exactly
as it does today. The timer, clock and visibility target are injectable so the
unit test uses fake time rather than sleeping.

The reporter reads IndexedDB on every trigger. It must not periodically resend a
cached `1`, which would keep the precise failure this decision exists to fix.
Concurrent triggers may coalesce, but reports from one reporter remain ordered
so an older `1` cannot complete after its newer `0`.

#### Add one fact; preserve the deployed call

`counter_devices` gains one nullable column:

```sql
last_reported_oldest_unresolved_at timestamptz
```

Do this in a new forward migration. The production-applied
`20260810000001_counter_tablet_and_shift.sql` is immutable. Do not rename
`last_reported_unsent`: its deployed name remains as compatibility storage,
while adapters expose it as `lastReportedUnresolved`.

Add a two-argument overload of `report_counter_device_state` taking the count
and oldest instant. Keep the deployed one-argument signature for an old browser
served during the migration-before-publication window. The legacy function
updates `last_seen_at` and the count and leaves the oldest instant unknown for a
positive value; reporting zero clears it. The new overload writes all three
facts atomically, deriving the device from `auth.uid()` and retaining the same
removed-device refusal and grants. Regenerate `database.types.ts` after reset
and test both signatures over real HTTP. Do not let a service-role key or an
envelope payload enter this path.

An unknown oldest instant is rendered as unknown, never inferred from
`last_seen_at`. Client clocks can be imperfect, so the oldest instant is
evidence from the local envelope rather than a server boundary used to accept
or reject money.

#### Fresh, unresolved and out of touch are different states

Move the existing thirty-minute threshold out of `devices-surface.tsx` into one
shared domain helper. Both Tablets and Cash drawer must answer freshness the
same way.

For every non-removed tablet at the outlet:

| Last report | Last unresolved | Drawer state |
|---|---:|---|
| no more than 30 min ago | 0 | clear |
| no more than 30 min ago | positive | unresolved; expected is provisional |
| older than 30 min or absent | any value, including 0 | out of touch; expected is provisional |

The third row is load-bearing. An old zero is only evidence that the queue was
empty then. The tablet may have accepted cash locally one second later and lost
the connection before reporting it.

The compact balance chip distinguishes `1 tablet unresolved` from
`1 tablet out of touch`. Its explanation always states the report instant,
states the last unresolved count, states the real oldest-unresolved instant when
known, and says why the expected figure may be understated. It never says the
report instant is when the backlog began. The existing instruction survives:
**count anyway — you are the one holding the cash.**

The drawer reads telemetry on mount, when Count & Collect opens, and on
foreground. It does not subscribe or run a phone-side polling timer. Each read
is one RLS-scoped snapshot; the stated report time keeps it honest. A failed
refresh preserves the last snapshot and its qualification. An outlet switch
clears the previous outlet's telemetry before the new drawer can render, and an
obsolete promise cannot restore it.

**Rejected: clear a positive report when its shift expires.** Work survives
cutover and drains later by design. Expiry changes who may create new work, not
whether accepted local work exists.

**Rejected: hide `needs_attention`.** That converts a known unresolved physical
cash risk into a clean drawer merely because the server supplied a deterministic
refusal.

**Rejected: treat a stale zero as clear.** That is the exact false assurance a
heartbeat timestamp exists to prevent.

**Rejected: a Re-read button as the only repair.** The collector should not have
to know that telemetry can become stuck. Foreground and sheet-open reads handle
the phone; periodic and foreground reports handle the tablet.

## The surfaces

Layout conventions in these sketches: `[ 8950 ]` is typed, `( chip )` is tapped,
a bare `₹8,950` is computed and static, and `✓`/`⚠` are computed markers.

### Cash drawer

```
┌──────────────────────────────────────────────┐
│  CASH DRAWER · Kalyani            [switch]   │
│                                              │
│  IN THE DRAWER NOW                 ₹8,950    │
│  ( yesterday 22:20 )  ( ⚠ 2 days uncounted ) │
│  ────────────────────────────────────────    │
│   LAST LEFT    CASH FROM BILLS  CASH EXPENSES│
│    ₹1,450         + ₹8,400          − ₹900   │
│                    51 bills         1 entry  │
│                                              │
│         [    Count & Collect     ]           │
│    [  Only Collect  ]  [  Other Spend  ]     │
│                                              │
│  RECENT COUNTS                               │
│  Sun 23:02  ( ✓ matched )     ₹7,120     ⌄   │
│  Fri 22:40  ( ↑ ₹40 over )    ₹6,880     ⌄   │
│  Wed 22:15  ( ↓ ₹500 short )  ₹6,010     ⌃   │
│    − ₹5,500 out · Demo Manager               │
│    counted at the counter, typed at home     │
│               [ Adjust this count ]          │
│  ────────────────────────────────────────    │
│              [ Show older counts ]           │
└──────────────────────────────────────────────┘
```

It opens on a balance, not a date picker, because that is the question the
collector has when they walk in. The figure sits at the right end of its own
label's line and the chips qualifying it sit directly beneath (decision 23).
Where an observation covers more than one day the chips say so before the count
is taken.

A recent count is a disclosure: closed it carries when, how much and the
verdict; open it carries the collection, the recorder, the reason they were
away, any adjustments, and the **Adjust** control (decision 21). The list is
paged — older counts arrive as the end of it comes into view, and the button
does the same for a reader the observer does not serve.

### Count & Collect

```
┌──────────────────────────────────────────────┐
│  COUNT & COLLECT                         ✕   │
│                                              │
│  Collection time                             │
│     [ ● Now ]  ( 15 min ago )  ( 30 min ago )│
│     ( 25 Aug, 10:20 pm ▾ )                   │
│     ( 22:02 )  ( ~ ±15 min )                 │
│                                              │
│  Cash counted before collection              │
│     ₹ [ 8950 ]                               │
│     ✓ Matches ₹8,950                         │
│                                              │
│  Cash collected, if any                      │
│     ₹ [ 0 ]                                  │
│     Leaving ₹8,950 in the drawer             │
│                                              │
│  ( ✓ at the outlet )                         │
│                                              │
│              [    Save count    ]            │
└──────────────────────────────────────────────┘
```

No numbered steps. They were scaffolding for a form of three fields that reads
top to bottom on its own, and a person reading *3 · Collecting any?* has been
told the count of the questions rather than the answer to one.

**Every time option is approximate** (decision 19), *Now* included, so the
window is stated once beside the chosen instant and no control asserts
certainty. The fourth option is a real date and time, for a count recalled long
enough after the fact that *30 min ago* is a fiction — the day the collector
skipped, entered when they return.

**Collection defaults to `0`**, so the common night is three taps and one
number: the drawer is counted, nothing is collected, and the leaving preview is
correct before anything is typed into it.

**The location chip is the whole of the away question when the answer is
nothing** (decision 20). Inside the fence it is one chip and no field.

### The same sheet, recorded away from the outlet

```
│  Cash collected, if any                      │
│     ₹ [ 7500 ]                               │
│     Leaving ₹1,450 in the drawer             │
│                                              │
│  ( ⚠ 3.4 km from Kalyani )                   │
│  Why are you recording this from elsewhere?  │
│     [ counted at the counter, typed at home ]│
│  Nothing is refused for being elsewhere. The │
│  record just says where you were.            │
│                                              │
│              [    Save count    ]            │
```

The field appears because the fence said so, and the save is refused without it
— by the sheet, in a sentence, rather than by a Postgres constraint message.
The same panel appears with *Could not tell where you are* when no fix arrives
at all, for the same reason: nothing on the row would show the person was there.

### Collecting a negative, which is cash going in

The counted drawer was thin, so the collector puts ₹1,000 back rather than
taking anything out. Same field, same record, no second control:

```
│  Cash counted before collection              │
│     ₹ [ 450 ]                                │
│     ✓ Matches ₹450                           │
│                                              │
│  Cash collected, if any                      │
│     ₹ [ -1000 ]                              │
│                                              │
│     ⚠  A minus means you are ADDING money    │
│        to the drawer, not taking it out.     │
│                                              │
│     Leaving ₹1,450 in the drawer             │
│                                              │
│              [   Save count   ]              │
```

The alert appears on the keystroke, not on submit. The verb, the preview and the
button all agree with the sign, so a mistyped minus is visible before it is
saved. The same treatment applies to the standalone sheet below, where the title
becomes `ADD TO DRAWER` and the balance preview runs upward.

Three inputs. The difference appears the moment the amount is typed, before
anything is saved, with its direction in words as well as by sign, because a
minus is the first thing a small screen loses and *"₹240 short"* is not a
sentence anyone misreads.

### The same sheet with an exact coincidence

```
│  Collection time                             │
│     ( 22:15 )  ( ~ ±15 min )   entering 23:04│
│                                              │
│  Cash counted before collection              │
│     ₹ [ 8950 ]                               │
│                                              │
│     ⚠  ₹854 SHORT                            │
│        That is exactly the 3 cash bills      │
│        rung between 22:04 and 22:12.         │
│                                              │
│  ── move the line to where you counted ──    │
│        22:41   ₹420                          │
│        22:33   ₹600      after your count    │
│        22:22   ₹180      ₹1,200              │
│     ━━━━━━━ you said 22:15 ━━━━━━━━━━━━━     │
│        22:12   ₹278  ┐                       │
│        22:08   ₹437  ├ these 3 = ₹854        │
│        22:04   ₹139  ┘  in your count        │
│        21:58   ₹596                          │
```

Dragging the line below `22:04` returns `✓ Matches ₹8,950`. The app named the
coincidence; the person moved the line.

### The same sheet with a real shortfall

```
│     ⚠  ₹500 SHORT                            │
│        No run of bills matches ₹500.         │
│                                              │
│        Your time is approximate (±15 min).   │
│        ₹914 of cash moved near it, so        │
│        timing could account for part.        │
```

No exact match, so no proposal of any kind. The collector saves it short or goes
and looks. There is no **I'm sure** control to escape the window with: every
count carries it (decision 19).

### Only Collect, and the rare Other Spend

```
┌──────────────────────────────────────────────┐
│  COLLECT CASH                            ✕   │
│                                              │
│  How much?    ₹ [ 5000 ]                     │
│                                              │
│  Drawer goes ₹12,400 → ₹7,400                │
│  You are not counting. Nothing is verified.  │
│                                              │
│  ( ✓ at the outlet )                         │
│                                              │
│              [    Collect    ]               │
└──────────────────────────────────────────────┘
```

One field on the common path. No actor picker: the actor is the session. No
reason: collection is the routine act. **Other Spend** is its own control on the
surface rather than a trailing link, asks for a reason, and says on its face
that it will not enter the month's expenses. Both sheets detect the position the
same way the count sheet does, and both ask for a reason on exactly the same
condition (decision 20).

### Adjust a locked count

```
┌──────────────────────────────────────────────┐
│  ADJUST A COUNT                          ✕   │
│                                              │
│  Tue 25 Aug · 22:00                          │
│  You recorded             ₹8,450             │
│  🔒 Locked. Your Fri count anchored on this. │
│                                              │
│  What should it have been?                   │
│     ₹ [ 8950 ]                               │
│     Moves the drawer by  +₹500               │
│                                              │
│  Why?  (required)                            │
│     [ miscounted, found a 500 note       ]   │
│                                              │
│  Both figures stay on the record. Friday's   │
│  count re-anchors the balance, so nothing    │
│  after Friday moves.                         │
│                                              │
│            [   Post adjustment   ]           │
└──────────────────────────────────────────────┘
```

Before the lock the same row offers `( edit )` and reopens the count sheet with
no reason and no trail.

### Reconciliation exception

```
┌─ NEEDS A LOOK ─────────────────────────┐
│  3 cash bills, ₹740, rung 21:40.       │
│  Arrived 01:04 from Tablet 1.          │
│  This explains the ₹740 you were over  │
│  at your 22:00 count.                  │
│         [ Accept ]   [ Count again ]   │
└────────────────────────────────────────┘
```

### Ledger, one day

```
┌──────────────────────────────────────────────┐
│  LEDGER · Kalyani        ‹  Tue 25 Aug  ›    │
│                                              │
│  ▌ REVENUE                                   │
│    Cash             ₹10,454  from counter 57 │
│    UPI              ₹14,200  from counter 91 │
│    Zomato            ₹8,140  settled         │
│       commission    −₹2,600                  │
│       net            ₹5,540                  │
│    Swiggy            ₹5,320  provisional     │
│       commission          —  not known yet   │
│    Total            ₹38,114                  │
│                                              │
│  ▌ DRAWER                                    │
│    Opening (04:00)   ₹1,450                  │
│      Cash sales    +₹10,454                  │
│      Gas (cash)       −₹900        18:10     │
│                                              │
│    ── COUNT · 22:00 ──────────────────       │
│      In drawer       ₹8,950   ✓ matched      │
│      Collected      −₹7,500   you, on site   │
│      Left            ₹1,450                  │
│    ───────────────────────────────────       │
│                                              │
│      After the count +₹2,054   6 bills       │
│                                              │
│    Closing (04:00)   ₹3,504                  │
│                                              │
│  ▌ EXPENSES                         ₹1,200   │
│    Gas         ₹900  cash  Rakesh   18:10    │
│    Packaging   ₹300  UPI   you      14:30    │
│                                              │
│              [  Verify this day  ]           │
└──────────────────────────────────────────────┘
```

A shortfall takes its own line inside the count block (`Unexplained −₹500 ⚠`),
so the block still adds up and the variance is not buried in a marker. A day
with no observation shows no block and marks both balances `carried`, naming
when the drawer was last confirmed.

### Ledger, one month

```
Tue 25   open  1,450   close  3,504   ✓ counted 22:00 · matched
Wed 26   open  3,504   close 12,254     carried
Thu 27   open 12,254   close 21,854     carried
Fri 28   open 21,854   close  3,254   ⚠ counted 22:00 · ₹200 short
                                        covers 3 days
```

`carried` means the app's belief, unchecked. It is the only word on the month
view that says how much the numbers can be trusted.

## Risks / Trade-offs

- **A mid-day boundary is more sensitive to device clock skew than 04:00 was**,
  in principle. `paid_at` is device-claimed, checked only against the same
  device's own command time within 300 seconds, so a badly skewed tablet could
  place a payment on the wrong side of a 22:00 line. **Measured, the exposure is
  negligible today**: sub-second in production across 684 bills. It belongs in
  `docs/LIMITATIONS.md` as a stated bound rather than as a guard to build.
- **A long interval blurs attribution.** Three days in one observation means a
  ₹200 variance cannot be pinned to a night. The surface says so rather than
  implying precision it does not have.
- **The derived ledger day costs a read.** A month view assembles thirty days
  from five sources with no stored row. Indexed on `(outlet_id, instant)` it
  should be comfortable at this scale, and a month is two outlets by thirty-one
  days, but it is measured rather than assumed (open question 3).
- **Stranded counts on revert**, bounded and stated in decision 16.
- **Two ledger entries in the navigation during the overlap**, on a shell the
  owner has already said is getting crowded. It is temporary and #12 removes it.

## Migration Plan

1. **Rehearse before writing any migration.** Replay August's real
   `manual_ledger_days` rows and the bills from 12 Aug onward through the derived
   reader offline, and assert the month lands on figures already known. This is
   the same rehearsal discipline `freeze-aggregator-and-supply-entry` used to
   prove its restatement, and it costs nothing to get wrong at a desk.
2. **One additive migration.** New tables with their RLS and their isolation
   tests, plus the two nullable instants. No drop, no rename.
3. **One push.** Both outlets, day one. The Cash drawer and the derived Ledger
   go `live`; the manual Ledger stays `live` and leaves the primary navigation.
4. **Two days of use**, both surfaces open, comparing a day in each.
5. **#12** carries pre-tablet history across and removes everything left dead.

Revert at any point before step 5 is a one-line registry edit and a deploy.

## Open Questions

1. ~~**Does an outlet need an explicit books-opening anchor for its very first
   observation?**~~ **Answered 2026-08-27 with the owner: neither candidate.**
   The first observation is a pure anchor carrying no opening, no expected total
   and no difference, marked by an explicit `is_anchor` flag; dates before it
   read `not tracked yet` rather than `carried`. Both original candidates are
   rejected, and the notebook-seeded one is forbidden by this change's own
   `manual-ledger` delta. Full reasoning in decision 18.
2. **Should a `spend` be visible anywhere other than its ledger day?** It is
   deliberately outside the month's operating figure, which means a ₹40,000
   fridge is currently findable only by remembering the date. A short
   "cash out, not in operating costs" block on the month view would answer
   "where did it go" without touching the P&L, and adds no surface.
3. ~~**Derived month performance**, measured against a real August rather than
   estimated.~~ **Answered 2026-08-27: it holds comfortably, and no read model is
   needed.** Measured through the real adapter against a seeded August on the
   local stack (`supabase/tests/rest/zz-ledger-month-timing.test.ts`, which now
   runs as its own `test:rls` phase so the answer keeps being true):

   | | one day | whole month (31 days) | per day |
   |---|---|---|---|
   | Kalyani | 87 ms | 389 ms | 13 ms |
   | Kanchrapara | 51 ms | 285 ms | 9 ms |

   The committed test asserts a deliberately generous 20-second ceiling rather
   than a tight bound: it runs on a laptop Docker stack, and a tight bound would
   fail for reasons that have nothing to do with the query. What it guards is an
   order of magnitude — a month that started taking thirty seconds would be a
   different design decision, and this is what would say so. **The remedy if it
   ever stops holding is still a materialised read model, never a stored day row
   that can disagree with its sources.**

   **The measurement earned its place twice over**, because writing it found a
   bug nothing else would have. Both real adapters were reading bill allocations
   as a PostgREST embed — `bills(..., effective_bill_payments(...))` — and
   `effective_bill_payments` is a **view with no declared foreign key**, so
   PostgREST refuses the nesting outright: *"Could not find a relationship
   between 'bills' and 'effective_bill_payments' in the schema cache"*. The pgTAP
   suite passed, because it tests the SQL functions. The mock passed, because it
   is not PostgREST. The component tests passed, because they use the mock. **The
   surfaces would have failed on their first real read**, and the only gate that
   touched the real adapter over HTTP was this one. Both now read the view as its
   own select and join by bill id, which is what `billing.ts` already did.
4. ~~**Does `paid_at` skew need an additional guard now?**~~ **Answered
   2026-08-26 from production: no.** Median skew is 1.2 to 1.3 seconds, the 95th
   percentile 2.4 to 3.2, and the worst device clock lead 0.9 seconds. A boundary
   placed to the minute is far outside that. State the limitation in
   `docs/LIMITATIONS.md` and add no guard; revisit only if a future device shows
   minute-scale drift.
