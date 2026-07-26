# Proposal: ui-owner-console-and-demo

> **Model**: Opus · **Wave**: C — **the demo milestone** · **Depends on**: #5, #6, #7 · **Gate**: **a single uninterrupted walkthrough of all four roles** on a deployed URL, with internally consistent mock data — a busy trading day whose bills, stock movements, cash close and alert all reconcile with each other.

## Why

Completes the owner-facing surfaces, then turns every independently-mocked screen into one coherent story.

Each earlier UI change ships plausible fixtures for its own screens, which is enough to review one surface and **not** enough to demonstrate a business. Anyone looking at the owner dashboard and then the billing screen will notice immediately if the numbers do not correspond. This change is where that gets fixed, which is why it owns the demo gate.

**A note on the #5 dependency**: what this change consumes from attendance is its *surfaces and demo fixtures*, not its production rollout. This change may start while #5's only open items are the 🧍 live-verification gates (real staff, a full day of check-ins) — those run on the calendar, not in the codebase.

## Scope

**Owner console** — dashboard showing every outlet side by side (today's sales, cash position, open alerts, anything needing attention), the outlet switcher, two-outlet comparison over a period, and P&L with the cash-basis / consumption-basis toggle. Reports: period summaries and the export action.

**Alerts** — raise with category and priority, the owner's cross-outlet inbox, responses, and the status transitions open → acknowledged → resolved → closed. Small, and it demos beautifully: raise an alert as a Franchise Admin, flip roles, answer it as the owner.

**The scenario dataset** — one internally consistent set spanning every feature for two outlets over a realistic period, where figures actually derive from each other: bills sum to the sales figure, stock movements match what those bills consumed, the cash close reconciles against the cash bills, and the P&L follows from all of it.

**Deliberately interesting states** — a low-stock warning, a cash mismatch at close, an open high-priority alert, a blocked geofence check-in awaiting override, a pending sync backlog. A demo of a system where nothing ever goes wrong demonstrates nothing.

**A guided walkthrough** — a documented route through all four roles, runnable by someone who did not build the product. Plus demo reset, so every walkthrough starts from the same state.

## Non-goals

- No real figures, no export files, no outlet or user CRUD — #13. Creating an outlet is meaningless against mocks.
- No real-time chat, attachments, or push notifications.

## Watch out for

**Mock figures must never be presentable as real trading data.** The non-dismissible demo indicator from #3 exists for exactly this reason, and it protects the business more than the viewer — a screenshot of invented revenue circulating as fact is a genuine problem in a franchise sales conversation. Use obviously synthetic names and numbers. The two real outlets and the real menu are fine, being public business facts; no real staff or customers.

The P&L basis toggle is not a formatting choice. Even in demo, the screen must state which basis is shown.

## Docs to update before archiving

`docs/SCREENS.md`, `docs/DEMO_MODE.md` (how to run the walkthrough and extend the scenario).
