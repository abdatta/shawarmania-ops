# Tasks: ui-owner-console-and-demo

> **Execution order note.** Group 1 comes first and everything depends on it:
> the two-outlet scenario dataset is what the console, the comparison, the P&L
> and the reports all read, and building a surface against a single-outlet
> store would mean rebuilding it. Groups 3–6 are independent of each other
> once group 2's seam exists. Group 7 (the handover) touches no data at all
> and can land at any point. See design, Context.

## 1. The scenario dataset — two outlets, every figure derived

- [x] 1.1 Give every seed type an outlet: add `outletId` to `BillSeed`, `MovementSeed`, `ExpenseSeed`, `WithdrawalSeed` and the menu and inventory item fixtures, defaulting to Kalyani so existing seeds read unchanged (design D1).
- [x] 1.2 Add Kanchrapara's menu fixtures — its own category and item rows for the same items, since menus are per-outlet in this schema — and extend `fixtures.test-d.ts` with a drift proof for them.
- [x] 1.3 Add Kanchrapara's trading day: bills across yesterday and today at roughly half Kalyani's volume, mixed payment methods, no low stock and **no cash difference at close**, so Kalyani's problems read as differences rather than as how the app always looks (design D2).
- [x] 1.4 Add Kanchrapara's stock items and movements, and its expenses and withdrawals for both days.
- [x] 1.5 Generalise `createDemoStore()` to materialise per outlet: bills numbered from a **per-outlet** sequence, movements, expenses, withdrawals, and a closed cash record per outlet for yesterday — all through the existing domain functions, never hard-coded (design D1).
- [x] 1.6 Extend the construction-time assertions per outlet: every item's stored quantity equals the sum of its own ledger, and every outlet's bill numbers are gapless from 1. Unit-test that a deliberately contradictory fixture throws.
- [x] 1.7 Audit every mock adapter for a hard-coded `DEMO_OUTLET_ID` or an unfiltered read, and scope each to the outlet it was asked for. Unit-test that a Kalyani read returns no Kanchrapara row.

## 2. The insights seam

- [x] 2.1 Define `InsightsAdapter` in `src/data-access/adapters.ts` with `outletDay`, `periodSummary` and `comparison`, returning derived shapes and **taking no figures as input** (design D4). Document that a closed day contributes its snapshot, never a recomputation. *(Landed without a separate `profitAndLoss`: `periodSummary` already carries a `ProfitEstimate` on the basis the caller named, and a second call returning a subset of the first is an API that drifts.)*
- [x] 2.2 Add `src/domain/pnl.ts`: `cashBasisProfitPaise`, `consumptionBasisProfitPaise`, `inventoryConsumedPaise` (used and wasted only, at purchase cost), and `PROFIT_BASIS_LABELS`. Integer paise, throwing on a non-integer (design D5).
- [x] 2.3 Unit-test the double-counting proof: a period holding a `raw_materials` expense and the `used` movements it paid for counts the food exactly once on the consumption basis. Also test that `added` and `correction` are not consumption, and that a float throws.
- [x] 2.4 Implement `createMockInsightsAdapter(store, role)` in `src/data-access/mock/insights.ts`: every figure summed from `store.bills`, `store.expenses`, `store.inventoryMovements` and `store.dailyCashRecords`; a closed day read from its snapshot; a Franchise Admin asking for another outlet gets nothing, mirroring the policy #13 will rely on.
- [x] 2.5 Unit-test the mock: an outlet's day sales equal the sum of its settled bills; a closed day reports its snapshot rather than a recomputation that would include the late bill; a cross-outlet read from a manager returns nothing.
- [x] 2.6 Add the real insights adapter — reads resolve `null`/empty, writes reject `not_live` — with a comment naming #13, and wire it into `createSupabaseAdapters()` (design D13). *(Landed as `supabase-adapters/oversight.ts` alongside the alerts stub of task 5.5: both are #13's, both are a dozen lines, and the note about `outletDay` being genuinely called by a `live` surface belongs beside both of them.)*

## 3. The owner console and the outlet switcher

- [x] 3.1 Rebuild `src/features/overview/owner-home.tsx` as the console: outlet cards from `outlets.listOutlets()`, each card's figures from `insights.outletDay()`, and **an outlet whose figures resolve to null still listed** with the absence stated (design D3).
- [x] 3.2 Add the outlet switcher control — All outlets, or one — scoping the console, and state the current scope on screen. It lists only what the adapter returned (design D6).
- [x] 3.3 Add the `owner-outlet-view` surface: promote it to `demo` in the registry, add the `outlet/:outletId` route to `roleSurfaceRoutes`, and build the read-only day view — sales by method, cash position and close state, low stock, open alerts, who is checked in — stating that it is read-only.
- [x] 3.4 Component-test the console: both outlets render with their own figures; a null-figures outlet is listed with the absence stated; the switcher scopes the figures; the outlet view opens at its own address.
- [x] 3.5 Component-test that the console renders correctly in real mode against the `not_live` insights adapter — the outlet list intact, the figures absent, and the sentence naming #13.

## 4. Comparison, P&L and reports

- [x] 4.1 Promote `owner-comparison` to `demo`; add `owner-pnl` and `owner-reports` surfaces (`demo`, **no nav entry** — reached from the console) and promote `admin-pnl` to `demo`; add the `comparison`, `pnl` and `reports` routes (design D14).
- [x] 4.2 Build `src/features/insights/comparison-surface.tsx`: outlets side by side over a chosen period with sales, expenses, estimated profit and cash differences, the period and the basis stated on screen.
- [x] 4.3 Build `src/features/insights/pnl-surface.tsx`: one component for both roles, resolving its outlet from the session for a manager and from the switcher for the owner, with the basis toggle and **the basis stated in words beside the figure** (design D5).
- [x] 4.4 Build `src/features/insights/reports-surface.tsx`: period summary — sales by payment method, expenses by category, profit on the stated basis, cash differences by day — with **no export file**, and the sentence saying when exporting arrives (design D7).
- [x] 4.5 Component-test: switching basis changes both the figure and the stated basis; a profit figure never renders without its basis; the reports surface offers no download.
- [x] 4.6 Component-test the comparison surface against the scenario: Kalyani and Kanchrapara show different figures, and each reconciles with the bills behind it.

## 5. Alerts — raise, inbox, respond, resolve

- [x] 5.1 Add `src/domain/alerts.ts`: the permitted status transitions, `canTransition(from, to)`, and priority ordering for the inbox sort. Unit-test that open → closed is refused and that closed is terminal (design D8).
- [x] 5.2 Add alert fixtures: one open **high-priority** alert at Kalyani tied to a state the walkthrough can see for itself, one acknowledged with a response, one resolved, and one at Kanchrapara so the inbox is genuinely cross-outlet.
- [x] 5.3 Define `AlertsAdapter` in `adapters.ts` — `listAlerts`, `getAlert`, `raiseAlert`, `respond`, `setStatus` — with an `AlertActionError`; implement `createMockAlertsAdapter(store, role, session)` enforcing the transitions and the cross-outlet boundary.
- [x] 5.4 Unit-test the mock: a manager cannot read another outlet's alerts; an illegal transition is refused and leaves the status unchanged; a response does not change the status; a blank message is refused.
- [x] 5.5 Add the real alerts adapter (reads empty, writes `not_live`) and wire it in — landed in `supabase-adapters/oversight.ts`, see 2.6.
- [x] 5.6 Promote `owner-alerts` and `admin-alerts` to `demo`; add the `alerts` route to `roleSurfaceRoutes`.
- [x] 5.7 Build `src/features/alerts/alerts-surface.tsx`: the owner's cross-outlet inbox with the outlet named on each row and attention-needing alerts first; the manager's own-outlet list from the same component; **priority as a word plus a non-colour marker**.
- [x] 5.8 Add the raise form (category, priority, subject, message) with blank-value refusal in this app's voice, and the alert detail with its response thread and status actions.
- [x] 5.9 Component-test both roles: a manager raises an alert and the owner sees it; the owner responds and the status is unchanged; acknowledging then resolving then closing works and the closed alert offers no further transition.

## 6. Demo reset

- [x] 6.1 Add the reset to `DemoRoot`: a counter in state keying the provider stack, so `createDemoStore()` runs again and every adapter is rebuilt (design D10).
- [x] 6.2 Add the reset control to the demo banner beside the role switcher, stating what it does before discarding anything.
- [x] 6.3 Component-test: a reset after recording a bill, a movement and an expense returns the dataset to its starting state **and leaves the reader on the same role's surface**.

## 7. Handing the demo over

- [x] 7.1 Remove **View the demo** from `src/routes/landing.tsx`.
- [x] 7.2 Add the demo entry and its copy-link action to `src/auth/account-menu.tsx`, **for the Super Admin only**, linking and copying `/demo` rather than a role path (design D9).
- [x] 7.3 Implement the copy with a visible confirmation and a fallback that shows the URL as selectable text where the clipboard is unavailable or refused.
- [x] 7.4 Component-test: the landing page offers no demo route; the entry appears for a Super Admin and for no other role; the copied value is the demo root; the fallback renders when the clipboard rejects.
- [x] 7.5 Add a test proving the owner's own demo link still meets the interstitial while signed in — no special case for the role that owns the menu.

## 8. Docs

- [x] 8.1 Update `docs/SCREENS.md`: the owner console, the outlet switcher, comparison, P&L, reports and alerts as built; and the account menu gaining its first role-dependent entry.
- [x] 8.2 Update `docs/DEMO_MODE.md`: **where the link is found** (first), the walkthrough route through all four roles, what the scenario starts with across both outlets, how to reach the sync backlog the real way (design D12), and how to extend the scenario.
- [x] 8.3 Update the status banners in `AGENTS.md`, `docs/SCREENS.md` and `docs/DEMO_MODE.md` to say what is now walkable.

## 9. Phase gate

- [x] 9.1 **PHASE GATE** — **a single uninterrupted walkthrough of all four roles**, with internally consistent mock data: a busy trading day whose bills, stock movements, cash close and alert all reconcile with each other. Walked end to end against a **production build** (`vite preview`), on a phone viewport and a tablet viewport, in both themes: zero console messages, every request same-origin, the banner present and undismissable on every surface, and every figure on the owner console traced back to the rows behind it — the console's ₹240 chip against the cash screen's signed-off snapshot, its low-stock count against the manager's list, and its sales against the sum of the bills.
- [ ] 9.2 🧍 **The same walk on the deployed URL.** Everything above ran against a production build served locally, which is what the e2e suite gates. Confirming it on the deployed site needs a push to `main` — the deploy is the owner's call, not this change's.
