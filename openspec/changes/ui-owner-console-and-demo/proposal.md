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

**Handing the demo over** — the demo stops advertising itself and becomes something the owner distributes. "View the demo" leaves the public landing card, and the Super Admin's account menu gains the demo entry with a **copy-link** action beside it, so the one person who pitches franchisees can produce the URL without typing it from memory. What changes is who *finds* the link, not who may open it: the demo stays unauthenticated, because a shared link that demanded a login would not be a demo. It copies `/demo` rather than a role path — the banner's role switcher is right there, and a recipient should not be pinned to whichever role the owner happened to be looking at.

Franchise Admins do not get it yet. That is a decision to revisit when somebody asks rather than an oversight: a manager showing the demo to a walk-in lead is plausible enough, and no harm follows from it since the link is public either way — but there is no reason to widen an affordance ahead of wanting it.

## Non-goals

- No real figures, no export files, no outlet or user CRUD — #13. Creating an outlet is meaningless against mocks.
- No real-time chat, attachments, or push notifications.

## Watch out for

**Mock figures must never be presentable as real trading data.** The non-dismissible demo indicator from #3 exists for exactly this reason, and it protects the business more than the viewer — a screenshot of invented revenue circulating as fact is a genuine problem in a franchise sales conversation. Use obviously synthetic names and numbers. The two real outlets and the real menu are fine, being public business facts; no real staff or customers.

The P&L basis toggle is not a formatting choice. Even in demo, the screen must state which basis is shown.

**The owner's own demo link must still hit the interstitial.** Following it while signed in lands on the "you are signed in — this is the demo" gate from #3, and that must not be special-cased into a smoother path for the person who owns the menu it now sits in. The gate exists because someone ringing up fake bills in a tab they thought was real would be a genuine operational problem, and an owner is no less capable of losing track of a tab than a biller is. It will read as a papercut to whoever meets it next; it is the rail working.

**Removing the landing link makes the demo undiscoverable to everyone else**, which is the point, but it means the walkthrough's own instructions become the only route in for anyone who is not the owner. The documented route has to open with where the link comes from, or the first person asked to run a demo will not be able to start one.

## Docs to update before archiving

`docs/SCREENS.md` (the account menu gains an entry, and it is the first thing in that chrome that is not the same for all four roles), `docs/DEMO_MODE.md` (how to run the walkthrough, extend the scenario, and where the link to share is found).
