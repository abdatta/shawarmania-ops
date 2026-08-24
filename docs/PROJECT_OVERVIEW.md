# Project Overview

Shawarmania Ops is a multi-outlet cash-counter and outlet-management PWA.

The project exists because Shawarmania has outgrown running two counters on memory and WhatsApp, and is now selling franchises. A franchise business needs two things a notebook cannot give it: **per-outlet data isolation** (a franchisee sees their outlet, not the network) and **comparable numbers** (the owner can put two outlets side by side and trust the comparison).

## What the app does

- **Counter billing** — fast order entry, payment method capture, per-outlet sequential bill numbers, working offline.
- **Menu management** — items, categories, prices, availability, per outlet.
- **Inventory** — stock added, used, wasted, corrected, with low-stock warnings.
- **Expenses** — categorised outlet spending with payment method and who recorded it.
- **People and attendance** — staff as app accounts; an arrival recorded from the person's own phone with its location evidence, counted only once a manager approves it and records where they were themselves; a per-outlet arrival deadline producing late and absent readings; manager-entered attendance when a phone cannot; and attendance readable by day or by person over a range.
- **Daily cash** — opening float, cash sales, cash expenses, withdrawals, expected vs actual closing, and the difference.
- **Profit and loss** — basic outlet-level operational estimates, and cross-outlet comparison for the owner.
- **Alerts** — outlet managers raise issues to the owner and get responses.

## What the app does not do

Deliberately out of scope. Each of these is a real thing a restaurant might want, and each is excluded because including it would slow down the thing the business actually needs first.

- **It is not an accounting system.** Profit and loss here is an operational estimate for running a shop, not a filing-grade financial report. See [Limitations](LIMITATIONS.md) for what that means concretely.
- **It is not a customer-facing ordering app.** Swiggy and Zomato already do delivery; their revenue reaches the ledger through their own evidence, not rung as counter bills and not fulfilled here.
- **It does not do payroll.** No salary is stored anywhere in the system (owner decision, 2026-07-28). Attendance feeds whatever payroll process runs outside the app, and wages actually paid are recorded as expenses like any other cost.
- **Aggregator figures are sourced, not typed.** Zomato revenue, commission and Hyperpure supply costs are read from their operator evidence and reconciled against the payout (#42, #43). Swiggy uses timestamped Finance order detail for a provisional pre-tax daily gross and its payout annexure for final settlement; neither channel can be entered through the ledger. No customer-facing ordering is fulfilled here.
- **It does not print receipts, compute GST, or send digital receipts** — in v1. The data model is built so all three can be added without migrating historical bills. See [Limitations](LIMITATIONS.md).
- **It is not a supplier or purchase-order system.** Stock arriving is a movement and an expense, not a procurement workflow.

## Product principles

**Correctness about money comes first.** This app's core job is knowing how much cash should be in the drawer. Every design choice — integer paise, snapshotted prices, append-only bills, explicit business dates — serves that. Convenience never wins against it.

**The counter never stops.** A biller with a customer waiting cannot be blocked by a spinner. Billing is offline-first, and every counter interaction is designed around a queue that drains later rather than a request that must succeed now.

**Isolation is structural, not procedural.** "Franchise admins shouldn't see other outlets" is enforced by Row-Level Security in Postgres, so it holds even when the frontend has a bug. Isolation you can only violate by writing a new database policy is worth far more than isolation you can violate by forgetting a `WHERE` clause.

**Simple enough for a restaurant employee to learn in a shift.** The people using this are cooking and serving, not administering software. Fewer screens, bigger targets, obvious defaults.

**Useful before ambitious.** Each phase should make the business measurably easier to run. Billing and cash reconciliation land before analytics, because a shop that can't close its drawer doesn't care about a dashboard.

## Intended shape

The app is built **UI-first**: every screen is built and made demonstrable with mocked data before any of it is wired to a real backend, then each surface is made real one at a time. See [Demo Mode](DEMO_MODE.md) for why, and for the rules that keep mocked screens honest about what the data model can actually serve.

1. **Foundations** — the deployable themed shell, the schema and tenancy model, and the adapter seam that makes UI-first possible.
2. **Attendance goes live** — auth, then attendance. Ends with **real staff checking in on their own phones in production**: the first genuine business value, deliberately pulled ahead of everything else because the business wants it immediately.
3. **The full experience, demo-gated** — billing, menu, inventory, expenses, cash, owner console, alerts. Ends with a **deployed walkthrough of the entire four-role experience** on coherent mock data.
4. **The counter takes money** — device trust and the offline outbox, then billing.
5. **Operations and insight go live** — expenses, inventory, daily cash, then the owner's cross-outlet view.
6. **Growth** — a repeatable path to onboard a new franchise outlet.

The build order, its dependencies, and the gate for each step are in [`openspec/changes/ROADMAP.md`](../openspec/changes/ROADMAP.md) — which is deliberately kept small and **expected to grow** as real work surfaces.
