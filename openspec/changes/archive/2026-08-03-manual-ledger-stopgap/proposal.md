# Proposal: Manual Ledger Stopgap

> **Model**: Opus · **Wave**: D · **Depends on**: #3, #4 · **Gate**: the owner records a full trading day at each outlet from a phone (four revenue channels, cash in and out with reasons, expenses by category, and a counted drawer), then reads that day's cash difference and the month's cash-basis operating profit with its basis named on screen; a large equipment purchase paid from the drawer leaves that day reconciled without entering the month's expenses; a Franchise Admin, Biller and Employee are refused every read and write on both tables by the database, proved by a hand-crafted request; an earlier day's edit does not move any later day's stored opening cash, commission rate or expected cash; and the four-role demo walkthrough still walks.

## Why

Billing (#10), expenses and inventory (#11) and daily cash (#12) are not live, so the business currently has no record of what it sold, what it spent or what was in the drawer. August 2026 is trading now and those numbers cannot be reconstructed later from memory. The owner needs one place to write them down this month so that month-end profit and a daily cash check are answerable, and so the month survives into the real reports once the live surfaces land.

This is a deliberate stopgap with a known end date. It exists because the alternative (a spreadsheet outside the app) turns "merge this into the app later" into a CSV import project, while rows written into Postgres today are already where the live features will look.

## What Changes

- Add one Super Admin surface, `Manual ledger`, reachable only by an owner and absent for every other role.
- Record one day per outlet: revenue split across cash, UPI, Zomato and Swiggy; cash brought into the drawer and cash taken out, each with a reason; the drawer count at close; and a free-text note.
- Record expenses as their own rows: business date, outlet, category, whether cash or non-cash, amount, and a **required free-text description** of what the money was spent on, refused blank by the database.
- Store the Zomato and Swiggy commission rate **on each day's row**, offered when the form opens as the most recent earlier day's rate for that outlet, and editable for any single day without disturbing another.
- Store each day's opening cash on its own row, offered when the form opens as the previous day's counted cash, so correcting an old day never silently rewrites every later day's expected cash.
- Show, for a chosen day: expected cash (`opening + cash revenue + cash in − cash expenses − cash out`) and the difference against the count, with the note beside it.
- Show, for a chosen month and outlet: gross revenue by channel, aggregator revenue net of each day's own commission rate, expenses by category, and estimated profit on **cash basis**, stated in words as a cash-basis operating estimate so nobody reads it as accounting for equipment, as `profit-estimates` already requires of any profit figure.
- Flag, read-only, where a day's stored opening cash disagrees with the previous day's count, so a broken chain is visible instead of absorbed.
- Reject a blank or negative amount, a future business date, and a second row for the same outlet and business date, in the database rather than only in the form.

## Non-goals

- **Any authority that survives this change.** The owner may write cash figures here because no drawer exists yet to corrupt. #12 owns the real cash record and must not inherit this permission; the boundary in `docs/LIMITATIONS.md` stands unchanged.
- Replacing or pre-empting #10, #11 or #12. No per-bill or per-item detail, no menu, no stock or movement ledger, no opening or closing stock valuation.
- Any workflow. No day sign-off, no approval, no correction audit trail, no attention badge, no alert. It is a notebook, and a rare wrong number is retyped.
- Consumption-basis profit. Raw materials are taken as zero on hand at the start of tracking, by owner decision, so only cash basis is computable and only cash basis is offered.
- Capital spending. Equipment, fittings and anything outliving the month are not recorded here at all, by owner decision, and no capital marker exists. The monthly figure is therefore an operating estimate and says so. A capital purchase paid from the drawer is still recorded as cash taken out with its reason, so the daily cash check keeps reconciling.
- GST and deferred payment. Both confirmed absent by the owner on 2026-08-03; no tax column and no receivable list.
- Franchise Admin or manager entry. The owner types both outlets. Widening it later is a small change and deliberately not this one.
- Offline entry. This surface may block on the network like every other non-counter screen.
- Deleting the rows when the surface goes. The change that removes this page carries its rows into the real tables first; that is stated here so it cannot be forgotten, and it belongs to #12 rather than to this change.

## Capabilities

### New Capabilities

- `manual-ledger`: A temporary owner-only record of daily revenue by payment channel, cash drawer movements and counts, and categorised expenses, with per-day commission and opening-cash snapshots, yielding a daily cash difference and a monthly cash-basis profit estimate. Includes its own retirement contract: the capability is removed only by a change that first carries its rows into the live cash and expense records.

### Modified Capabilities

None. `profit-estimates` already requires any profit figure to name its basis, and this surface obeys that requirement rather than changing it. `daily-cash-reconciliation` and `outlet-expenses` keep their requirements untouched; this capability is deliberately parallel to them, not a partial implementation of either.

## Impact

- New Supabase migration adding two owner-only tables with integer-paise money columns, integer basis-point commission columns, explicit `business_date` columns, a uniqueness constraint per outlet and date, non-blank and non-negative check constraints, and RLS restricted to a live Super Admin assignment.
- The outlet-scoped isolation suite, which enumerates tables from the catalog and fails on any it cannot classify, gains cases proving Franchise Admin, Biller and Employee are refused both tables at both outlets.
- New typed adapter with Supabase and mock implementations, mock fixtures typed from generated schema types, one registry entry in the `live` state, one route and navigation entry visible only to a Super Admin, and generated database types regenerated.
- New month and day aggregation logic in integer paise, unit-tested against the two formulas above.
- Before archive, update `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, `docs/OPERATIONS.md`, `docs/LIMITATIONS.md` and `docs/TESTING.md`, and record the retirement obligation in `openspec/changes/daily-cash-live/proposal.md` so #12 inherits it.
