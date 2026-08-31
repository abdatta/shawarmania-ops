## Context

`manual-ledger-stopgap` (#36) landed two tables on 2026-08-03 with an explicit
exit written into the capability spec, `docs/LIMITATIONS.md` and the proposal of
the change that would perform it. That obligation then grew twice:
`expense-categories-grow-from-use` made both sides free text, and
`the-ledger-opens-to-the-outlet` added attribution, void state and the
recorded-from-away marker. All of it is owed here.

**The production baseline was re-read on 2026-08-31 immediately before the
migration was drafted.** The 2026-08-26 figures below are retained only as the
earlier comparison; the migration asserts the fresh figures that follow it.

| | Kalyani | Kanchrapara |
|---|---|---|
| `manual_ledger_days` | 19 rows, 2026-08-01 to 08-23 | 19 rows, 2026-08-01 to 08-22 |
| Of those, carrying a count | 15 | 15 |
| Of those, carrying cash removed | 13 | 11 |
| Of those, carrying cash added | 1 | 1 |
| Days with no bills at that date | 12 | 13 |
| `manual_ledger_expenses` | 42 rows | 65 rows |
| Of those, voided | 1 | 9 |
| Of those, recorded from away | 27 | 47 |
| Of those, corrected by another account | 0 | 0 |
| Of those, cash | 31 | 24 |
| Distinct categories | 21 | 19 |

`public.expenses`, `daily_cash_records` and `cash_withdrawals` each hold zero
rows.

### Final pre-migration baseline — 2026-08-31

The required external snapshot is
`C:\Users\iamro\shawarmania-prod-snapshots\2026-08-31-pre-retire-manual-ledger\`.
Its schema, public data and Auth data restored into the isolated local database
`retire_ledger_restore_20260831`; the restored notebook counts matched the dump
exactly.

| | Kalyani | Kanchrapara |
|---|---:|---:|
| `manual_ledger_days` | 20 | 20 |
| Rows carrying a non-zero count | 16 | 16 |
| Rows carrying cash removed | 14 | 12 |
| Rows carrying cash added | 1 | 1 |
| `manual_ledger_expenses` | 48 | 81 |
| Voided | 1 | 9 |
| Recorded from away | 28 | 50 |
| Corrected by another account | 0 | 1 |
| Cash rows | 37 | 37 |
| Effective cash expense total | 903,300 paise | 931,900 paise |
| Effective non-cash expense total | 14,912,700 paise | 20,437,445 paise |
| Gross cash expense total | 903,300 paise | 931,900 paise |
| Gross non-cash expense total | 15,168,224 paise | 25,452,574 paise |

The counted-cash baseline, including the four zero rows per outlet that never
represented a physical count, is:

| Business date | Kalyani | Kanchrapara |
|---|---:|---:|
| 2026-08-01 | 0 | 0 |
| 2026-08-02 | 0 | 0 |
| 2026-08-03 | 0 | 0 |
| 2026-08-04 | 0 | 0 |
| 2026-08-05 | 25,000 | 22,000 |
| 2026-08-06 | 47,000 | 19,000 |
| 2026-08-07 | 59,000 | 15,000 |
| 2026-08-08 | 45,000 | 20,000 |
| 2026-08-09 | 34,000 | 10,000 |
| 2026-08-10 | — | 169,000 |
| 2026-08-11 | 44,000 | 392,000 |
| 2026-08-12 | 49,000 | 422,000 |
| 2026-08-13 | 44,000 | 20,000 |
| 2026-08-14 | 31,000 | — |
| 2026-08-15 | 44,000 | 16,000 |
| 2026-08-16 | 32,000 | 30,000 |
| 2026-08-17 | 31,000 | 12,000 |
| 2026-08-18 | 35,000 | 47,000 |
| 2026-08-20 | — | 20,000 |
| 2026-08-22 | 36,000 | 30,000 |
| 2026-08-23 | 40,000 | — |
| 2026-08-26 | 30,000 | 30,000 |

Both non-zero cash-added rows carry a usable reason. Machine-sourced expenses
carry their source identity instead of falsely naming a human recorder; every
human-entered row has its recorder, every corrected row its corrector, and every
voided row its reason.

The owner initiated the apply on **2026-08-31**, after #11 had produced six real
drawer observations across the two outlets. That request is the dated go-ahead
to end the overlap. The production snapshot and the derived reader were compared
before this migration was drafted; disagreements in typed-vs-billed cash remain
evidence and are not repaired here.

Three facts shape what the carry-over should be, and each was verified rather
than assumed:

- **The app writes `manual_ledger_expenses` everywhere.** `public.expenses` is
  referenced once, in `src/data-access/supabase-adapters/expense-categories.ts`,
  and holds no rows. The stopgap table is the real one.
- **The stopgap has the better schema.** `public.expenses` carries an enum
  category and no void. `manual_ledger_expenses` carries a free-text category
  snapshot, `voided_at`/`voided_by`/`voided_reason`, `updated_by` and
  `recorded_away`. Migrating rows from the richer table into the poorer one
  would lose exactly the things the obligation says must survive.

So the carry-over for expenses is a **rename**, not a data migration. That is
both less work and less lossy, and it is the opposite of what the original #12
proposal assumed.

The day rows are a genuine transformation, because a stored day with an opening
and a count has to become an observation with an instant it never recorded.

## Goals / Non-Goals

**Goals**

- Make every date the business has traded readable from one derived surface.
- Preserve every attribution, void and marker the notebook accumulated.
- Remove the second writable record of a trading day.
- Remove the dead day-close code and the flag that outlived its reader.
- Keep the rows.

**Non-Goals**

- Deleting anything that is the only record of a period.
- Touching the drawer model settled in #11.
- Re-homing the billing-readiness gate.

## Decisions

### 0. The notebook counts the drawer AFTER the collection; this model counts it before

**This is the carry-over's one real trap, and it was found by reading production
rather than the schema.** `manual_ledger_days.counted_cash_paise` is compared
against an expected figure that has already subtracted `cash_removed_paise`
(`src/features/manual-ledger/ledger.ts:171`). So the notebook's counted figure is
the **float left behind**, not the amount seen in the drawer.

`cash-is-counted-not-closed` defines `counted_total` the other way: what was in
the drawer at the moment of counting, with the collection applied afterwards to
give the carry-forward. The two are the same event described from opposite sides
of the collection.

So the carry-over must convert, not copy:

```
observation.counted_total = counted_cash_paise + cash_removed_paise
cash_out.amount           = cash_removed_paise
next opening              = counted_cash_paise
```

A copy would understate every carried August observation by that day's
collection. At Kalyani those collections run from ₹1,000 to ₹4,000 a day, so the
error would be large, systematic, and invisible against a table that had been
archived. A migration assertion checks the identity above per row.

**Rejected: redefine `counted_total` to mean the float left, so the copy is
direct.** It would make every future count ask the collector for a figure they
produce last instead of the one they produce first, and it would put the
difference on the wrong side of the collection.

### 0a. Cash added went in **before** the count, so it is not the observation's own

`cash_added_paise` is the notebook's record of money put into the drawer during
the day. The notebook's own reading places it among the inflows —
`expected = opening + revenue + added − expenses − removed` — and compares that
against the count, so the count already holds it. Its form prefilled the next
day's opening with the previous count and nothing else
(`draftInheriting`, `src/features/manual-ledger/ledger-day.tsx`).

Production settles it beyond argument. Both cash-added rows are 2026-08-05, the
first counted day at each outlet, and both carry the reason *"This is the real
cash that was left at the end of the day."*:

| | opening | revenue | added | expenses | counted | next day's opening |
|---|---:|---:|---:|---:|---:|---:|
| Kalyani 2026-08-05 | 0 | 0 | 25,000 | 0 | 25,000 | 25,000 |
| Kanchrapara 2026-08-05 | 0 | 0 | 37,000 | 15,000 | 22,000 | 22,000 |

Each day balances to nought only if the addition is inside the count, and each
following day opens on the count itself.

So the carried movement is a negative `collection` at the observation's instant
and **deliberately not linked to the observation**. A linked movement is
excluded from its observation's arithmetic and raises the *next* opening
instead, which is right for #11's live case — the collector topping the drawer
up as they count — and wrong for this one. Linked, the top-up would inflate the
following day's opening by its own amount and put the same amount on the
difference a second time. Unlinked, it lands inside the interval, where
subtracting a negative adds it, exactly as the notebook had it, and decision 0's
`next opening = counted_cash_paise` holds on every carried row.

### 0b. The carried interval reads the notebook's receipts, by business date

Two further terms would have been re-derived from sources that do not cover the
period:

**Receipts.** The counter did not start billing until **2026-08-12** at Kalyani
and **2026-08-14** at Kanchrapara. Deriving a carried day's expected figure from
bills therefore reports the drawer as thousands of rupees *over* on all fifteen
earlier carried days — an invented surplus standing in for a till that was never
rung. The notebook's `cash_revenue_paise` is the only record of receipts this
period has, so the carry uses it for every carried day: one rule, no branch on
when billing began, and no fabricated variance. Where both sources exist they
mostly agree, and the day's bills are listed beside the carried figure, so a
disagreement stays visible instead of being settled by whichever source the
carry-over happened to prefer.

**Expenses.** A carried expense's `occurred_at` is when somebody typed it, and
much of August was typed days later in one sitting. Matching on the instant
drops a day's expenses into a neighbouring day's interval and carries the
difference with them. The notebook read expenses by business date, so the carry
does too, over the whole range since the previous carried date — which also
keeps the expenses recorded across a skipped date from being lost.

With both in place every carried day whose chain neither breaks nor skips a date
reproduces the notebook's own difference exactly. The days that differ are
precisely the ones that should: a reported chain break, or a gap whose expenses
have to land somewhere.

### 1. A carried day becomes an observation with an explicitly imprecise instant

Each `manual_ledger_days` row holds an opening, a counted amount, cash added and
cash removed with reasons, for a business date, with no time of day anywhere.

It becomes a `drawer_observation` whose counted instant is placed at that
outlet's cutover boundary for that date and which is flagged **legacy
imprecise**: a distinct marker, not the ordinary approximate flag, because
approximate means "within fifteen minutes" and this means "the hour was never
recorded". The surface renders a legacy observation without a time of day and
without a tolerance figure, since a rupee tolerance derived from a fabricated
instant would be worse than none.

Cash removed becomes a `drawer_cash_out` of kind `spend` where it carries a
reason and `collection` where it does not, at the same instant, with the amount
conversion from decision 0.

**Cash added carries across as a negative cash out**, at the same instant, of
kind `collection`, retaining `cash_added_reason` in the nullable reason column.
#11's amounts are signed precisely so that cash entering the drawer needs no
separate concept, and the notebook's `cash_added_paise` is that case exactly.

This replaces an earlier plan to carry cash added as an adjustment against the
observation, which was a fudge around a model that could not express inbound
cash. It no longer has to be. Production has two such rows, one per outlet
(checked 2026-08-26), and both are now an ordinary movement with a minus sign.

**Rejected: invent a plausible evening time.** It would make legacy rows
indistinguishable from real ones and would silently claim precision that was
never captured. This repo's own precedent for a retroactive record is to use a
distinct legacy shape rather than a convincing fake.

**Rejected: leave the days unmigrated and let the ledger read two sources.** It
is less work now and it means the derived reading has a permanent branch on
"before the notebook ended", which is the sort of seam that is still there in
three years.

### 1a. A carried count shows the date it has, and does not narrate the hour it lacks

The first cut marked a carried observation with the sentence *"Hour was never
recorded"*, in the place an ordinary observation renders its date and time. On
the ledger that read acceptably, because both ledger readings are scoped to one
business date and name it above the row. On the **drawer** it did not: that
surface opens on a balance rather than a date, its Recent counts list pages
backwards into August, and the sentence displaced the one fact that would have
placed the row. Several carried counts in a row were mutually
indistinguishable.

The owner put it plainly on the day of the release: the date *was* recorded, so
show it — an absent time says the rest by itself, next to rows that all carry
one. That is the better instinct, and it is the same instinct the rest of this
change runs on: state what was recorded, and let what is missing be visibly
missing rather than announced.

So the three drawer-side readings show the date, and the two ledger readings show
neither the date nor the sentence: the date is already above them, and `Count`
with no time after it is the whole of what there is to say.

**The trap is that the date may not be read off the instant.** A carried
observation's `counted_at` is the outlet's cutover boundary, which by construction
falls on the *following* calendar day — a count recorded for 05 August is stored
at 06 August 03:59:59.999999. Formatting that instant yields a date that is
wrong by a day on every carried row and looks entirely plausible, which is the
worst combination available. The date must come from the business date resolved
through the outlet's own cutover, and where the cutover has not yet loaded the
date is omitted rather than assumed from the 04:00 default that both outlets
happen to use — an assumption that is correct today is exactly what would keep a
wrong one from being noticed later.

The year follows the rule the counts list and the breakdown groups already
follow: dropped for the current year, kept for an older one. A carried row then
reads like the rows beside it rather than being the only one carrying a year.

**Rejected: showing the boundary instant's time behind a "carried" chip.** It
would be a real figure from the database and a fiction about the shop, which is
the trade this change refuses everywhere else.

### 2. Expenses are promoted by rename, and the empty table is dropped

`manual_ledger_expenses` becomes `expenses`, taking its policies, indexes,
triggers and constraints with it. The unused `public.expenses` is dropped first
so the name is free.

`docs/DATA_MODEL.md`'s note that the consumption basis matches the literal word
`raw_materials`, a value of the closed category list that nothing types any
more, is settled here rather than left: the basis is either matched against the
category snapshot the promoted table actually holds, or the consumption basis is
withdrawn until something types that word. Whichever, it stops being a matcher
that silently matches nothing.

**Rejected: migrate rows into `public.expenses`.** It loses void state,
attribution, the last corrector, the recorded-from-away marker and the free-text
category, all of which the removal obligation names.

### 3. Archive the day rows rather than dropping them

`manual_ledger_days` is renamed to an archive name, kept read-only with no client
grant, and read by nothing. The surface, the write path and the capability are
gone, which is what retirement means; the sixty-odd rows stay because they are
the only record of August and storage is not the constraint.

The archive remains in **`public`** as `archived_manual_ledger_days`, with RLS
enabled, no policies, no client or service-role grant, and an immutable trigger.
This settles open question 3. Moving forty rows into a second schema adds a
restore path without adding protection: no runtime role can reach this table in
either arrangement, while keeping it in `public` leaves the snapshot and the
down-migration straightforward to inspect.

### 3a. Carrying history rebases the former live anchor once

#11 is already in production, so each outlet already has a later observation
marked as its anchor. Carrying earlier August observations in front of it would
otherwise create two anchors or a chronological chain whose anchor sits in the
middle. The migration therefore performs one deliberate, transaction-local
rebase: the earliest carried observation becomes the anchor; the former anchor
keeps its identity, counted total, recorder and instant but becomes an ordinary
observation whose opening, expected figure and difference are computed from the
last carried observation. Later observations do not move, because their opening
already derives from that former anchor's unchanged counted total and own cash
out.

This is the only time an anchor flag changes. It requires temporarily disabling
the identity trigger inside the migration, and the migration re-enables it and
asserts one chronological anchor per outlet before it may commit.

**Rejected: drop the table after the carry-over.** The carried observations are
a transformation, and a transformation can be wrong in a way nobody notices for
a month. Keeping the source costs nothing and is the only thing that makes the
transformation checkable afterwards.

### 4. Drop the day-close code rather than re-homing any of it

`daily_cash_records` has never held a production row. `close_business_day()`
summed cash expenses from the empty `public.expenses`, so it would have produced
a wrong figure the first time anybody ran it. `billing_assert_day_ready()` has
one caller, which is `close_business_day()`, and
`counter_shift_closed_day_guard()` refuses a shift on a date that has a closed
record, which cannot happen once no record can be written.

All four go together. The billing-readiness question is real and is not being
answered by anything that remains; if a day-level seal is wanted it is its own
change, with a reason that is not "we already had a function".

### 5. Drop `billing_live_from` and close its todo

The column's only reader is the manual ledger form's decision to ask for typed
Cash and UPI. `openspec/todos/ledger-handover-per-outlet.md` treats setting it as
an outstanding operational act at both outlets.

That act is not performed here; it becomes unnecessary. The todo closes with that
stated, because a future reader finding a closed todo needs to know whether the
work was done or dissolved.

### 6. The order of operations is chosen so a failure leaves a working system

The migration runs in one transaction, and its order is deliberate:

1. Dump both notebook tables to a file outside the repo.
2. Carry expenses by rename, after dropping the empty `public.expenses`.
3. Carry day rows into observations, cash out and adjustments.
4. Assert the reconciliation described in decision 7 **inside the transaction**,
   and raise if it fails.
5. Archive `manual_ledger_days`.
6. Drop the day-close code and `billing_live_from`.

Step 4 is what makes the rest safe: a carry-over that does not reproduce the
known totals aborts the whole thing rather than leaving the estate half moved.

### 7. The carry-over asserts against figures already known

The rehearsal from #11 established each August month total from the notebook.
This change asserts the same totals from the carried rows, inside the migration,
before anything is archived or dropped:

- Each outlet's monthly cash expense total, cash and non-cash, matching the
  notebook's.
- Each outlet's count of expense rows including voided ones, matching.
- Each carried observation's counted total equal to its source row's counted
  cash.
- Every carried row carrying a recorder; every corrected row carrying a
  corrector; every voided row carrying its reason.

This mirrors the discipline `freeze-aggregator-and-supply-entry` used, whose gate
named the exact figure its restatement had to reproduce.

## Risks / Trade-offs

- **This change cannot be reverted by hiding a surface.** It is the reason the
  pair is split, and the mitigation is the dump in task 1.1 plus a written and
  tested down-migration that nobody expects to run.
- **A rename touches every generated type and every adapter reference.** It is
  mechanical and the compiler finds it, but it is a wide diff and it lands on a
  table holding live production rows.
- **Legacy observations will look odd next to real ones**, deliberately. A
  reader who does not know why should find the answer on the row rather than in
  a document, so the marker carries a plain sentence.
- **Cash added has no clean counterpart**, and modelling it as an adjustment is
  the least-bad fit rather than a natural one. It affects only the handful of
  August rows that carry one.

## Migration Plan

Sequenced as decision 6, gated by decision 7, with the dump before anything and
the archive before any drop. The change lands as one release, weeks after #11,
once the derived statement has been read against the notebook for real trading
days and the owner says so.

## Open Questions

1. ~~**The `raw_materials` matcher**~~ **Closed 2026-08-31.** The consumption
   basis is withdrawn. Inventory is shelved, so a consumption figure cannot be
   computed; leaving a basis that silently matches nothing would be dishonest.
2. ~~**How many August day rows carry cash added**~~ **Closed.** The count is
   two, one per outlet, read 2026-08-26, and the modelling question dissolved
   when #11 made cash-out amounts signed: cash added is a negative movement, so
   there is nothing bespoke to decide.
3. ~~**Where the archived day table lives**~~ **Closed 2026-08-31.** It remains
   in `public` as `archived_manual_ledger_days`, with no policy, no runtime grant
   and an immutable trigger, for the reasons in decision 3.
