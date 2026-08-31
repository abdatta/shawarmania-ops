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
| [Supply Bills Paid Outside The Payout](./supply-bills-paid-outside-the-payout.md) | Feature | Owner asked to explore, 2026-08-18 | Outlet expenses | The owner asks in earnest and picks a route: supplier portal, invoice email, or bank statement |
| [Aggregator Settlement](./aggregator-settlement.md) | Feature | Anticipated | Reporting | Aggregator volume grows enough to distort a decision |
| [Swiggy Detail Calls Must Stay Bounded As Open-Cycle Order Volume Grows](./swiggy-open-cycle-detail-call-scaling.md) | Scaling risk | Watch after #47 | Aggregator sync | The reader approaches its time budget or receives throttling, or open-cycle detail reads become materially expensive |
| [Shared Menu Catalogue](./shared-menu-catalogue.md) | Feature | Anticipated | Menu | Per-outlet menu drift becomes a brand consistency problem |
| [Customer Loyalty And Cross-Outlet Insights](./customer-loyalty-and-cross-outlet-insights.md) | Feature | Anticipated | Customers | A concrete loyalty or repeat-customer decision needs activity across outlets |
| [Audit Log](./audit-log.md) | Feature | Anticipated | Security | The first franchise dispute, or headcount outgrowing "a small trusted team" |
| [Data Retention Policy](./data-retention-policy.md) | Feature | Anticipated | Security | **A quarter of real attendance data in production** — sooner than customer volume |
| [Self-Service Account Settings](./self-service-account-settings.md) | Feature | Deferred by decision | Auth | The shared Profile/Settings surface is built or the first real request arrives |
| [Super Admin Email Recovery](./super-admin-email-recovery.md) | Feature | Deferred by decision | Auth | Core live operations are complete, repeated owner lockouts make admin-issued reset painful, or future MFA needs security mail |
| [`test:rls` Is Not Independent Of Reruns](./rls-suite-not-independent-of-reruns.md) | Verification gap | Open | Testing | A repeated local run wastes time or one clean run approaches the shared rate bound |
| [A Tablet Setup That Fails At The Last Step Takes The Outlet's Slot](./tablet-setup-consumes-its-slot-before-it-is-proven.md) | Verification gap | Deferred by decision | Counter | `multiple-billing-devices` (#35), which reshapes the same index — or sooner if a setup actually fails this way |
| [Emergency Billing Continuity](./emergency-billing-continuity.md) | Feature | Deferred by decision | Billing | A registered device is actually lost/unusable, or the owner explicitly accepts a personal-device break-glass authority path |
| [Rostering And Weekly Offs](./rostering-and-weekly-offs.md) | Feature | Anticipated | Attendance | Somebody asks why the figures show absences on days off, manual leave-marking stops being kept up, or an outlet genuinely runs two shifts |
| [Pending Approval Notification](./pending-approval-notification.md) | Feature | Anticipated | Attendance | The first waiting day that survives its own business date and is noticed by somebody other than the manager |
| [Navigation Outgrows A Flat List](./navigation-outgrows-a-flat-list.md) | Design gap | **Triggered** | Shell | `cash-is-counted-not-closed` (#11) promotes Cash drawer and leaves the manual Ledger reachable, so the owner and manager shells carry two ledger-shaped entries during the overlap. The owner has said grouping is a separate change; this is it |
| [Inventory Is Shelved](./inventory-is-shelved.md) | Scope decision | **Closed by decision** | Inventory | Nothing. Reopens only if stock runs out mid-service often enough to want a warning, the owner wants food cost as consumption rather than purchase, or a third outlet makes central purchasing worth tracking |
| [Attendance Gate: Two Clauses Never Walked](./attendance-gate-unwalked-clauses.md) | Verification gap | Accepted at archive | Attendance | The first real staff member checks in at a live outlet |
| [Outlet Deletion: The Populated Refusal Never Walked](./outlet-deletion-refusal-unwalked-in-production.md) | Verification gap | Accepted at archive | Outlets | The first real staff member is added to a live outlet |
| [On The First Of A Month, The Demo's Ranges Open Empty](./month-boundary-empties-fixture-ranges.md) | Demo-data weakness | Open | Demo data | A demo walked on the 1st or 2nd, or the next range-based surface |
| [Page Headers Reserve Their Own Space](./page-headers-reserve-their-own-space.md) | Defect | Found, not scheduled | Design system | The next change touching `PageHeader`, or a demo where the stock ledger's header jump is noticed |
| [A Freshly Added Row Should Come Into View And Say So](./reveal-what-was-just-added.md) | Feature | Open | Design system | Any time — `billing-live` (#10) builds the primitive for the menu editor, and this is it reaching the other six add flows |
| [Expense Payment Method Inherits The Bill Enum](./expense-payment-method-inherits-the-bill-enum.md) | Design gap | **Closed 31 Aug 2026, resolved** | Expenses | `retire-the-manual-ledger` (#12) dropped the empty table that carried the inherited enum and promoted the live record, which has always used a plain boolean. Reopens only if a payment-method enum returns to an expense row |
| [The Demo Month Reads As A Loss](./the-demo-month-reads-as-a-loss.md) | Fixture gap | **Mostly superseded** | Demo mode / Reporting | The P&L it was about is deleted by #51, so the figure stops existing rather than gets fixed. What survives: the demo's expenses cover a notebook month while its bills cover a few days, and the Ledger's monthly view reads the same fixtures |
| [Raw Materials Is Identified By A Word Nobody Types](./raw-materials-is-identified-by-a-word-nobody-types.md) | Design gap | **Closed 31 Aug 2026, dissolved** | Reporting | Nothing to do. `retire-the-manual-ledger` (#12) withdrew the consumption basis, so the matcher has nothing left to feed. Returns only with inventory |
| [A Deploy Could Announce Itself Instead Of Being Polled](./a-deploy-could-announce-itself-instead-of-being-polled.md) | Feature | Deferred by decision | Deployment | A published fix needs to reach an idle device faster than the current interval, or the release pipeline records versions for another reason |
| [The Pipeline Rename Left Two Sentences Behind](./pipeline-rename-left-two-sentences-behind.md) | Design gap | Open | Counter billing / Shell | **Already scheduled**: `extended-offline-billing` (#34) task 3.5 takes the `app-shell` half, `multiple-billing-devices` (#35) task 3.6 takes the `counter-billing` half; whichever runs last closes it |
| [A Near-Miss Category Should Be Caught In Expenses Too](./near-miss-category-matching-reaches-expenses.md) | Feature | Open | Expenses | The first duplicate spelling that actually costs somebody something. Deliberately not bundled with #12's rename, which landed 31 Aug 2026 without touching matching |
| [The Ledger Handover Still Has To Be Done, Outlet By Outlet](./ledger-handover-per-outlet.md) | Operational rollout | **Closed 31 Aug 2026, as unnecessary** | Billing / Ledger | **Never performed, and never will be.** A handover moves an outlet from one of two records to the other; `retire-the-manual-ledger` (#12) removed the second record and dropped `billing_live_from` with it |
| [Outlet Alerts Was Withdrawn](./outlet-alerts-was-withdrawn.md) | Withdrawn plan | **Closed unless triggered** | Operations | A third outlet with a non-owner franchisee, or an outlet issue is lost and somebody asks where it went |
| [The Owner Console Was Withdrawn](./owner-console-was-withdrawn.md) | Withdrawn plan | **Closed unless triggered** | Insight | The owner needs a stated-basis period profit figure that the Ledger cannot answer, or aggregator settlement needs a net figure |

The three billing items are grouped deliberately: v1 ships bills as **record-only**, and all three extensions were anticipated in the schema so none of them requires migrating historical bills. See [Limitations](../../docs/LIMITATIONS.md#bills-are-record-only) for exactly which columns exist ahead of need, and why.

**One entry was never a backlog item at all.** *The Ledger Handover Still Has To Be Done* was work already owed rather than an idea awaiting a trigger: `billing-live` (#10) built every part of it and closed without performing it, by the owner's decision on 12 Aug 2026. It sat in this table because an unlisted obligation is lost work — the rule this index exists to hold. It closed on 31 Aug 2026 without being performed, because `retire-the-manual-ledger` (#12) removed the record it would have handed over from. It stays listed, closed, for the same reason it was listed open: a quietly deleted obligation reads exactly like one that was met.

Two entries carry a status worth reading before the trigger column:

- **Data Retention Policy has a nearer trigger than the roadmap states.** Employee location history begins accumulating the day attendance goes live, which is the sharpest exposure in the system and arrives well before meaningful customer volume. It now accrues about the approving manager too, not only about staff (#26).
- **The two attendance items above are both costs #26 took deliberately**, not oversights: a day off reads as absent because nothing knows a roster, and a forgotten approval surfaces only as a count on a screen because there is no notification channel in the app to put it through. Each is recorded with what already exists for it, so promoting one is narrowing a function rather than starting a design.

## Owner Feedback — Kalyani Counter, 12 Aug 2026

Seven items the owner noticed while setting up billing at Kalyani on 12 Aug 2026 are kept out of the Items table above deliberately. Two remain ungraduated and are ranked smallest-to-largest against each other on [the feedback page](./2026-08-12-owner-feedback.md); the other five remain on that page with their current graduated status. They are linked from here because an unlisted note is lost work — the rule this index exists to hold — and not because they have been weighed against the items above yet.

- [The App Asks for a Code Before Checking If the Person Is Even Allowed](./code-request-before-eligibility-check.md) — Counter / Billing
- [Marking a Bill "Paid" Removes It From the Kitchen List Too Soon](./paid-removes-order-from-kitchen-too-soon.md) — Billing

The five graduated owner-feedback items are recorded with their current status on the feedback page and in the table below.

## Graduated / Absorbed

| Former item | Where it went |
| --- | --- |
| The Owner Can't See the Real Billing Counter From Home | Split in two on 12 Aug 2026, the day it was raised. **Seeing how a counter is doing** went into `billing-live` (#10, §8): the Tablets card reports the live shift, who holds it and that shift's effective figures, scoped by the reader's own outlets and stated as of one reading — delivered. **Opening the biller's own screen, and practising on a copy of it** was seeded as `counter-seen-and-practised` (#39) and **dropped on 14 Aug 2026 by owner decision**; the change folder and its roadmap row are deleted and the number is retired, not reused. See [item 7 on the feedback page](./2026-08-12-owner-feedback.md) for what was dropped and the one observation that outlives it. |
| PWA Brand Icons | Absorbed into `project-foundations`. The real mark from the Shawarmania site is committed as `assets/brand/shawarmania-mark-512.png` and the whole icon set is derived from it, so the placeholders it was raised against no longer exist. |
| Role Grants: One Login, Many Hats | Graduated into `multi-outlet-people` (#22) on 2026-07-29 — the trigger fired on both counts at once: a staffer splitting shifts across the outlets, and the owner day-running one. The same day the owner simplified the design: plain per-outlet **assignments** checked by membership, no session hats or switching. One login per person and no role hierarchy stay rejected exactly as recorded here. |
| Owner Break-Glass Writes | Folded into `multi-outlet-people` (#22) by owner decision on 2026-07-29 — the two todos were one feature seen from two ends. The boundary carries over intact: non-cash only, always visibly the owner's, the drawer stays the Franchise Admin's alone. |
| The "Awaiting Activation" Label Lies; Promoting a Staff Member Can Accidentally Lock Them Out | Graduated together into [`account-lifecycle-truth-and-safe-transitions`](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md) (#40) on 12 Aug 2026. The change makes account state truthful, distinguishes setup from reset, and replaces separate assignment primitives with safe, atomic role and outlet transitions. |
| You Can't Click Your Way to the Counter Setup Page; Let Me Drag to Resize the Last Two Counter Columns | Completed in [`counter-access-and-workspace-layout`](../changes/counter-access-and-workspace-layout/proposal.md) (commit `c04fd5b`). It adds a reachable tablet-setup path and independently persisted counter-panel resizing; the Shift tab remains deliberately hidden because the live counter already exposes shift activity. The change is complete and awaiting roadmap reconciliation/archive. |
| Two Ways To Draw A Dropdown | Completed by `staff-as-accounts` (#21): the People surface adopted the `Select` primitive and the roster surface was deleted, so the primitive is now the only `<select>` in the app. |
| Self-Service Password Reset | The admin-issued reset baseline is completed by `username-sign-in-and-owner-recovery` (#24) for every role. Automated email recovery was deliberately deferred into [Super Admin Email Recovery](./super-admin-email-recovery.md). |
| Cross-Outlet Customer Identity | The identity half graduated into [`global-customer-identity`](../specs/global-customer-identity/spec.md) (#32) during Billing V1 design and was archived 2026-08-02. One normalized phone identifies a minimal global customer; exact full-phone lookup is non-enumerable and outlet bill/order history remains isolated. Loyalty and cross-outlet activity remain in [Customer Loyalty And Cross-Outlet Insights](./customer-loyalty-and-cross-outlet-insights.md). |
| Unreachable Backend Blames The Password | Graduated into [`unreachable-backend-sign-in-error`](../changes/unreachable-backend-sign-in-error/proposal.md) (#30) as a prerequisite for online daily counter reauthentication. |
| Workbox Build-Chain Advisories | Graduated into [`refresh-build-chain-advisories`](../changes/archive/2026-08-11-refresh-build-chain-advisories/proposal.md), which moved every fixable high-severity transitive dependency to its compatible patch and restored a zero-vulnerability audit baseline. |
| The Specs README Index Has Drifted | Graduated into [`keep-spec-index-in-sync`](../changes/archive/2026-08-11-keep-spec-index-in-sync/proposal.md), which reconciled all current capabilities and added a bidirectional checker to normal lint and the prose tier. |
| An Unknown Command Argument May Vanish On The Wire | Graduated into [`audit-rpc-command-arguments`](../changes/archive/2026-08-11-audit-rpc-command-arguments/proposal.md), whose full production audit found no additional unsafe caller and made serialized-null plus real-transport evidence a standing command-family requirement. |
