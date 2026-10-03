# Proposal: The Suite Gives The Same Answer All Day

> **Model**: Opus · **Kind**: delivery tooling — no roadmap row · **Gate**: **the database suite passes with the database's own clock inside the ninety-minute window that currently breaks it**, proved by moving the clock rather than by waiting for 04:00 IST; no time-sensitive fixture derives a business date from a UTC calendar date any more, and a fixture's business date and its timestamp always come from the same instant; **the production date guard is unchanged**, proved by a test that still rejects a mismatched pair from both sides of the cutover; the authenticated two-tablet test opens its spare shift on the outlet's business date rather than UTC's; and a full run inside the window reports the same result as a full run outside it.

## Why

A test suite that passes in the afternoon and fails at five in the morning is not
telling you about your code. It is telling you the time.

This one does exactly that, and it has now done it twice. It was first recorded on
2026-09-08 in
[`openspec/todos/database-tests-cross-the-business-cutover.md`](../../todos/database-tests-cross-the-business-cutover.md).
It happened again on 2026-09-21 at 23:41 UTC, failing the `Deploy` workflow on a
commit that contained **nothing but documentation** — a roadmap row and a
proposal. No code, no migration, no schema.

That is the cost, and it is worse than a wasted CI minute. A red build that nobody
believes is a build nobody reads. The next real regression arrives in a suite
everyone has learned to shrug at.

## What is actually happening

The business-date guard derives what a row's business date **ought** to be from
the row's own timestamp:

```sql
v_ts       := (to_jsonb(new)->>'opened_at')::timestamptz;
v_expected := public.app_business_date(v_ts, v_cutover);
if new.business_date is distinct from v_expected then raise exception ...
```

The fixtures, meanwhile, label their rows with `current_date` — the **UTC**
calendar date.

Those two agree for most of the day and disagree for ninety minutes of it. IST is
UTC+5:30 and the outlet cutover is 04:00, so from **22:30 UTC** the Kolkata
business date has rolled over while the UTC calendar date has not. At **00:00
UTC** the UTC date catches up and they agree again.

```
IST  04:00 ─────────────── 05:30        business date = today
UTC  22:30 ─────────────── 00:00        current_date  = yesterday   ← mismatch
```

So the failure is not flaky, not a race, and not infrastructure. It is a fixture
asking two different clocks what day it is.

## The window is not where the bug lives

This matters for how it gets fixed, and it is the reason this change does not need
anybody awake at 4am.

The guard reads **the row's timestamp**, not the wall clock. A fixture that stamps
a row `2026-09-21 23:41+00` produces the identical failure at any hour of any day.
The nightly window is merely when the suite stumbles into the mismatch **by
accident**.

That means the fix can be proved deterministically, and the suite need never again
depend on when it is run.

## Blast radius

Wider than the three suites that failed. `current_date` appears in at least twelve
test files, including **42 occurrences in `39_preparing_order_pipeline.sql`** and
**42 in `05_write_contract_inventory_cash.sql`**.

The 2026-09-21 run failed receipt suites **50, 51 and 52** exactly as the note
predicted, and also failed **ten of thirty-five** subtests in suite 39 and one in
another. Suite 39's failures name bills and orders — `the unwound bill reads
void`, `the order reopens`, `the paid order becomes cancelled history` — which are
rows the guard validates. Same mechanism, not a second one.

**Not every `current_date` is wrong.** Only those labelling a row whose timestamp
the guard checks. A blanket replacement would be the wrong instinct and is
explicitly out of scope; each occurrence is looked at.

The note records one more case with the same shape and a different surface: the
authenticated two-tablet test opens its spare shift with
`new Date().toISOString().slice(0, 10)` — UTC again — while the counter uses the
outlet business date. In the window, the spare's payment dialog stays open.

## What changes

- **A fixture's business date comes from the same instant as its timestamp**, via
  the same helper the guard uses, rather than from a UTC calendar date.
- **One test proves both sides of the cutover explicitly**, inserting fixed
  timestamp and business-date pairs either side of 04:00 and asserting the guard
  accepts the matching ones and rejects the mismatched ones. This is the part that
  makes the suite's correctness independent of when it runs.
- **The authenticated two-tablet test** opens its spare shift on the outlet's
  business date.
- **The production guard is untouched.** Its job is to catch exactly this
  disagreement in real data.

## Non-goals

- **Weakening the date validation to make fixtures pass.** The note is explicit and
  it is right: the guard is a production correctness rule, and a fixture that finds
  it inconvenient is the thing that is wrong. Any change that makes the guard
  accept a mismatched pair has failed, not succeeded.
- **Changing the database connection timezone.** Tried on 2026-09-08. It moved the
  failures into attendance fixtures rather than removing them, and the timezone was
  restored to UTC. See `design.md`.
- **Retrying, skipping or scheduling around the window.** All three hide it, and a
  suite that is nondeterministic on purpose is worse than one that is
  nondeterministic by accident.
- **The seeded stack left open across the cutover.** The note records this
  separately: an open local stack expires its active shifts and later REST billing
  probes fail. A fresh reset resolves it, it affects no CI run, and it is a
  different mechanism. Out of scope, and it stays in the note.
- **No product behaviour changes.** Nothing a customer, owner or counter sees moves.
  This is why there is no roadmap row.

## Docs to update before archiving

- [`docs/TESTING.md`](../../../docs/TESTING.md) — how a time-sensitive fixture
  picks its business date, and the rule that a fixture never asks a different clock
  than the guard does.
- [`openspec/todos/database-tests-cross-the-business-cutover.md`](../../todos/database-tests-cross-the-business-cutover.md)
  — closed, leaving the open-stack case behind as the part this change did not take.
