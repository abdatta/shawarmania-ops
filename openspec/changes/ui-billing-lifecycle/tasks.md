## 1. Adapter and demo model

- [ ] 1.1 Replace the settle-only billing adapter shape with typed composer, open-order, payment, Pay now Undo, customer lookup, shift history, manager history, originating-tablet correction/discard and read-only manager-diagnostic contracts derived from generated schema types.
- [ ] 1.2 Extend the shared demo store with a direct payment, an order taken and paid on handover, an aggregator order collected by a rider, a cancellation with a reason, a bill that is not sent yet, one command needing attention, and a repeat customer found by phone.
- [ ] 1.3 Reconcile every demo sales, payment-date cash, owner, history and daily-cash figure after the fixture expansion.
- [ ] 1.4 Unit-test owning-tablet enforcement, paying an order a manager cancelled, customer autofill decisions, the guaranteed Pay now Undo, zero-discount commands, immutable paid correction, originating-tablet correction/discard, read-only manager diagnostics, cancellation and demo reset.

## 2. Counter workflow

- [ ] 2.1 Preserve the fast Pay now flow and its six-second guaranteed Undo before delivery, and add Save order without adding a step to the common payment path.
- [ ] 2.2 Show the order number on save, large enough to read across a counter, and keep it on the order until it is paid or cancelled, visually unmistakable against a bill number.
- [ ] 2.3 Build Open orders for this tablet with reopen and edit, pay in full by one method including the aggregator methods, and attributed cancellation; expose no discount control and keep `discount_paise` zero.
- [ ] 2.4 Report a payment against an order a manager already cancelled as a cancellation, naming who, rather than as a conflict.
- [ ] 2.5 Show plainly when a bill is not sent yet, and never show a bill number before the server assigns one.
- [ ] 2.6 Add exact complete-phone lookup, prompted autofill, conflict warning, decline behaviour, and automatic new-profile save.
- [ ] 2.7 Build My shift with this shift's bills and running totals by payment method only.
- [ ] 2.8 Build needs-attention correction and reasoned discard on the originating tablet, using a new linked UUID for a correction and retaining actor, time, reason and the refused trace.

## 3. Manager history

- [ ] 3.1 Build outlet, revenue-business-date, status and payment-filtered bill history and immutable bill detail for FA and SA personal contexts, showing payment time and payment business date when they differ.
- [ ] 3.2 Build reasoned void on the manager phone and instruct that the corrected sale is manually re-rung on the enrolled counter tablet, leaving the original paid bill unchanged and creating no cross-device draft or personal-device billing path.
- [ ] 3.3 Build the outlet's open-order list with a reasoned cancel, which is how a stranded order is cleared. No transfer and no recovery surface exists.
- [ ] 3.4 Show managers read-only, non-identifying delivery diagnostics: counts, age, command type, reference and result category, with no payload, customer details, correction or discard action.

## 4. Gates, responsive design, and docs

- [ ] 4.1 Register the Counter composer, Open orders, My shift and manager history as separate `demo` surfaces with context-correct navigation.
- [ ] 4.2 Verify density, focus order, touch targets, empty and loading states, and semantic-token contrast on phone and tablet viewports in light and dark themes.
- [ ] 4.3 Reshape the shimmer for every surface whose layout this change alters, in this change.
- [ ] 4.4 Confirm no surface uses the words quarantine, envelope, idempotency, grant or provisional.
- [ ] 4.5 Update `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md` and `docs/LIMITATIONS.md`.

## 5. Verification

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`.
- [ ] 5.2 Run the four-role demo walkthrough and prove no demo action touches Supabase and no real user sees the demo-only surfaces.
- [ ] 5.3 PHASE GATE: demo mode walks direct payment and its guaranteed Undo, an order taken, called by number and paid on handover, an aggregator order collected by a rider, exact-phone autofill, this shift's history, originating-tablet correction/discard, a manager void followed by a manual counter re-ring, and a manager clearing a stranded order, with every figure reconciled and no discount control anywhere.
