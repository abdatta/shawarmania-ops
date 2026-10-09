# An Offline Sale Keeps Its Price

**Type**: Correctness · **Status**: Open, recorded 2026-10-09 by `an-edit-keeps-its-captured-lines`, left for later at the owner's direction · **Area**: Counter billing / Offline

## Expectation

A sale the counter rang while offline is recorded at the price the counter charged,
even if the owner changed that price before the tablet reconnected. Money taken at
the counter always ends up on a bill.

`menu-management` already says so: *A price changed elsewhere during the outage*
requires lines created from the persisted menu to keep their captured name, price
and discount after the tablet reconnects to the change. Today the server refuses
them, so this is a gap against an existing requirement, not a new one.

## Current behaviour

The server checks a line it already stores by identity and keeps its captured
price, but checks a **new** line against the menu as it stands when the command
arrives, and refuses a mismatch as terminal. Editing a saved order after a price
change works, because the counter sends each stored line back under its own
identity (`an-edit-keeps-its-captured-lines`). A sale rung offline has no stored
line to compare, so:

- a **new order** rung offline at the old price is refused when it is delivered,
  and every edit queued behind it is refused with it;
- a **direct sale** (paid now) rung offline at the old price is refused too, and
  its money was already taken. The command sits in **Needs attention** on its
  tablet, and discarding it would drop the only record of a real sale.

The same holds for a packaging line against the outlet's packaging charge.

Example: Classic is ₹139 on the tablet's persisted menu. The tablet goes offline
and sells one, paid in cash. Meanwhile the owner sets Classic to ₹149. The
tablet reconnects; the sale is refused, ₹139 is in the drawer and no bill says why.

## Why it is not trivial

The rule exists to stop a tablet inventing prices, and the server cannot tell an
old price from a wrong one: it keeps no history of what an item cost when. Any fix
decides how far the server trusts a price the tablet says it was showing, and it
touches money, the offline queue and the command boundary together, so it needs a
migration and the full gate set.

Directions noticed, none chosen:

- **Price history.** Record each price an item has had and from when; accept a new
  line whose price was the item's price at the command's creation time. The
  command's time is the tablet's own claim, already bounded by its shift.
- **The menu read the tablet sold from.** The command names the menu snapshot it
  was rung under, and the server accepts that snapshot's prices.
- **Accept and flag.** Record the sale at the tablet's price and put it in front
  of the owner to review, rather than refuse money that was already taken.
- **Recover at the counter.** Keep the refusal, but give the biller a way to
  re-ring the refused direct sale at today's price with the original tender. This
  changes what a biller sees, so it is the owner's call.

## Trigger to promote

The first refused offline sale in production, or the owner planning a price
change while a counter may be offline.
