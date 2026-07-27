# Cross-Outlet Customer Identity

**Type**: Feature · **Status**: **Parked deliberately** — not merely unscheduled · **Area**: Customers

## Expectation

A person who visits both outlets is recognised as one customer, so a repeat-visit or loyalty feature sees their whole history rather than a per-outlet fragment.

## Current behaviour

Customers are outlet-scoped. The same phone number at both outlets is two independent records with separate visit counts and spend totals, and neither outlet can see the other's.

## Why it is deferred

**This is the one backlog item parked on principle rather than priority.**

Unifying a customer means reading across the isolation boundary the entire security model exists to enforce — the property that a Franchise Admin provably cannot see another outlet's rows, verified by an isolation suite on every outlet-scoped table. Any cross-outlet identity feature has to carve a deliberate exception into that boundary, and an exception that leaks is a security incident rather than a bug.

The business value currently on offer — a more accurate repeat-customer count — does not come close to justifying it.

## What already exists for it

**Nothing, deliberately.** Customer records carry a phone number, which is what a match would key on, but there is no shared identity table and no cross-outlet read path. None should be added speculatively "so it is ready later": a dormant cross-outlet path is exactly the kind of thing that survives into production unexamined.

## Open questions

The first of these should be settled before a proposal exists at all.

- **What is actually being unified — the identity, or only aggregate statistics?** A shared identity that carries no readable per-outlet detail would satisfy a loyalty feature while leaving the isolation boundary intact. That is very likely the right design, and establishing it up front is the difference between a safe feature and a hole.
- What does an isolation test for this look like? If a franchisee can enumerate the other outlet's customers through a loyalty lookup, the feature has broken the property the system is built on. If that test cannot be written, the design is wrong.
- Is a phone number sufficient as identity? Numbers captured at a busy counter get mistyped, and carriers reassign them over time.
- Does a customer consent to being tracked across outlets — and does a franchisee consent to their customer list contributing to a brand-wide one? The second is a franchise-agreement question, not a product one.

## Trigger to promote

A loyalty or repeat-customer feature with real business value behind it. Even then, the identity-versus-statistics question above gets settled in an `/opsx:explore` session before a change folder is created.

**Dependencies when seeded**: none recorded — the blocker is a design decision, not a prerequisite change. Interacts with [`data-retention-policy`](./data-retention-policy.md), since a brand-wide customer record raises the retention stakes.
