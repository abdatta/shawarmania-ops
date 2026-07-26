# Proposal: data-model-and-tenancy

> **Model**: Fable · **Wave**: A — **the schema keystone** · **Depends on**: #1 · **Gate**: isolation suite passes for **every** outlet-scoped table; a Franchise Admin session provably cannot read the other outlet's rows even with a hand-crafted request; Kalyani and Kanchrapara seeded; TypeScript types generated.

## Why

This is the system's write contract. Every table, policy and query ever written inherits it, and a mistake here is a security incident rather than a bug — a franchisee reading another outlet's numbers is the exact failure this architecture exists to prevent.

It stays a change of its own at every level of consolidation. Nothing downstream should be built against a schema that might still move, and the mocks that the entire UI programme depends on are typed from what this change generates.

## Scope

- The full schema from `docs/DATA_MODEL.md`: outlets, profiles, counter devices, menu, bills, inventory, expenses, employees, attendance, daily cash, alerts.
- Postgres enums for every constrained value, so an invalid value is a constraint violation rather than a bad row.
- **Row-Level Security policies on every outlet-scoped table**, written in the same migration as the table.
- The custom access-token hook injecting `app_role` and `app_outlet_id`, avoiding the RLS recursion trap documented in `docs/ARCHITECTURE.md`.
- Generated TypeScript types — the contract every mock in the UI programme is typed against.
- **The isolation test suite**, structured to enumerate tables from the schema and fail on any that is uncovered, so a forgotten policy is caught rather than discovered.
- Synthetic seed data covering both real outlets and the real menu.

## Non-goals

- No UI, no auth flows (#4). This change establishes what auth will enforce.
- No business logic beyond constraints and the derived-quantity trigger.

## Design questions to settle during `/opsx:propose`

- Where derived figures are snapshotted versus recomputed, and how that distinction is enforced at the schema level rather than by convention.
- Whether `current_quantity` is trigger-maintained or a view, given the movements ledger is the truth.
- How per-outlet bill-number sequences are allocated without a lock that hurts under concurrent settlement.
- Whether `profiles` and `employees` should ever merge. They are deliberately separate — an employee can exist without an app login — and the seam should be examined once rather than argued repeatedly.

## Docs to update before archiving

`docs/DATA_MODEL.md` — replace the design note with the shipped schema, and record any divergence from what was designed, with the reason.
