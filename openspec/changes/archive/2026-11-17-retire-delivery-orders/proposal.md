# Proposal: retire-delivery-orders

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-12 when
> `delivery-orders-are-made-not-billed` (#83) was archived.

## Why

The `delivery-orders` gate (code `DO`, `retireBy` 2027-02-28) has done its job.
It was turned on in production at 11:15 IST on 2 November 2026 and has stayed
on: `change_gate_events` holds that one turn and nothing since. Kalyani Cafe has
offered Delivery since, and by 12 November had made 82 delivery orders, handed
over 78 and taken back 2. **It was never pulled**; under the owner's rule of 30
October that holds nothing, but the code half waits for the owner's "happy to
retire it". Its off path — every order billed or cancelled, labels dropped as an
order leaves the rail, no Counter · Delivery switch — is now dead code with a
switch on it.

Nothing depends on it.

## What changes

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`), both halves.

- **Code.** Every toggle point keeps its on branch: the composer's Delivery, the
  rail's handover and take-back, kept labels, the kitchen's *Delivery* ticket,
  and the Counter · Delivery switch on Stats, Billing History, Items and Sales.
  The key moves to `RETIRED_CHANGE_GATES`; its round trip is `tested`, so the
  `@cg-round-trip:delivery-orders` specs are deleted, not untagged; its off
  tests go and the demo's gate copy goes. Counter and kitchen runtime, so the
  full local gate set.
- **Database later.** After every registered device runs the retirement build
  and the counter has traded three services on it, a contract migration
  (`-- release: contract delivery-orders`) rewrites every database reader of the
  key to its on branch and retires the row. Find them with the reader query
  first: the order commands and the label trigger are the likely ones.

## Change gate

No gate: a retirement keeps the behaviour already on.
