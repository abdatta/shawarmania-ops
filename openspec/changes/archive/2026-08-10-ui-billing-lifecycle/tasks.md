## 1. Adapter and demo model

- [x] 1.1 Replace the settle-only billing adapter shape with typed composer, open-order, payment, direct-payment Undo, customer lookup, shift history, manager history, originating-tablet correction/discard and read-only manager-diagnostic contracts derived from generated schema types.
- [x] 1.2 Extend the shared demo store with a direct payment, an order taken and paid on handover, an aggregator order collected by a rider, a cancellation with a reason, a bill that is not sent yet, one command needing attention, and a repeat customer found by phone.
- [x] 1.3 Reconcile every demo sales, payment-date cash, owner, history and daily-cash figure after the fixture expansion.
- [x] 1.4 Unit-test owning-tablet enforcement, paying an order a manager cancelled, customer autofill decisions, the guaranteed direct-payment Undo, zero-discount commands, immutable paid correction, originating-tablet correction/discard, read-only manager diagnostics, cancellation and demo reset.

## 2. Counter workflow

- [x] 2.1 Preserve the direct paid flow and its six-second guaranteed Undo before delivery, and add Order without adding a saved-order prerequisite to immediate payment.
- [x] 2.2 Keep the order number as a secondary reference on the persistent order until it is paid or cancelled, visually unmistakable against a bill number.
- [x] 2.3 Build Open orders for this tablet with reopen and edit, exact full payment through one or more tender allocations including aggregator methods, and attributed cancellation; expose no discount control and keep `discount_paise` zero.
- [x] 2.4 Report a payment against an order a manager already cancelled as a cancellation, naming who, rather than as a conflict.
- [x] 2.5 Show plainly when a bill is not sent yet, and never show a bill number before the server assigns one.
- [x] 2.6 Add exact complete-phone lookup, prompted autofill, conflict warning, decline behaviour, and automatic new-profile save.
- [x] 2.7 Build My shift with this shift's bills and running totals by payment method only.
- [x] 2.8 Build needs-attention correction and reasoned discard on the originating tablet, using a new linked UUID for a correction and retaining actor, time, reason and the refused trace.

## 3. Manager history

- [x] 3.1 Build outlet, revenue-business-date, status and payment-filtered bill history and immutable bill detail for FA and SA personal contexts, showing payment time and payment business date when they differ.
- [x] 3.2 Build reasoned void on the manager phone and instruct that the corrected sale is manually re-rung on the enrolled counter tablet, leaving the original paid bill unchanged and creating no cross-device draft or personal-device billing path.
- [x] 3.3 Build the outlet's open-order list with a reasoned cancel, which is how a stranded order is cleared. No transfer and no recovery surface exists.
- [x] 3.4 Show managers read-only, non-identifying delivery diagnostics: counts, age, command type, reference and result category, with no payload, customer details, correction or discard action.

## 4. Gates, responsive design, and docs

- [x] 4.1 Register the Counter composer, Open orders, My shift and manager history as separate `demo` surfaces with context-correct navigation.
- [x] 4.2 Verify density, focus order, touch targets, empty and loading states, and semantic-token contrast on phone and tablet viewports in light and dark themes.
- [x] 4.3 Reshape the shimmer for every surface whose layout this change alters, in this change.
- [x] 4.4 Confirm no surface uses the words quarantine, envelope, idempotency, grant or provisional.
- [x] 4.5 Update `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md` and `docs/LIMITATIONS.md`.

## 5. Verification

- [x] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`.
- [x] 5.2 Run the four-role demo walkthrough and prove no demo action touches Supabase and no real user sees the demo-only surfaces.
- [x] 5.3 PHASE GATE: demo mode walks direct payment and its guaranteed Undo, an order prepared from its visible item list and paid on handover, an aggregator order collected by a rider, exact-phone autofill, this shift's history, originating-tablet correction/discard, a manager void followed by a manual counter re-ring, and a manager clearing a stranded order, with every figure reconciled and no discount control anywhere.

## 6. Owner review revision

- [x] 6.1 Audit production without exposing credentials or row contents; prove no Card or Other bills or expenses exist, then replace the deployed payment enum through a guarded forward migration that refuses to relabel historical money and restores dependent policy/function behaviour.
- [x] 6.2 Retire Card and Other from every non-archived application selector, accepted billing-command type, demo/seed fixture, supported-method document and later plan, and regenerate database types without either.
- [x] 6.3 Compose landscape tablet billing into three touch-safe, internally scrolling columns: menu, current bill, and one continuous activity rail with Open orders above this shift's bills.
- [x] 6.4 Make every current-shift bill collapsed by default and expandable in both My shift and the combined rail to immutable items, quantities, captured prices, line totals, payment facts, total and optional customer snapshot.
- [x] 6.5 Share the order and bill presentation between integrated and dedicated surfaces, keep both routes resolvable, and reshape the counter shimmer to reserve the three-column layout. (6.15 later made the columns unconditional, so the dedicated routes stopped being the narrow fallback and kept only their links.)
- [x] 6.6 Update component, adapter, database and E2E coverage for the finite payment set, integrated open/closed activity, bill disclosure and route fallback.
- [x] 6.7 Run the full frontend and Docker verification suites and inspect the counter at phone and landscape-tablet sizes in both themes, including touch targets, independent scrolling, disclosures and no horizontal overflow.
- [x] 6.8 Rename operator actions to Paid and Order, remove the transient latest-order card, and replace oversized open-order controls with compact summaries plus touch-sized edit/cancel icons.
- [x] 6.9 Add reusable tap-first payment and cancellation dialogs: an amount keypad with exact multi-tender allocations, preset cancellation reasons that fill one editable field, and confirmation before either mutation.
- [x] 6.10 Persist split tender as tenant-isolated append-only bill allocations, make cash reconciliation sum only Cash allocations, update shared billing commands and prove exact-sum, idempotency, RLS and generated-type parity.
- [x] 6.11 Redesign open-order cards around complete preparation items, optional customer and prominent total; demote the order number to a reference, regroup actions below the information, reshape the shimmer and verify both themes.
- [x] 6.12 Label references as Order #, hide a same-shift creator, show relative age for today's orders and line amounts; rename payment actions Mark Paid, make Order the primary composer action, and temporarily require customer name or phone in the UI only.
- [x] 6.13 Remove Other from billing and expenses after a zero-row production audit, keep every supported shift total visible at ₹0, make cancellation presets fill an always-editable reason, hand full order editing to the composer without losing its draft, and request a numeric phone keypad.
- [x] 6.14 Make composer editing unmistakable: accent-outline the composer only, take the edited order out of the open list and let its own card travel out of the rail's margin to meet the composer's edge, keeping the card's presentation and its sticky place in the column's scroll, animated on arrival with reduced-motion respected and the docked position independent of the animation. Move the composer footer into that card for the duration of the edit — one instance, no duplicated items or total. Correct the stale composer and bill-panel prose left by 6.3 and 6.8.
- [x] 6.15 Keep all three counter columns at every width: equal current-bill and activity columns with spare width to the menu, horizontal workspace scrolling instead of any column folding away, menu tiles sized against their own column, and the now-duplicate Open orders and My shift navigation entries retired while their routes stay resolvable.
- [x] 6.16 Read item names and prices without decoding them: never truncate an item name, put a menu tile's price at its top right, show Off instead of a price for an unavailable item, and name today as today in a shift's bill list.
- [x] 6.17 Refuse a customer phone that is not one — canonicalised by the shared rule, reported on blur rather than mid-typing, and blocking both terminal actions until corrected or cleared, so a malformed number can no longer reach a bill while the customer record silently fails to save.
- [x] 6.18 Retire the Biller's read-only Menu surface now that the Counter's menu column answers the same question permanently, and remove the code that existed only to serve it — the registry entry, the always-true `canEdit` branch and its read-only copy — recording the lost item description in `docs/LIMITATIONS.md` and keeping the policy-level refusal under test.
