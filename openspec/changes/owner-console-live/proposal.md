# Proposal: owner-console-live

> **Model**: Opus · **Wave**: E · **Depends on**: #8, #10, #11, #12 · **Gate**: both P&L modes compute on real data and **a test proves raw materials are not double-counted**; the owner compares two real outlets over a period; the outlet switcher never leaks a third outlet's data; reports reconcile exactly to on-screen figures; a real alert round-trips; surfaces promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the screens from #8 real and promote their gates, not to redesign them.

## Why

The owner's whole view becomes real at once — profit, comparison, reports and alerts are one capability from the owner's side, and each is meaningless without the others. It is also the change that justifies the system for a multi-outlet business and the prerequisite for onboarding franchise number three.

## Scope

**Profit and loss** — outlet-level, for a chosen period, in **two explicit modes** per `docs/DATA_MODEL.md`:
- *Cash basis*: `sales − all expenses`. Matches the drawer.
- *Consumption basis*: `sales − non-raw-material expenses − inventory consumed`. Does not punish a period for a bulk purchase.

The active basis is stated on screen, always. Neither is more correct in general; silently mixing them is always wrong. A test fails if raw materials are counted in both places.

**Owner console** — the cross-outlet dashboard, the outlet switcher into a read-only Franchise Admin view, two-outlet comparison over a period, outlet CRUD (including coordinates, geofence radius and business-day cutover), and people management across outlets.

**Reports and export** — period summaries and CSV export for the reports the business actually asks for, not a generic export builder.

**Alerts** — real persistence for raise, respond, and the status transitions.

## Non-goals

- The Super Admin still cannot create bills. Billing is tied to an enrolled device and a shift; letting the owner ring a sale from their phone would corrupt attribution and cash reconciliation.
- **Not accounting.** No depreciation, accruals, proper stock valuation, or tax. See `docs/LIMITATIONS.md`.
- No aggregator commission modelling. Swiggy and Zomato revenue is recorded at order value, which makes it the largest known inaccuracy here; name it on screen rather than absorbing it silently.
- No scheduled or emailed reports, no BI query builder.

## Watch out for

**The outlet switcher is the only surface that deliberately reads across the isolation boundary**, so it is where a tenancy mistake would be least visible. The isolation suite must cover it explicitly: viewing outlet A must never make outlet B's rows reachable.

**Exports leave the system's protection.** Customer phone numbers are excluded by default and included only on an explicit choice. A CSV of customer data in someone's downloads folder is the most likely PII incident this app will ever have.

Reports that disagree with the dashboard destroy trust in both.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/LIMITATIONS.md` (sharpen the accuracy caveats once real numbers are visible), `docs/SECURITY_AND_PRIVACY.md` (export rules).
