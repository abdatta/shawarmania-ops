# Proposal: The Day Change Finishes Paid Orders

> **Model**: Opus · **Wave**: F · **Depends on**: #55, #50, #35 · **Gate**: a
> paid order nobody ticked **Prepared** leaves every counter rail at its outlet's
> business-day cutover on its own, recorded as prepared **at that cutover** and
> marked as finished by the day change rather than by a person, so one query
> counts how often it happens, where and on which days; the record is identical
> whether the sweep ran on the minute or an hour late; an unpaid open order is
> untouched; **Finish Day no longer refuses** over a paid-but-unprepared order and
> instead says it will be marked prepared at the cutover, while still refusing
> over an unpaid one; a Prepared tick queued offline before the cutover and
> delivered after it is accepted and replaces the day change's stamp with the
> counter's own time, never landing as needs-attention; a take-back delivered
> after the stamp clears it; no client role can write the new column or run the
> sweep, proved by a hand-crafted request; `backfill_prepared_history()` is
> retired; and the four-role demo walkthrough still walks.

## Why

A customer pays, the food goes out, and the biller forgets to tick **Prepared**
because the night is over and they are closing up. The order then sits on the
rail — the counter's list of unfinished orders — and it stays there, because the
rail does not filter by day and only the tablet that took an order may ever tick
it. Order 35 at Kalyani is the worked example: paid ₹180 at 22:05 on 17 September,
never ticked, its tablet unused on the 18th, and cleared on the 19th only by
running `backfill_prepared_history()` from a laptop over a direct database
connection.

That is a nuisance on the counter today. It becomes a real fault the moment a
kitchen screen exists, because the kitchen screen is a filtered copy of the same
rail (`the-kitchen-sees-its-orders`, the change this one unblocks): a forgotten
tick would greet the cook every morning as an order still to make.

The owner's rule is that a paid order is **eventually** served. Not necessarily
at the moment the day is closed — the food may still be on the grill when someone
presses Finish Day — but by the time the shop has shut. The outlet's business-day
cutover (04:00 at every outlet today) is chosen to sit after the latest close and
before the earliest open, so it is the first moment at which "it must have been
served" is reliably true. That is the moment this change acts on, and no earlier.

Finish Day refuses today while any order is paid and unprepared. The refusal was
added in #55 so that a day was not declared final while a paying customer was
still owed food. Re-examined with the owner, it buys little: Finish Day is rarely
pressed (four confirmations in all of history as of 19 September), the database
already refuses every take-back, cancel-after-paid and tender correction once a
day is finished, and a refusal that makes the biller tick Prepared on food still
cooking would push the order off the kitchen screen before it was served. With
the cutover finishing the order, the refusal becomes a note.

## What Changes

- **At each outlet's cutover, every paid order still unprepared is marked
  prepared.** The time recorded is **the cutover itself** — the one that ends the
  business day its payment belongs to — not the moment the sweep happened to run.
- **The order records who finished it.** Either the counter, by a Prepared tick,
  or the day change. Reprepare clears it with the time. One query answers how
  often the day change had to do it, at which outlet, on which days.
- **Unpaid open orders are not touched.** Unpaid means money is still to be
  collected, and the counter is where that is chased. They stay on the rail as
  they do today, and Finish Day still refuses over them.
- **Finish Day stops refusing over a paid-but-unprepared order.** The readiness
  sheet keeps naming it, as an advisory alongside the existing open-edit-window
  advisory: *1 order is paid but not marked prepared — it will be marked prepared
  at 04:00.* The biller can tick it, keep billing, or finish. Finishing does
  **not** mark it prepared; the order stays on the rail until somebody ticks it
  or the cutover arrives, whichever is first.
- **A tick that was queued offline still counts.** A tablet that ticked Prepared
  at 23:40 with no network and delivered the command at 09:00 the next morning is
  accepted rather than refused as already prepared; the counter's own time and
  attribution replace the day change's stamp, because the counter's record is the
  truer one.
- **The laptop repair goes.** `backfill_prepared_history()` is dropped, together
  with the runbook section that sends an operator to it. The sweep's first run
  finishes whatever historical paid-but-unprepared orders remain, each at its own
  day's cutover, recorded as the day change's.

## Capabilities

### Modified Capabilities

- `order-lifecycle`: preparation gains a second source — the day change — beside
  the counter's command, recorded on the order; a paid order unprepared at its
  payment day's cutover is finished by it; a late counter tick supersedes it; an
  unwind clears it.
- `counter-billing`: Finish Day's paid-but-unprepared refusal becomes an advisory
  that names the cutover.

## Non-goals

- **No change to unpaid open orders.** They remain blockers, on the rail and at
  Finish Day.
- **No change to the edit window.** It is still five minutes from the later of
  payment and preparation; the day change's stamp is simply a preparation time,
  and the window it implies has passed long before any shift could use it.
- **No new authority.** Nobody gains a command. No client role may set or clear
  the day change's stamp; only the scheduled sweep and the counter's own prepare
  and unwind commands touch it.
- **No automatic Finish Day.** The day itself is still closed by a person, or not
  at all, exactly as now.
- **No retroactive tracking.** Orders finished by the laptop repair before this
  change were stamped `prepared_at = paid_at` with nothing to tell them apart from
  a real tick, and are recorded as the counter's. Counting starts at deploy.
- **No kitchen screen.** That is `the-kitchen-sees-its-orders`, which depends on
  this change.

## Docs To Update Before Archive

- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — `orders.prepared_source`
  beside `prepared_at`, and the cutover sweep as the second way an order is
  prepared.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the Finish Day blockers
  paragraph: food owed on a paid order moves from blocker to advisory.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md) — delete the *Finish Day
  refuses and names an order that is paid but not prepared* entry and its
  `backfill_prepared_history()` follow-up; add the query that counts orders the
  day change finished, and what to check if the sweep stops running.
- [`docs/OFFLINE_AND_SYNC.md`](../../../docs/OFFLINE_AND_SYNC.md) — a queued
  Prepared tick delivered after the cutover is accepted and supersedes the stamp.
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — the scheduled jobs
  the database runs, now two.
- [`docs/GLOSSARY.md`](../../../docs/GLOSSARY.md) — *Order* gains the day change
  as a way it is finished.
