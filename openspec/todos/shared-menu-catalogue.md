# Shared Menu Catalogue

**Type**: Feature · **Status**: Anticipated, not scheduled · **Area**: Menu

## Expectation

A brand-wide master menu that outlets inherit from, with per-outlet overrides where they are legitimate. Adding an item once makes it available to every outlet, changing a brand price changes it everywhere, and the brand can see where an outlet has diverged.

## Current behaviour

Each outlet owns its menu entirely. Two outlets selling the same item are two independent rows with independent names, prices and availability. Nothing detects drift between them, and there is no way to change anything brand-wide except by editing each outlet in turn.

## Why it is deferred

For two outlets this is fine, and it keeps isolation simple: the menu is outlet-scoped like every other table, and no query has to reason about inherited rows.

A catalogue introduces **the first entity that deliberately spans outlets**, which is a real complication of a security model built to prevent exactly that. It is worth that complication when menu consistency becomes a brand problem, and not before.

## What already exists for it

- **Bill line items snapshot item name and unit price**, so restructuring the menu never rewrites history. A bill rung under a per-outlet menu stays readable and correct after a catalogue lands.
- Menu items already carry per-outlet price and availability, which is the shape an override needs — the override is a narrowing of what exists, not a new concept.

## Open questions

- **Which fields are inherited and which are overridable?** Price and availability almost certainly overridable. Name and veg status probably not, since those *are* the consistency the catalogue exists to enforce. The business markets lab-tested consistency, so this is a brand decision before an engineering one.
- Where does the catalogue sit in the tenancy model? It is by definition not outlet-scoped, so it needs its own read policy — plausibly readable by any authenticated user, writable only by a Super Admin. That policy needs the same isolation scrutiny as any outlet-scoped table, for the opposite reason.
- Does removing a catalogue item remove it from outlets, or only stop new outlets adopting it?
- Can an outlet still carry items outside the catalogue, or is the catalogue the whole menu? A local special is a normal thing for a franchise to want.
- How do existing outlet menus migrate onto the catalogue without re-entering every item by hand?

## Trigger to promote

Enough franchises that per-outlet menu drift becomes a consistency problem — or, earlier and more concretely, the first time the brand needs to change one price everywhere and finds there is no way to do it.

**Dependencies when seeded**: `billing-live` (#10), `outlet-onboarding` (#14).
