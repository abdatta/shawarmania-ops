# Design: ui-outlet-operations

## Context

Every manager-facing operational surface in one change: **Menu**, **Inventory**, **Expenses** and **Daily cash**. All four are built against mock adapters behind the `demo` gate, on the shell and layout primitives from `demo-mode-and-app-shell` (#3), and none of them touches Supabase. `expenses-and-inventory-live` (#11) and `daily-cash-live` (#12) swap the adapters and promote the gates later; per the roadmap's standing principle, those changes must not have to redesign anything here.

Four things are already settled and this change inherits rather than revisits them:

- The **schema exists** — `menu_categories`, `menu_items`, `inventory_items`, `inventory_movements`, `expenses`, `cash_withdrawals`, `daily_cash_records` are all in `src/data-access/database.types.ts`. Every fixture is typed from them, so a mock the database could not serve fails to compile.
- The **write contracts exist as specs** — `openspec/specs/inventory-ledger/spec.md` (append-only ledger, quantity is a derived cache) and `openspec/specs/daily-cash-reconciliation/spec.md` (the database computes the close, a closed day is never recomputed, the arithmetic is a constraint). This change adds the surfaces those contracts are for, and its mocks must behave the way those contracts say the database will.
- The **adapter seam and gate registry exist** — a surface is `hidden`, `demo` or `live` in one file, and screens read `useAdapters()` and `useSession()` and cannot tell which mode they are in.
- The **money rule** — integer paise everywhere, formatted only through `Money` / `formatPaise`.

### Ordering against `ui-billing-counter` (#6)

The roadmap calls #6 and #7 "fully parallel". That is true of the *surfaces*; it is not quite true of the seam beneath them, and running them in one session exposes two real couplings:

1. **The counter sells from the menu.** `menu_items` is this change's table, and the billing grid needs a `MenuAdapter` and menu fixtures to render tiles at all. So **the menu half of this change lands first**, and #6 consumes it.
2. **Daily cash derives cash sales from bills.** The whole point of the cash screen is that a cash bill moves the drawer and a UPI bill does not, so its figures must be read from the same demo bills the counter rings — not from an independently invented number that would contradict the counter two screens away.

Hence the execution order used here: **menu seam → menu surfaces → (#6 in full) → inventory → expenses → daily cash**. Nothing else in either change is ordered against the other.

## Goals / Non-Goals

**Goals:**

- Menu, Inventory, Expenses and a full day-close all walkable in demo mode, on a phone viewport and a tablet viewport, in both themes.
- The demo path passes through the awkward states on purpose: a **low-stock warning**, a **deliberate cash mismatch**, and a **reconciliation exception** where a bill arrived against a day that was already closed.
- The permission difference is visible: a Franchise Admin edits the menu, a Biller reads it and cannot change it — refused by the mock the way RLS will refuse it, not by a hidden button.
- Adapter interfaces shaped by what these screens actually need, so #11 and #12 swap an implementation rather than redesign a screen.
- The reconciliation arithmetic lands in `src/domain/` as pure functions mirroring the database constraint, so #12 inherits a tested invariant instead of rewriting one.

**Non-Goals:**

- No real data, no persistence, no Supabase queries — #11 and #12.
- No recipe or bill-of-materials modelling, no supplier management, no denomination counting.
- **No resolution of the P&L double-counting trap.** Raw-material expenses are displayed here and counted by #13. `docs/DATA_MODEL.md` owns that question and this change must not answer it.
- No Franchise Admin dashboard build-out. `admin-dashboard` is `live`, so filling it with mock-derived figures would break the seam; it stays as it is until #11/#13 give it real numbers.
- No menu category reordering by drag. Sort order is an integer field and an editable number is enough for seven items.

## Decisions

### D1 — One mutable demo store, shared by every mock adapter

`createMockAdapters()` today builds one account list and hands it to two adapters, because "accounts and the roster describe the same people from different angles". The operational surfaces need much more of that: the cash screen must read the bills the counter rang and the expenses the manager typed, and the inventory ledger must be the only thing that decides current quantity.

So `src/data-access/mock/store.ts` exports `createDemoStore()`, returning one mutable, per-session bag of collections (`menuCategories`, `menuItems`, `inventoryItems`, `inventoryMovements`, `expenses`, `withdrawals`, `dailyCashRecords`, and — added by #6 — `shifts`, `bills`, `billItems`). Each mock adapter factory takes the store and owns its slice of it.

*Alternative rejected*: one module-level singleton store. It survives across tests and across demo sessions, so a walkthrough would start wherever the last one left off, and `createMockAdapters()` is already called per role render. Per-call construction keeps "demo state resets" true (`docs/DEMO_MODE.md`).

*Alternative rejected*: keeping the four operational mocks independent and inventing a cash-sales figure. Cheaper, and it produces exactly the failure `docs/DEMO_MODE.md` calls out — "anyone looking at two screens in a row will notice figures that do not correspond".

### D2 — Current quantity is derived from the ledger inside the mock, never stored and mutated

`inventory-ledger`'s spec says the database maintains `current_quantity` from the movements and clients cannot write it. The mock therefore does not keep a running counter it increments; `listItems()` sums each item's movement deltas at read time. The fixture items carry a `current_quantity` typed from the schema (they must, to compile), and the mock **asserts on construction that every fixture's stored quantity equals the sum of its fixture movements** — so a fixture that disagrees with its own ledger fails a test rather than shipping a demo where "why does it say 4 kg?" has no answer.

*Alternative rejected*: mutate `current_quantity` on each movement. That is what a naive mock does, and it makes the cache authoritative — the exact inversion the spec exists to prevent. A demo that lets the two drift teaches the wrong product.

### D3 — Quantities are rounded to three decimals at every write; money stays integer paise

`current_quantity` and `quantity_delta` are Postgres `numeric` — exact there, IEEE doubles here. Summing `0.1 + 0.2` kg of chicken in JavaScript produces `0.30000000000000004`, and an inventory screen showing that is the same class of bug the integer-paise rule exists to prevent, one column over.

`src/domain/inventory.ts` gets `roundQuantity(value)` (three decimals — grams, millilitres, whole pieces) and every mock sum goes through it. Money is untouched by this: it is integer paise and never a float.

*Alternative rejected*: integer milli-units for quantity, mirroring paise. Correct in principle, but the schema column is `numeric` and the adapter boundary would then lie about its own types; the rounding helper keeps the seam honest and the arithmetic safe.

### D4 — Low stock is an icon and a word, never a colour

`isLowStock(item)` is `current_quantity <= low_stock_threshold`, in `src/domain/inventory.ts`. The row renders a `TriangleAlert` plus the literal words **Low stock**, with the warning token as reinforcement. Colour alone fails for the roughly one in twelve men with a colour-vision deficiency, and this is a kitchen list read at speed.

Threshold equality counts as low — running out at exactly the reorder point is the case the threshold was set for.

### D5 — Veg / non-veg is carried by shape as well as colour, in one shared component

`src/components/ui/veg-marker.tsx` renders the Indian food convention: a square outline for non-veg, a circle for veg, with a visually-hidden label so it is not colour-and-shape-only for a screen reader. It uses `--marker-veg` / `--marker-nonveg`, which exist precisely so a status colour can be corrected without changing what a veg dot looks like.

It lives in `components/ui/` rather than in the menu feature because the billing grid needs the identical marker, and two drawings of a food-safety convention that differ slightly is worse than one that is plain.

### D6 — One menu surface, two authorities, refused by the adapter

`admin-menu` and a new `counter-menu` surface mount the **same component**. It reads `useSession().role` to decide whether the editing affordances render — and, more importantly, the **mock menu adapter refuses a write from a Biller** with a `DataActionError`, exactly as `menu_items_update` will. The existing mock employees adapter already takes the persona's role for this reason ("a demo that let a manager change a staff code would teach a product this one is not"), and this follows it.

The read-only view says *why* in a sentence rather than hiding the controls, matching how the roster surface handles a Franchise Admin and a staff code.

*Alternative rejected*: a separate lightweight biller menu screen. Two components drift; and the proposal's reason for including the read-only view at all is to make the permission difference visible, which is clearest when it is visibly the same screen.

### D7 — A price edit warns about the future, and cannot rewrite the past

`docs/SCREENS.md` already commits to this: "Editing a price warns that it applies to future bills only." The confirmation copy says so in words, and the demo proves it — bill line items snapshot `item_name` and `unit_price_paise`, so a bill already in the demo store keeps its old figure after the menu price changes. There is a test for exactly that, because it is the single most important thing the menu screen must not get wrong.

### D8 — Movements are a form, the ledger is a page, and a correction is a new row

Recording a movement is the primary action on Inventory, so it is a `FormSheet` from the item row: type (added / used / wasted / correction), quantity, optional note. Signs are the adapter's business — `added` is positive, `used` and `wasted` are negative, `correction` takes the signed value the manager typed — so nobody has to reason about a minus sign while counting stock.

Each item opens its own **movement ledger** (`inventory/:itemId`), newest first, showing running quantity after each row. Nothing on it is editable: the ledger is history, and history is corrected by a new correction movement carrying a note, never by an edit. The mock rejects an update the way the spec says the database will.

### D9 — Daily cash derives everything it can and asks for exactly two numbers

The screen shows, in order: **opening float**, **cash sales** (derived from settled cash bills for the business date), **cash expenses** (derived from cash-method expenses), **withdrawals**, **expected closing** — then one input, the **actual counted amount**, and the **difference the moment it is typed**, in words as well as sign (*₹240 short* / *₹120 over*), because that number is the entire point of the screen.

`src/domain/cash.ts` holds the arithmetic as pure functions mirroring the database constraint verbatim:

```
expectedClosing = openingCash + cashSales − cashExpenses − cashWithdrawn
difference      = actualClosing − expectedClosing
```

A shortfall is negative. Integer paise throughout, and the functions throw on a non-integer input like every other money path.

Only `cash` moves these figures. A UPI sale raises revenue and not the drawer, and a UPI expense leaves it alone; the mock filters on payment method so the demo demonstrates that rule rather than merely stating it.

*Alternative rejected*: compute expected closing in the component. It is the one arithmetic in this change a human signs their name to, and #12 has to enforce the identical equation as a constraint — a shared, tested domain function is what stops the two drifting.

### D10 — Closing a day is irreversible in the demo, and a late bill raises an exception rather than moving a signed-off number

Closing asks for the counted amount and optional notes, then states the consequence plainly and writes a snapshot. After that the day is read-only: no re-close, no edit — matching "a closed day is a snapshot and is never recomputed".

The demo ships **yesterday already closed with a mismatch**, and **one bill whose business date is yesterday arriving after that close**. The cash screen surfaces it as a *reconciliation exception* naming the bill and its amount, stating that the closed figures are unchanged and that this is the thing to look into. This is the state the whole daily-cash chain exists to protect, and a screen that has only ever been seen balancing has not been reviewed.

*Alternative rejected*: silently folding the late bill into the closed day. That is precisely the failure #12's gate forbids, and a mock that does it would have to be un-taught later.

### D11 — Expenses are a day list with cash visually distinct, plus a form that fits on one thumb

The list is today's expenses, newest first, each row carrying category, amount, method and description. **Cash rows carry a marker and the word Cash**, because they alone reach the drawer and the manager reconciling at close needs to find them by eye.

The add form is four controls — category, amount in rupees, payment method, description — with amount converted to paise at the boundary through `rupeesToPaise`, never held as a float in state.

Raw materials is one of the eight categories and is displayed like any other. The double-counting question belongs to #13.

### D12 — The real adapters exist and refuse, rather than not existing

`DataAdapters` is a total bag, so `createSupabaseAdapters()` must supply `menu`, `inventory`, `expenses` and `dailyCash` today. Each is a small module whose reads resolve empty and whose writes reject with `DataActionError('not_live', …)`, carrying a comment naming the change that replaces it (#11, #12). The surfaces are `demo`-gated so nothing ever calls them, and the compile-level parity — the real adapter must satisfy the same interface — is the same proof `demo-mode-and-app-shell` used for `SupabaseOutletsAdapter`.

*Alternative rejected*: writing the real Supabase queries now. That is #11's and #12's work, it cannot be tested without a database in this change's gate, and shipping untested query code behind a closed gate is how a `*-live` change discovers it was wrong.

### D13 — Four new routes, one new surface, four promotions

Gate registry: `admin-menu`, `admin-inventory`, `admin-expenses`, `admin-daily-cash` move `hidden` → `demo`. A new `counter-menu` surface (Biller, path `menu`, nav "Menu") is added in `demo`. Routes are added to the shared `roleSurfaceRoutes`, so a promotion to `live` later needs no route change — which is the property every `*-live` change depends on.

The inventory ledger is a child route (`inventory/:itemId`) rather than a modal, so "why does it say 4 kg?" is a link somebody can be sent.

## Risks / Trade-offs

- **The demo store couples this change's mocks to #6's.** → It is one file with one factory and an explicit ownership comment per slice; the alternative (independent mocks) guarantees the contradiction `docs/DEMO_MODE.md` names as the classic demo failure. #8 extends the same store rather than replacing it.
- **Deriving cash sales from bills means this change cannot be fully walked until #6 lands.** → Accepted, and it is why the execution order above exists. The cash fixtures include yesterday's closed day, which is walkable on its own.
- **A mock that enforces refusals can drift from the real policies.** → Each refusal is written next to a comment naming the policy or trigger it mirrors, the same way the mock outlets adapter documents `outlet_prefix_guard`; and #11/#12 verify the real ones against the RLS suite.
- **Quantity rounding hides genuine precision loss rather than preventing it.** → Three decimals is finer than any unit the business measures in (grams, millilitres, whole pieces), and the alternative — integer milli-units — would make the adapter's types disagree with the schema's. Recorded rather than solved.
- **Four surfaces in one change is a lot of screen.** → They share one shape (list → detail → form sheet) and one set of primitives; the proposal's whole argument for bundling them is that building them apart converges them later, at more cost.
- **`admin-dashboard` still shows a placeholder while four surfaces behind it are walkable.** → Deliberate: it is a `live` surface and may not render mock figures. Its copy is corrected to say the operations surfaces are now walkable in demo, which is true in both modes.
