# Proposal: owner-console-live

> **Model**: Opus · **Wave**: E · **Depends on**: #8, #10, #11, #12 · **Gate**: both P&L modes compute on real data and **a test proves raw materials are not double-counted**; revenue follows original order business date while drawer/payment reports follow payment business date; the owner compares two real outlets over a period; the outlet switcher never leaks a third outlet's data; reports reconcile exactly to on-screen figures; a real alert round-trips; surfaces promoted `demo → live`.

**This is a `*-live` change.** Its job is to make the screens from #8 real and promote their gates, not to redesign them.

## Why

The owner's whole view becomes real at once — profit, comparison, reports and alerts are one capability from the owner's side, and each is meaningless without the others. It is also the change that justifies the system for a multi-outlet business and the prerequisite for onboarding franchise number three.

## Scope

**Profit and loss** — outlet-level, for a chosen period, in **two explicit expense modes** per `docs/DATA_MODEL.md`:
- *Purchase basis* (rename the misleading demo label *Cash basis*):
  `revenue − all expenses`. Revenue follows the order's original business date;
  this mode does **not** claim to match drawer movement when an order is paid later.
- *Consumption basis*: `revenue − non-raw-material expenses − inventory consumed`. Does not punish a period for a bulk purchase.

The active expense basis is stated on screen, always. Neither is more correct in
general; silently mixing them is always wrong. A test fails if raw materials are
counted in both places.

**Revenue and payment clocks** — sales/revenue reports group an immutable bill by
the originating order `business_date`, including an order paid after cutoff.
Drawer, payment-method, and cash-movement reports group it by
`payment_business_date`. Reports that span either side expose late-payment and
late-sync flags and reconcile each clock independently rather than forcing one
date to serve both.

**Owner console** — the cross-outlet dashboard, the outlet switcher into a read-only Franchise Admin view, two-outlet comparison over a period, outlet CRUD (including coordinates, geofence radius and business-day cutover), and people management across outlets.

**Reports and export** — period summaries and CSV export for the reports the business actually asks for, not a generic export builder.

**Alerts** — real persistence for raise, respond, and the status transitions.

**A note when the owner records into an outlet's books** — folded in here from
`multi-outlet-people` (#22), because this is the change that makes alerts real
and the machinery would otherwise have to be built twice. Since #22 the owner
records non-cash expenses and stock corrections at outlets they do not run;
those rows are attributed and badged as theirs wherever they are read, which
was judged sufficient at the time (#22 design D8) precisely *because* the alert
surfaces were still demo-gated and a note would have landed where nobody could
open it.

Two things have to change for it, and neither is large once alerts are real:
the `alerts_insert` policy is Franchise-Admin-only today — alerts run outlet →
owner, and this is the first case running the other way — and the
`alert_category` enum has no value for it. The owner asked for it as a
nice-to-have (2026-07-29) on the explicit condition that it rides existing
machinery rather than justifying its own; if it turns out to need more than a
policy branch and an enum value, drop it rather than growing this change.

## Non-goals

- The Super Admin still cannot create bills. Billing is tied to an enrolled device and a shift; letting the owner ring a sale from their phone would corrupt attribution and cash reconciliation.
- **Not accounting.** No depreciation, accruals, proper stock valuation, or tax. See `docs/LIMITATIONS.md`.
- **Aggregator revenue is not in bills at all.** #10 withdrew Swiggy and Zomato as tender methods, so those orders are never rung at the counter and every bill-derived figure here covers cash and UPI only. Whatever this console shows as revenue must say so on screen rather than presenting a partial total as the outlet's takings. Where the aggregator slice is needed, it lives as the manual ledger's typed per-day figure with its own commission rate, already net; reaching it means either #12 carrying those rows into the live cash record first, or this console stating the gap and leaving it. Deciding which is this change's work, and the decision cannot be deferred past the first revenue figure it draws.
- No scheduled or automatically delivered reports, no BI query builder.

## Watch out for

**The outlet switcher is the only surface that deliberately reads across the isolation boundary**, so it is where a tenancy mistake would be least visible. The isolation suite must cover it explicitly: viewing outlet A must never make outlet B's rows reachable.

**Exports leave the system's protection.** Customer phone numbers are excluded by default and included only on an explicit choice. A CSV of customer data in someone's downloads folder is the most likely PII incident this app will ever have.

Reports that disagree with the dashboard destroy trust in both.

The original demo's “Cash basis matches the drawer” wording must not survive.
Once deferred payment exists, purchase timing, revenue timing, and drawer timing
are three separate facts; the renamed mode changes expense treatment only.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/LIMITATIONS.md` (sharpen the accuracy caveats once real numbers are visible), `docs/SECURITY_AND_PRIVACY.md` (export rules).
