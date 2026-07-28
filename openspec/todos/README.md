# Behavior Backlog

This directory tracks bugs, investigations, and feature ideas **before** they are promoted into formal OpenSpec changes. Nothing here is sequenced, gated, or committed to.

Keep entries behavior-focused:

- Describe the user-visible expectation, the observed behaviour, and the constraint that makes it non-trivial.
- Avoid naming implementation files, functions, or database internals unless they are part of the behaviour contract.
- Never include real customer names, phone numbers, employee data, or production figures. Use synthetic examples.
- When an item is ready to build, graduate it into `openspec/changes/<change-id>/` via `/opsx:propose` and add it to the inventory table in [`../changes/ROADMAP.md`](../changes/ROADMAP.md).

## Items

| Item | Type | Status | Area | Trigger to promote |
| --- | --- | --- | --- | --- |
| [Bill Thermal Printing](./bill-thermal-printing.md) | Feature | Anticipated | Billing | A customer or regulator asks for a printed bill |
| [Bill GST Breakup](./bill-gst-breakup.md) | Feature | Anticipated | Billing | The business registers for GST or a customer requires a tax invoice |
| [Bill Digital Share](./bill-digital-share.md) | Feature | Anticipated | Billing | The owner wants digital receipts, or paper is being skipped anyway |
| [Aggregator Settlement](./aggregator-settlement.md) | Feature | Anticipated | Reporting | Aggregator volume grows enough to distort a decision |
| [Shared Menu Catalogue](./shared-menu-catalogue.md) | Feature | Anticipated | Menu | Per-outlet menu drift becomes a brand consistency problem |
| [Cross-Outlet Customer Identity](./cross-outlet-customer-identity.md) | Feature | **Parked** | Customers | A loyalty feature with real value — and the design question settled first |
| [Audit Log](./audit-log.md) | Feature | Anticipated | Security | The first franchise dispute, or headcount outgrowing "a small trusted team" |
| [Data Retention Policy](./data-retention-policy.md) | Feature | Anticipated | Security | **A quarter of real attendance data in production** — sooner than customer volume |
| [Self-Service Password Reset](./self-service-password-reset.md) | Feature | Anticipated | Auth | Admin-initiated resets become a bottleneck |
| [Signed-In Password Change](./signed-in-password-change.md) | Feature | Deferred by decision | Auth | The shared Profile screen gets built for any reason |
| [Workbox Build-Chain Advisories](./workbox-build-advisories.md) | Investigation | Accepted | Build tooling | A fixed `workbox-build` ships, or an advisory becomes runtime-reachable |
| [Unreachable Backend Blames The Password](./unreachable-backend-blames-the-password.md) | **Defect** | Open | Auth | Anyone signs in on a bad connection — so, any shift |
| [Attendance Gate: Two Clauses Never Walked](./attendance-gate-unwalked-clauses.md) | Verification gap | Accepted at archive | Attendance | The first real staff member checks in at a live outlet |
| [Outlet Deletion: The Populated Refusal Never Walked](./outlet-deletion-refusal-unwalked-in-production.md) | Verification gap | Accepted at archive | Outlets | The first real staff member is added to a live outlet |
| [Two Ways To Draw A Dropdown](./select-primitive-not-adopted-everywhere.md) | Tech debt | Open | Design system | The next change touching Access or Staff, or the first restyle of the control |

The three billing items are grouped deliberately: v1 ships bills as **record-only**, and all three extensions were anticipated in the schema so none of them requires migrating historical bills. See [Limitations](../../docs/LIMITATIONS.md#bills-are-record-only) for exactly which columns exist ahead of need, and why.

Two entries carry a status worth reading before the trigger column:

- **Cross-Outlet Customer Identity is parked on principle, not priority.** It requires reading across the isolation boundary the security model exists to enforce. It stays parked until someone has decided *what* is being unified — the identity, or only the aggregates.
- **Data Retention Policy has a nearer trigger than the roadmap states.** Employee location history begins accumulating the day attendance goes live, which is the sharpest exposure in the system and arrives well before meaningful customer volume.

## Graduated / Absorbed

| Former item | Where it went |
| --- | --- |
| PWA Brand Icons | Absorbed into `project-foundations`. The real mark from the Shawarmania site is committed as `assets/brand/shawarmania-mark-512.png` and the whole icon set is derived from it, so the placeholders it was raised against no longer exist. |
