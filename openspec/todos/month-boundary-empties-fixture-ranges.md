# On the first of a month, the demo's ranges open empty

**Type**: Demo-data weakness · **Status**: Open · **Area**: Demo data

## The product behaviour is deliberate, and is not the subject here

The by-person attendance view and an employee's own history default to **the
current month**, and they keep that default even when the month is empty (owner,
2026-08-01). On the 1st of a month there genuinely are no days yet; the screen
names the month it is showing and the arrows reach the previous one, so an empty
range is the honest answer rather than a fault. Nothing about that should change.

## What is actually weak

**The demo's fixtures**, not the surfaces. Every attendance fixture is authored
as *business days back from today*, so the pattern always looks recent whenever
somebody opens the demo — except across a month boundary, when it lands almost
entirely in the previous month while the view opens on the current one.

So a demonstrator opening the by-person axis on the 1st or 2nd sees an empty
range on the one screen whose whole purpose is to show a pattern. The documented
walkthrough says *"By person then shows one staff member's month with the
counts"*, and on those two days it does not, through no fault of the code.

The day axis is unaffected: today is always today.

## What was already done

`owner-reaches-every-outlet` (#28) hit this on 2026-08-01 and fixed the
**tests**, which is where the fix belonged: the two Vitest scopes and the two
Playwright specs that read a range now pin `Date` to a mid-month instant, with
the reason written at each pin. Playwright's `page.clock.setFixedTime` pins the
clock without stopping timers. Tests own their clock; the product was left alone.

## Options when it is picked up

- **Anchor the fixtures to a fixed date** and pin the demo's clock, so the demo
  is identical every time it is opened. Costs a demo whose dates are visibly
  historical, which for a sales tool may be a fair price.
- **Make the offsets month-aware**, so the pattern always lands inside the
  current month. Keeps "recent" and removes the edge, at the cost of a fixture
  generator that is harder to read than a list of offsets.
- **Leave it and say so in the walkthrough** — on the 1st, open the previous
  month before showing the by-person axis. Free, and one more thing for a
  demonstrator to remember.

## Trigger to promote

A demo walked on the first or second of a month, or the next change that adds a
range-based surface and finds itself pinning a clock to test it.
