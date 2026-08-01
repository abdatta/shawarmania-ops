# Behavior Backlog

This directory tracks bugs, investigations, and feature ideas **before** they are promoted into formal OpenSpec changes. Nothing here is sequenced, gated, or committed to.

Keep entries behavior-focused:

- Describe the user-visible expectation, the observed behaviour, and the constraint that makes it non-trivial.
- Avoid naming implementation files, functions, or database internals unless they are part of the behaviour contract.
- Never include real customer names, phone numbers, employee data, or production figures. Use synthetic examples.
- When an item is ready to build, graduate it into `openspec/changes/<change-id>/` via `/opsx:propose` and add it to the inventory table in [`../changes/ROADMAP.md`](../changes/ROADMAP.md), inserted at its correct position in the table's topological (dependency) order — not appended at the bottom. See the note under "Change Inventory" there.

## Items

| Item | Type | Status | Area | Trigger to promote |
| --- | --- | --- | --- | --- |
| [Bill Thermal Printing](./bill-thermal-printing.md) | Feature | Anticipated | Billing | A customer or regulator asks for a printed bill |
| [Bill GST Breakup](./bill-gst-breakup.md) | Feature | Anticipated | Billing | The business registers for GST or a customer requires a tax invoice |
| [Bill Digital Share](./bill-digital-share.md) | Feature | Anticipated | Billing | The owner wants digital receipts, or paper is being skipped anyway |
| [Aggregator Settlement](./aggregator-settlement.md) | Feature | Anticipated | Reporting | Aggregator volume grows enough to distort a decision |
| [Shared Menu Catalogue](./shared-menu-catalogue.md) | Feature | Anticipated | Menu | Per-outlet menu drift becomes a brand consistency problem |
| [Customer Loyalty And Cross-Outlet Insights](./customer-loyalty-and-cross-outlet-insights.md) | Feature | Anticipated | Customers | A concrete loyalty or repeat-customer decision needs activity across outlets |
| [Audit Log](./audit-log.md) | Feature | Anticipated | Security | The first franchise dispute, or headcount outgrowing "a small trusted team" |
| [Data Retention Policy](./data-retention-policy.md) | Feature | Anticipated | Security | **A quarter of real attendance data in production** — sooner than customer volume |
| [Self-Service Account Settings](./self-service-account-settings.md) | Feature | Deferred by decision | Auth | The shared Profile/Settings surface is built or the first real request arrives |
| [Super Admin Email Recovery](./super-admin-email-recovery.md) | Feature | Deferred by decision | Auth | Core live operations are complete, repeated owner lockouts make admin-issued reset painful, or future MFA needs security mail |
| [Workbox Build-Chain Advisories](./workbox-build-advisories.md) | Investigation | Accepted | Build tooling | A fixed `workbox-build` ships, or an advisory becomes runtime-reachable |
| [`test:rls` Is Not Independent Of Reruns](./rls-suite-not-independent-of-reruns.md) | Verification gap | Open | Testing | A repeated local run wastes time or one clean run approaches the shared rate bound |
| [Emergency Billing Continuity](./emergency-billing-continuity.md) | Feature | Deferred by decision | Billing | A registered device is actually lost/unusable, or the owner explicitly accepts a personal-device break-glass authority path |
| [Rostering And Weekly Offs](./rostering-and-weekly-offs.md) | Feature | Anticipated | Attendance | Somebody asks why the figures show absences on days off, manual leave-marking stops being kept up, or an outlet genuinely runs two shifts |
| [Pending Approval Notification](./pending-approval-notification.md) | Feature | Anticipated | Attendance | The first waiting day that survives its own business date and is noticed by somebody other than the manager |
| [Attendance Gate: Two Clauses Never Walked](./attendance-gate-unwalked-clauses.md) | Verification gap | Accepted at archive | Attendance | The first real staff member checks in at a live outlet |
| [Outlet Deletion: The Populated Refusal Never Walked](./outlet-deletion-refusal-unwalked-in-production.md) | Verification gap | Accepted at archive | Outlets | The first real staff member is added to a live outlet |
| [On The First Of A Month, The Demo's Ranges Open Empty](./month-boundary-empties-fixture-ranges.md) | Demo-data weakness | Open | Demo data | A demo walked on the 1st or 2nd, or the next range-based surface |

The three billing items are grouped deliberately: v1 ships bills as **record-only**, and all three extensions were anticipated in the schema so none of them requires migrating historical bills. See [Limitations](../../docs/LIMITATIONS.md#bills-are-record-only) for exactly which columns exist ahead of need, and why.

Two entries carry a status worth reading before the trigger column:

- **Data Retention Policy has a nearer trigger than the roadmap states.** Employee location history begins accumulating the day attendance goes live, which is the sharpest exposure in the system and arrives well before meaningful customer volume. It now accrues about the approving manager too, not only about staff (#26).
- **The two attendance items above are both costs #26 took deliberately**, not oversights: a day off reads as absent because nothing knows a roster, and a forgotten approval surfaces only as a count on a screen because there is no notification channel in the app to put it through. Each is recorded with what already exists for it, so promoting one is narrowing a function rather than starting a design.

## Graduated / Absorbed

| Former item | Where it went |
| --- | --- |
| PWA Brand Icons | Absorbed into `project-foundations`. The real mark from the Shawarmania site is committed as `assets/brand/shawarmania-mark-512.png` and the whole icon set is derived from it, so the placeholders it was raised against no longer exist. |
| Role Grants: One Login, Many Hats | Graduated into `multi-outlet-people` (#22) on 2026-07-29 — the trigger fired on both counts at once: a staffer splitting shifts across the outlets, and the owner day-running one. The same day the owner simplified the design: plain per-outlet **assignments** checked by membership, no session hats or switching. One login per person and no role hierarchy stay rejected exactly as recorded here. |
| Owner Break-Glass Writes | Folded into `multi-outlet-people` (#22) by owner decision on 2026-07-29 — the two todos were one feature seen from two ends. The boundary carries over intact: non-cash only, always visibly the owner's, the drawer stays the Franchise Admin's alone. |
| Two Ways To Draw A Dropdown | Completed by `staff-as-accounts` (#21): the People surface adopted the `Select` primitive and the roster surface was deleted, so the primitive is now the only `<select>` in the app. |
| Self-Service Password Reset | The admin-issued reset baseline is completed by `username-sign-in-and-owner-recovery` (#24) for every role. Automated email recovery was deliberately deferred into [Super Admin Email Recovery](./super-admin-email-recovery.md). |
| Cross-Outlet Customer Identity | The identity half graduated into [`global-customer-identity`](../changes/global-customer-identity/proposal.md) (#32) during Billing V1 design. One normalized phone identifies a minimal global customer; exact full-phone lookup is non-enumerable and outlet bill/order history remains isolated. Loyalty and cross-outlet activity remain in [Customer Loyalty And Cross-Outlet Insights](./customer-loyalty-and-cross-outlet-insights.md). |
| Unreachable Backend Blames The Password | Graduated into [`unreachable-backend-sign-in-error`](../changes/unreachable-backend-sign-in-error/proposal.md) (#30) as a prerequisite for online daily counter reauthentication. |
