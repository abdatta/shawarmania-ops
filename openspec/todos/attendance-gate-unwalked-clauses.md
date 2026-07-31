# Attendance Gate: Two Clauses Never Walked In Production

**Type**: Verification gap · **Status**: Open, accepted at archive · **Area**: Attendance

## Expectation

Everything `attendance` (#5) claims in its gate has been seen working on real hardware, in production, at least once.

## Current behaviour

Two of the gate's three clauses were archived on the strength of automated tests rather than a production walk, with the owner's agreement on 2026-07-27:

- **An out-of-fence check-in, then settled by a manager's recorded approval.** Never performed outside a fence on a real phone. Restated by #26: the check-in is no longer *blocked* — it records whatever its distance, and what was never walked is the approval that settles it, now carrying the approver's own position and a reason where the rule requires one.
- **An Employee sees only their own records.** Production only ever held one employee, so nothing there could have demonstrated it either way.

The first clause — a real check-in on a phone in production — *was* walked: 5.1 m from a captured fence, `present`, source `phone`, against an outlet the owner created and surveyed. That data was deleted afterwards when production was returned to baseline. (It also included a check-out, which #26 removed from the product entirely, so that half of the walk no longer describes anything.)

## Why this is not simply "untested"

Both clauses are covered where the behaviour actually lives:

- The geofence verdict, the approval rule, the approver's recomputed distance and the frozen evidence are asserted in `supabase/tests/08_geofence.sql` against the real trigger.
- The isolation property is asserted for every outlet-scoped table in `supabase/tests/02_isolation_matrix.sql`, and specifically for an Employee's own attendance in `supabase/tests/09_outlet_and_staff_setup.sql`.
- `e2e/attendance.spec.ts` walks a blocked check-in, a one-tap on-site approval and a reasoned off-site one in a browser, using Playwright's geolocation emulation.

What is missing is the thing emulation cannot supply: a real GPS chip, in a real place, far enough from a real fence, on a phone somebody is holding.

## What would close it

Two things, neither urgent, both cheap once there is real staff:

1. Stand outside the fence of a live outlet, attempt a check-in, watch it say how far out it was and record it anyway — then approve it from a manager account and confirm the approver, their position and their reason are recorded on the row.
2. With two employees at one outlet, confirm from an Employee session that the other's records are not visible.

## Trigger

The first real staff member checks in at a live outlet — at which point (2) becomes free to observe, and (1) is one walk to the end of the street.
