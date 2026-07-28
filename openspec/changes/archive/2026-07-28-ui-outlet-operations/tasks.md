# Tasks: ui-outlet-operations

> **Execution order note.** Group 1 and group 2 (the menu seam and the menu
> surfaces) land **before** `ui-billing-counter` (#6), because the counter
> sells from `menu_items` and needs the adapter and fixtures to render a tile
> at all. Group 5 (daily cash) lands **after** #6, because cash sales are
> derived from settled cash bills and must be the same bills the counter rang.
> Groups 3 and 4 are independent of #6 in both directions. See design, Context.

## 1. The shared demo store and the menu seam

- [x] 1.1 Add `src/data-access/mock/store.ts`: `createDemoStore()` returning one mutable per-session bag of collections, with an ownership comment per slice. Refactor `createMockAdapters()` to build it once and hand each factory its slice, keeping the existing accounts/employees sharing intact (design D1).
- [x] 1.2 Add menu fixtures at `src/data-access/mock/fixtures/menu.ts`: two categories and the seven live items from `docs/BUSINESS_CONTEXT.md`, prices as integer paise, `is_veg` set, one item deliberately unavailable so the demo shows both states. Typed from `Tables<'menu_categories'>` / `Tables<'menu_items'>`.
- [x] 1.3 Extend `src/data-access/mock/fixtures/fixtures.test-d.ts` with drift proofs for the menu fixtures: a column the schema lacks, a wrong value type, and an invented enum member all fail to compile.
- [x] 1.4 Define `MenuAdapter` in `src/data-access/adapters.ts` — `listMenu`, `createCategory`, `updateCategory`, `createItem`, `updateItem`, `setItemAvailability` — with `MenuCategoryWithItems`, `NewMenuItem`, `MenuItemPatch` and a `MenuActionError`. Prices are integer paise in the interface, never rupees (design D6).
- [x] 1.5 Implement `createMockMenuAdapter(store, role)` in `src/data-access/mock/menu.ts`: reads sorted by `sort_order`, writes refused for a Biller with the same code the RLS policy will use, results cloned. Unit-test the refusal and the sort (design D6).
- [x] 1.6 Add `src/data-access/supabase-adapters/menu.ts`: reads resolve empty, writes reject `not_live`, with a comment naming #10/#11 as the change that replaces it. Wire it into `createSupabaseAdapters()` (design D12).
- [x] 1.7 Build `src/components/ui/veg-marker.tsx`: circle for veg, square for non-veg, `--marker-veg` / `--marker-nonveg`, visually-hidden text label. Component-test that the label is present and that shape differs by value (design D5).

## 2. Menu surfaces — the manager's and the Biller's

- [x] 2.1 Promote `admin-menu` to `demo` and add a `counter-menu` surface (Biller, path `menu`, nav "Menu", `demo`) to `src/gates/registry.ts`; add the `menu` route to `roleSurfaceRoutes` (design D13).
- [x] 2.2 Build `src/features/menu/menu-surface.tsx`: categories in sort order with their items, each row showing name, price through `Money`, the veg marker, and availability state. Empty state says what to create first.
- [x] 2.3 Add the item form sheet: name, category, price in rupees converted through `rupeesToPaise`, veg toggle, description, sort order. Blank-value refusal in this app's voice with `noValidate`, matching the outlets form.
- [x] 2.4 Add the availability toggle as a distinct row action, separate from Edit, changing the row in place; an unavailable item stays listed and is labelled (design D6, spec: availability is a distinct action).
- [x] 2.5 Add the price-change warning: editing an existing item's price states that it applies to future bills only before it is saved (design D7).
- [x] 2.6 Render the read-only variant for a Biller from the same component: no editing affordances, and a sentence saying a manager changes the menu. Component-test both roles, including that a write attempted against the mock as a Biller is refused.
- [x] 2.7 Component-test the surface: list renders in sort order, an item is added, a price is edited with the warning shown, availability toggles in place, empty state appears for an outlet with no menu.

## 3. Inventory — the list, the movement, the ledger

- [x] 3.1 Add `src/domain/inventory.ts`: `roundQuantity`, `isLowStock`, `movementDelta(type, quantity)` deriving the sign from the movement type, and `quantityAfter` for the ledger's running figure. Unit-test the 0.1 + 0.2 case and threshold equality (design D3, D4, D8).
- [x] 3.2 Add inventory fixtures: items with units and thresholds, **one deliberately at or below its threshold**, plus the movements whose sum equals each item's stored quantity. Add the construction-time assertion that fixture quantity equals fixture ledger (design D2).
- [x] 3.3 Define `InventoryAdapter` in `adapters.ts` — `listItems`, `getItem`, `listMovements`, `createItem`, `updateItem`, `recordMovement` — with quantities derived from movements at read time, never stored and mutated.
- [x] 3.4 Implement `createMockInventoryAdapter(store)`: current quantity summed from the ledger through `roundQuantity`, movement writes appending only, updates and deletes of movements refused. Unit-test that the cache equals the ledger after a sequence of movements.
- [x] 3.5 Add `src/data-access/supabase-adapters/inventory.ts` (reads empty, writes `not_live`) and wire it in.
- [x] 3.6 Promote `admin-inventory` to `demo`; add the `inventory` and `inventory/:itemId` routes.
- [x] 3.7 Build `src/features/inventory/inventory-surface.tsx`: item list with quantity and unit, the low-stock treatment as icon plus the words "Low stock", and the movement form sheet (type, quantity, note) as the primary row action.
- [x] 3.8 Build `src/features/inventory/movement-ledger.tsx` at `inventory/:itemId`: movements newest first with type, signed quantity, note, business date and running quantity; no edit or delete affordance anywhere on it.
- [x] 3.9 Component-test both surfaces: low-stock item is marked, recording a used movement decreases the quantity, recording a correction leaves both rows visible, the ledger offers no edit control.

## 4. Expenses — the day list and the fast form

- [x] 4.1 Add expense fixtures for today and yesterday across several categories and payment methods, including cash and non-cash, amounts in integer paise.
- [x] 4.2 Define `ExpensesAdapter` in `adapters.ts` — `listExpenses(outletId, businessDate)`, `createExpense` — and implement `createMockExpensesAdapter(store)`; add the `not_live` Supabase stub and wire both in.
- [x] 4.3 Promote `admin-expenses` to `demo`; add the `expenses` route.
- [x] 4.4 Build `src/features/expenses/expenses-surface.tsx`: the day's expenses newest first with category, amount, method and description; **cash rows carry a label as well as a marker**; business date shown as a date and selectable (design D11).
- [x] 4.5 Add the four-field add form (category, amount in rupees, payment method, description) converting through `rupeesToPaise` at the boundary, refusing a blank or non-numeric amount by naming the field.
- [x] 4.6 Component-test: a cash expense and a UPI expense render distinguishably, an expense is added and appears, a blank amount is refused and records nothing, the empty state says what to record.

## 5. Daily cash — derive, count, close, and the exception

- [x] 5.1 Add `src/domain/cash.ts`: `expectedClosingPaise`, `differencePaise`, and `describeDifference` returning short / over / balanced, all integer-paise and throwing on a float. Unit-test the invariant, the negative shortfall, and the float rejection (design D9).
- [x] 5.2 Add daily-cash fixtures: **yesterday closed with a deliberate mismatch**, today open with an opening float, one withdrawal, and **one bill whose business date is yesterday recorded after that close** for the exception (design D10).
- [x] 5.3 Define `DailyCashAdapter` in `adapters.ts` — `getDay`, `recordWithdrawal`, `closeDay`, `listExceptions` — with every derived figure computed by the adapter from bills and expenses, never supplied by the caller (design D9, mirrors the `close_business_day` contract).
- [x] 5.4 Implement `createMockDailyCashAdapter(store)`: cash sales from settled cash bills for the date, cash expenses from cash expenses for the date, withdrawals summed, expected closing through the domain function; a second close refused; a closed day never recomputed. Unit-test each.
- [x] 5.5 Add `src/data-access/supabase-adapters/daily-cash.ts` (reads empty, writes `not_live`) and wire it in.
- [x] 5.6 Promote `admin-daily-cash` to `demo`; add the `cash` route.
- [x] 5.7 Build `src/features/cash/daily-cash-surface.tsx`: opening float, derived cash sales, derived cash expenses, withdrawals, expected closing, the counted-amount field, and **the difference the moment it is typed**, in words and sign.
- [x] 5.8 Add the withdrawal form (amount, who took it, optional reason) and the day-close confirmation stating that figures are snapshotted and the day cannot be closed again; a closed day renders read-only.
- [x] 5.9 Render the reconciliation exception for a bill that arrived against a closed day, naming the bill and its amount and stating the closed figures are unchanged.
- [x] 5.10 Component-test: derived figures count only cash, typing a short count shows a negative difference described as a shortfall, closing writes the snapshot and removes the close action, and the late-bill exception is visible on the closed day.

## 6. Wiring, docs and gates

- [x] 6.1 Correct the `admin-dashboard` placeholder copy: it stays a placeholder (it is `live` and may not render mock figures), but says the operations surfaces are now walkable in demo rather than that they are still to ship.
- [x] 6.2 Update the demo-safety test's hidden-surface deep link, which currently uses `/demo/admin/inventory` — now a `demo` surface. Point it at a surface that is still `hidden` and keep the assertion identical in intent.
- [x] 6.3 Extend `src/demo/demo-safety.test.tsx` to exercise every new mock adapter method, writes included, and assert zero `fetch` calls.
- [x] 6.4 Playwright: walk Menu → Inventory → Expenses → Daily cash in demo on a phone viewport and a tablet viewport, in light and dark; assert the low-stock warning and the cash mismatch are visible; assert no request leaves the app origin.
- [x] 6.5 Update `docs/SCREENS.md` to present tense for the four surfaces and the Biller's read-only menu view, and `docs/DEMO_MODE.md` for anything the demo dataset now carries.
- [x] 6.6 Full local gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run contrast`, `npm run build`, `npm run test:e2e` all green. Run `npm run roadmap:sync`.
- [x] 6.7 **PHASE GATE** — menu, inventory, expenses and a full day-close are all walkable in demo mode, including a low-stock warning and a deliberate cash mismatch. Record which test or action proved each clause.
