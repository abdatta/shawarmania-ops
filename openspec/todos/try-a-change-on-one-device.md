# Try a change on one device

**Trigger:** the first release the owner wants to see on real orders before the
staff do.

## The expectation

From a change gate's page, the owner picks one tablet (or their own account)
and only that device runs the change, at its next free moment, while every other
device keeps the old behaviour. The device shows a marker nobody can dismiss,
the gate's page lists it, and it goes back to the business-wide answer by itself
at the business-day cutover.

## Why not a query parameter

Asked for on 2026-10-12 and set aside the same day. Anyone can type a query
parameter, a biller at the counter included; the changes worth trying run on
tablets, which are not signed in as the owner; and a switch that survives a
reload ends up stuck on a tablet nobody remembers.

## The shape agreed

Server-side, owner-only and per device: a small table of device answers that
expire, with its own isolation test, read as an override of the business answer
until it expires. A spare tablet set up as a second counter at the outlet is
where it would be used. Additive to the change gates as they are, so it follows
their own rules.
