# Design: The Suite Gives The Same Answer All Day

## Context

`public.app_business_date(ts timestamptz, cutover time)` maps an instant to the
outlet's business date: the Kolkata calendar date, rolled at the outlet's cutover
(04:00 today). It is the single definition of "which trading day is this", and the
guard installed by `20260811000001_billing_transaction_contract.sql` uses it to
check that a row's stored `business_date` agrees with the row's own timestamp.

Fixtures label rows with `current_date`. That is the session's **UTC** calendar
date, which is a different question with a usually-identical answer.

The two answers diverge from 22:30 UTC to 00:00 UTC — after the Kolkata business
date rolls at 04:00 IST, before the UTC date rolls at midnight. Ninety minutes,
every night.

## The decision

**A fixture derives its business date from the instant it is stamping the row
with, using the same helper the guard uses.**

Not from `now()` independently of the timestamp — from *that timestamp*. The two
have to come from one instant or the fixture can still disagree with itself when a
row is stamped near a boundary.

Concretely, the harness grows one helper used by every time-sensitive fixture, and
fixtures stop reaching for `current_date` when labelling a guarded row.

### Why this and not the alternatives

**Rejected: set the connection timezone to Asia/Kolkata.** The obvious fix, and it
was actually tried on 2026-09-08. `current_date` then answers the Kolkata date,
which repairs the receipt fixtures — and breaks attendance fixtures, which had been
written against UTC and now shift by five and a half hours. The timezone was
restored to UTC. Recorded in the backlog note.

The deeper reason it was never going to work: the cutover is **04:00, not
midnight**. Even in Kolkata, `current_date` answers a calendar question and the
guard asks a trading-day question. They agree for twenty hours a day and disagree
for four. A timezone change narrows the window; it does not close it.

**Rejected: weaken the guard to accept either date.** Forbidden by the note, and
correctly. The guard exists because a bill filed under the wrong trading day
corrupts every figure that sums by business date — the day's takings, the drawer
reconciliation, the month. It is one of the few rules in this schema that protects
money. A fixture is not a reason to relax it.

**Rejected: freeze the clock for the suite** (`libfaketime`, a clock extension, a
fixed `now()`). Heavier than the problem: a new dependency in the database
container for every run, affecting every test rather than the handful that care.
And it does not actually fix the fixtures — a frozen clock still leaves
`current_date` and the guard asking different questions, just at a time of day
chosen to make them agree. That is concealment with extra steps.

**Rejected: retry the job, or skip the window.** A suite that is allowed to be
wrong for ninety minutes is a suite whose result means less for the other
twenty-two and a half hours. The failure is real and deterministic; hiding it
teaches people to ignore red.

**Rejected: pin the whole suite to one fixed date.** Some tests legitimately want
"today" — attendance against the current day, a shift opening now. Pinning
everything would either break them or require a second mechanism for the ones that
opt out, which is two mechanisms where one will do.

## How this gets proved without waiting until 04:00

This is the part worth designing rather than leaving to the gate.

**The deterministic proof.** One new test inserts fixed pairs either side of the
cutover — a timestamp at 03:30 IST with the previous business date, one at 04:30
IST with the current one, and the mismatched versions of both — and asserts the
guard accepts and rejects exactly as it should. It reads no clock. It fails the
same way on any machine at any hour, which is the property the rest of the suite
is supposed to gain.

**The real-world proof.** The suite is run once with the database container's clock
moved into the window, rather than by staying up for it. That confirms the fixtures
themselves, not only the new test.

Both are in `tasks.md`. The first is the one that keeps working forever; the second
is the one that confirms the first was about the right thing.

## Found while applying: the seed has the same fault in another shape

Run inside the window on 2026-09-28, the fixture fixes cleared five of the seven
failing files and left `03_status_and_scope` and `30_counter_operations_snapshot`.
Neither is a calendar-date fault. The seed places today's rows at relative offsets
— the open shift two hours ago, its bills forty-five and twenty minutes ago, an
earlier closed shift five hours ago — and each row derives its own business date
correctly from its own instant. But in the first hours after the 04:00 cutover,
"forty-five minutes ago" is yesterday, so the open shift and its two bills land on
two different trading days. The fault is fixed at seed time, not test time: a
stack reset at 04:30 fails until it is reset again.

**Decision: compress today's timeline into however much of today exists.** Every
intraday offset is multiplied by `least(1, time since the cutover / 6 hours)`,
computed once at the top of the seed. Order and proportions are kept, every row
lands inside the current trading day at any hour, and after 10:00 IST the seed is
byte-for-byte what it was.

**Rejected: clamp each row to the cutover.** Rows that crossed would all collapse
onto 04:00, and the closed shift would end before it opened relative to the open
one; the scenario's shape is what the tests are about.

**Rejected: shift the anchor into the future.** A shift opened after `now()` is
refused by every command that checks `created_at >= opened_at`.

**Rejected: a helper function.** The CLI sends the seed as one batch, so a
function the seed creates does not yet exist when later statements are parsed. A
session setting read through the built-in `current_setting` works.

One test relied on the uncompressed timeline by accident:
`43_the_drawer_explains_its_figures` counted bills in the last fourteen minutes
and expected exactly its own thirteen. Compressed, Kanchrapara's seeded cash bill
falls inside that interval. The assertion now counts against what the interval
already held, which is what it meant.

Two smaller findings from the same run, both now in `docs/TESTING.md`:

- **A command-written bill is dated by `ordered_at`.** `51` stamped a careful
  `created_at` and left `ordered_at` to default to `now()`, so the guard checked
  the wrong clock.
- **A fixture helper that reads the outlet under RLS returns null once the test
  impersonates another outlet's tablet.** The first version of the helper did
  exactly that and turned an `authorization_refused` assertion into
  `malformed_payload`. The helper now reads the cutover once, while privileged.

And the two-tablet test could not simply date its spare shift from the instant it
opens, as first written, because it opened an hour back: in the first hour after
the cutover that instant is yesterday. It now opens an hour back or at the
cutover, whichever is later.

## RLS, money and offline semantics

Called out explicitly, per the design rules:

- **No RLS policy changes.** No policy is added, altered or relaxed. The isolation
  suite's assertions are untouched; the fixtures feeding it may change how they
  label a date, never who may read a row.
- **No money arithmetic.** No paise value, total, discount or rounding is touched.
  What changes is which trading day a fixture files a row under — and only in
  fixtures.
- **Offline semantics untouched.** The counter's queue, its client-generated UUIDs
  and its idempotency are not in scope. Note that the business date the *counter*
  sends is already derived from the outlet's cutover, which is why production has
  never hit this: the bug is confined to fixtures that hand-label rows.

## The risk worth naming

The mechanical change is small and repetitive across a dozen files, which is
exactly the shape of change where a careless sweep does damage. Two guards:

1. **Not every `current_date` is wrong.** Only ones labelling a row the guard
   checks. The others answer perfectly reasonable questions and are left alone.
2. **A green suite is not sufficient evidence**, because the suite is green for
   twenty-two and a half hours a day already. The clock-moved run is what
   distinguishes a real fix from a sweep that happened to be made in the afternoon.
