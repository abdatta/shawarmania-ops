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

## The surfaces

Layout conventions in these sketches: `[ 8950 ]` is typed, `( chip )` is tapped,
a bare `₹8,950` is computed and static, and `✓`/`⚠` are computed markers.

### Cash drawer

```
┌──────────────────────────────────────────────┐
│  CASH DRAWER · Kalyani            [switch]   │
│                                              │
│  Should be in the drawer now       ₹8,950    │
│                                              │
│  Last counted   yesterday 22:20              │
│  Left in drawer                    ₹1,450    │
│  Cash bills since                + ₹8,400    │
│                                    51 bills  │
│  Cash expenses since               − ₹900    │
│                                    1 entry   │
│                                              │
│         [    Count the drawer    ]           │
│         collect cash without counting        │
│                                              │
│  RECENT COUNTS                               │
│  Sun 23:02   7,120   matched    took 6,000   │
│  Fri 22:40   6,880   ₹40 over   took 5,500   │
└──────────────────────────────────────────────┘
```

It opens on a balance, not a date picker, because that is the question the
collector has when they walk in. Where an observation covers more than one day
the header says so before the count is taken.

### Count the drawer

```
┌──────────────────────────────────────────────┐
│  COUNT THE DRAWER                        ✕   │
│                                              │
│  1 · When did you count it?                  │
│     [ ● Just now ]  22:02                    │
│     ( 30 min ago )  ( 1 hr ago )             │
│     ( pick a time )                          │
│                                              │
│  2 · What was in the drawer?                 │
│     ₹ [ 8950 ]                               │
│     ✓ Matches ₹8,950                         │
│                                              │
│  3 · Collecting any?                         │
│     ₹ [ 7500 ]                               │
│     Leaving ₹1,450 in the drawer             │
│                                              │
│              [    Save count    ]            │
└──────────────────────────────────────────────┘
```

### Step 3 with a negative, which is cash going in

The counted drawer was thin, so the collector puts ₹1,000 back rather than taking
anything out. Same field, same record, no second control:

```
│  2 · What was in the drawer?                 │
│     ₹ [ 450 ]                                │
│     ✓ Matches ₹450                           │
│                                              │
│  3 · Collecting any?                         │
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

### The same sheet with an approximate time and an exact coincidence

```
│  1 · When did you count it?                  │
│     [ ● 22:15 ]           entering 23:04     │
│                                              │
│  2 · What was in the drawer?                 │
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
│                                              │
│        [ I'm sure of the time ]              │
```

No exact match, so no proposal of any kind. The collector saves it short or goes
and looks.

### Collect cash, and the rare spend

```
┌──────────────────────────────────────────────┐
│  COLLECT CASH                            ✕   │
│                                              │
│  When?    [ ● Just now ]  16:20              │
│           ( pick a time )                    │
│                                              │
│  How much?    ₹ [ 5000 ]                     │
│                                              │
│  Drawer goes ₹12,400 → ₹7,400                │
│  You are not counting. Nothing is verified.  │
│                                              │
│              [    Collect    ]               │
│                                              │
│  spent it on something? record a cash spend  │
└──────────────────────────────────────────────┘
```

Two fields on the common path. No actor picker: the actor is the session. No
reason: collection is the routine act. The trailing link opens the `spend`
variant, which asks for a reason and says on its face that it will not enter the
month's expenses.

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

1. **Does an outlet need an explicit books-opening anchor for its very first
   observation?** Today the first observation has no previous one, so its
   `opening_paise` has to come from somewhere. The candidates are an
   owner-supplied figure once per outlet, or zero with the first difference
   absorbing the float. Settle before writing the table.
2. **Should a `spend` be visible anywhere other than its ledger day?** It is
   deliberately outside the month's operating figure, which means a ₹40,000
   fridge is currently findable only by remembering the date. A short
   "cash out, not in operating costs" block on the month view would answer
   "where did it go" without touching the P&L, and adds no surface.
3. **Derived month performance**, measured against a real August rather than
   estimated. If it does not hold, the answer is a materialised read model, never
   a stored day row that can disagree with its sources.
4. ~~**Does `paid_at` skew need an additional guard now?**~~ **Answered
   2026-08-26 from production: no.** Median skew is 1.2 to 1.3 seconds, the 95th
   percentile 2.4 to 3.2, and the worst device clock lead 0.9 seconds. A boundary
   placed to the minute is far outside that. State the limitation in
   `docs/LIMITATIONS.md` and add no guard; revisit only if a future device shows
   minute-scale drift.
