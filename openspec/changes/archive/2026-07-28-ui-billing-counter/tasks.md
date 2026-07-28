# Tasks: ui-billing-counter

> **Execution order note.** Groups 1 and 2 of `ui-outlet-operations` (#7) — the
> shared demo store, the `MenuAdapter` and the menu fixtures — land **before**
> group 2 below, because the counter sells from `menu_items`. Nothing else in
> the two changes is ordered against the other, and the dependency runs one
> way only. See design, Context.

## 1. The billing domain — totals, references, sync thresholds

- [x] 1.1 Add `src/domain/billing.ts`: `billTotals(lines, { discountPaise, taxPaise })` enforcing `lineTotal = unitPrice × quantity` and `total = subtotal − discount + tax` in integer paise, throwing on a non-integer (design D9).
- [x] 1.2 Add `provisionalReference(clientId)` to the same module: `Queued · A3F9`, four Crockford base32 characters from the client UUID, deliberately unlike a bill number (design D5).
- [x] 1.3 Add the sync thresholds and classifier: `SYNC_ESCALATION_COUNT`, `SYNC_ESCALATION_MS`, `UNDO_WINDOW_MS`, and `classifySync({ pending, oldestQueuedAt, now })` returning `synced | pending | stalled` (design D7).
- [x] 1.4 Unit-test all of it: a three-line order, the float rejection, a reference that cannot parse as an integer, and each sync state at its boundary. Export from `src/domain/index.ts`.

## 2. The billing seam — adapter, fixtures, mock queue, real stub

- [x] 2.1 Add bill, shift and biller fixtures to `src/data-access/mock/fixtures/`: the demo billers with PINs, one shift already open for the demo biller, and a handful of settled bills for today across cash and non-cash methods — typed from `Tables<'bills'>`, `Tables<'bill_items'>`, `Tables<'shifts'>` (design D2). Extend `fixtures.test-d.ts` with the drift proofs.
- [x] 2.2 Extend `createDemoStore()` with the `shifts`, `bills`, `billItems` and `billNumberCounters` slices, so the daily-cash adapter in #7 reads the same bills the counter rings (design D1 of #7).
- [x] 2.3 Define `BillingAdapter` in `src/data-access/adapters.ts`: `getCounterState`, `subscribeCounter`, `listBillers`, `openShift`, `closeShift`, `settleBill`, `cancelQueuedBill` — with `BillDraft`, `BillLine`, `QueuedBill`, `CounterShift`, `SyncState` and a `BillingActionError`. Every money field integer paise; `settleBill` returns without awaiting anything (design D8, D9).
- [x] 2.4 Implement `createMockBillingAdapter(store, session)` in `src/data-access/mock/billing.ts`: an in-memory queue keyed by client UUID, draining only while `navigator.onLine`, holding each bill for `UNDO_WINDOW_MS` before sending, assigning the per-outlet sequential number **on send only**, refusing a duplicate UUID, and exposing no update path for a settled bill (design D11).
- [x] 2.5 Wire the queue to the `online`/`offline` events and expose `subscribeCounter` as a `useSyncExternalStore`-compatible store with a stable snapshot (design D7, D8).
- [x] 2.6 Unit-test the mock: duplicate UUID stores once, cancel leaves no gap in the numbering, numbers are assigned only on send, a bill settled at 00:20 carries the previous business date, offline accumulates and reconnecting drains (design D10, D11).
- [x] 2.7 Add `src/data-access/supabase-adapters/billing.ts` — reads resolve to nothing, writes reject `not_live`, comment naming #9/#10 — and wire it into `createSupabaseAdapters()` (design D12).

## 3. Shift unlock and handover

- [x] 3.1 Promote `counter-shift-unlock` to `demo`; add the `shift` route to `roleSurfaceRoutes`.
- [x] 3.2 Build `src/features/billing/shift-unlock.tsx`: a grid of the outlet's billers as large targets, then a PIN pad — big keys, no system keyboard — with one identical refusal for a wrong PIN or an unknown biller (design D2).
- [x] 3.3 Add the handover path on the same surface: the open shift is shown with who holds it and since when, closing it is one confirmed action, and the incoming biller opens theirs immediately after.
- [x] 3.4 Component-test: the grid lists billers, a wrong PIN is refused and opens nothing, a right PIN opens a shift, a handover reattributes the open shift.

## 4. The counter itself

- [x] 4.1 Promote `counter-billing` to `demo` and remove its navigation entry; make `counter-home` redirect to `billing` when that surface is renderable for the session, keeping the placeholder otherwise (design D1). Add the `billing` route.
- [x] 4.2 Build `src/features/billing/menu-grid.tsx`: category headings and item tiles at `size="tile"`, each showing name, price through `Money`, the shared veg marker, and a quantity badge when the item is on the bill; unavailable items are not sellable (design D3).
- [x] 4.3 Build `src/features/billing/bill-panel.tsx`: lines with `−` / quantity / `+`, the running total in the display treatment, optional customer name and phone shaped for a later suggestion list, the six payment methods with **cash visually distinct by more than colour**, and Settle pinned below a panel that scrolls internally (design D3, D4, D13).
- [x] 4.4 Build `src/features/billing/billing-counter.tsx` composing the two panes in the fixed two-pane layout, stacking below tablet width; snapshot each line's name and unit price when it is created (design D9, D13).
- [x] 4.5 Implement settle: resolve the business date from the outlet's cutover, build the draft with integer-paise totals from `billTotals`, hand it to the adapter without awaiting, clear the panel immediately, and refuse only when there is no payment method or no open shift (design D10).
- [x] 4.6 Build the confirmation strip: total, provisional reference, **Undo** while unsent, auto-clearing without acknowledgement; Undo cancels the queue entry and restores the order to the panel (design D5, D6).
- [x] 4.7 Build `src/features/billing/counter-status.tsx`: `ShiftStatus` and `SyncIndicator`, both subscribing to `subscribeCounter` through `useSyncExternalStore`; mount them in `CounterShell`'s existing `shift-status` and `sync-indicator` slots, keeping the shell mode-agnostic (design D8).
- [x] 4.8 Component-test the counter: tap adds, tap again increments, the panel decrements and removes, the total tracks, settling with both customer fields empty succeeds, settling with no method is refused, settling clears the panel, undo restores it, and a menu price change does not alter a line already on the panel.

## 5. Verification, docs and gates

- [x] 5.1 Assert the whole-menu-fits claim at the smallest supported tablet size, comparing the grid's content height with its visible height, so a menu that outgrows the screen fails a test (design D13).
- [x] 5.2 Extend `src/demo/demo-safety.test.tsx` to exercise every new mock billing method, writes included, and assert zero `fetch` calls.
- [x] 5.3 Playwright on the tablet project: open a shift, ring a full multi-item order, settle it, and see the confirmation with its provisional reference — then repeat with customer fields left empty.
- [x] 5.4 Playwright offline: `setOffline(true)`, ring enough bills to cross the escalation threshold, assert the indicator reaches the stalled state, go back online and assert it drains to synced with each bill numbered exactly once.
- [x] 5.5 Playwright: the counter renders in light and dark on a tablet viewport with no console errors and no request leaving the app origin.
- [x] 5.6 Update `docs/SCREENS.md` to present tense for the counter, the shift screens and the sync indicator, and `docs/DEMO_MODE.md` for the demo PIN and the open-shift starting state.
- [x] 5.7 Full local gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run contrast`, `npm run build`, `npm run test:e2e` all green. Run `npm run roadmap:sync`.
- [x] 5.8 **PHASE GATE** — a full order can be rung and settled in demo mode on a tablet viewport; the whole menu is visible without scrolling; optional customer fields never block settling. Record which test or action proved each clause.
