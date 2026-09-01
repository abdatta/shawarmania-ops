# Outlet Scope From The Address

**Area:** App shell / Outlet-scoped surfaces · **Raised:** 1 Sept 2026 ·
**Type:** Generalisation of something already done narrowly

## What is true today

An outlet-scoped surface picks its outlet **on the surface**, from a chip row or
a dropdown, and remembers the choice for the next surface. That is deliberate
and it stays: the person reading the Ledger at one shop usually wants the Drawer
at the same shop, and being asked twice would be worse than being asked once.

**One surface now also accepts the outlet in its address.**
`navigation-groups-and-surface-cull` (#51) gave Tablets a per-outlet route, so
that opening it from an outlet's card lands on that counter rather than on
whichever one the reader last looked at. Administering *this* tablet cannot mean
administering *a* tablet.

## What is missing

Every other outlet-scoped surface still has no way to say which outlet it means:
the Drawer, the Ledger, Delivery and Expenses all open on what was remembered,
whatever the address says. So there is no link anybody can send that reliably
opens one of them at one shop — *"look at Kanchrapara's drawer for the 3rd"* has
to be said in words and followed by hand.

## Why it was not done as part of #51

It would change **arrival behaviour on four live surfaces** in a change about
navigation, and each one has to answer the same question separately: what does
it mean when a remembered outlet and an address disagree? A link is a visit and
a remembered choice is a preference, so the address should win for the visit and
not be written back over the preference — but that is a decision worth taking
per surface, with the person who reads them, rather than assumed once.

Doing it for Tablets alone kept the blast radius to a surface the same change
was already rebuilding the door to.

## The shape it would take

- Each outlet-scoped surface accepts an outlet in its address, as a route
  parameter rather than a query string — a route survives a link being tidied,
  and the router asserts it.
- Arriving with one opens on it and does **not** overwrite what was remembered.
- An outlet the reader cannot see is dropped by the check that already drops a
  stale remembered one. **The address is a starting position, never a grant**:
  the database still decides what may be read.

## Trigger to promote

Somebody wants to send a link to one shop's figures — most likely the owner to a
manager, or a manager to the owner while asking about a specific evening.

## What it must not become

An outlet in the address is not authority. Nothing here may widen what a session
can read, and the picker must keep showing what the reader may reach rather than
being replaced by the parameter.
