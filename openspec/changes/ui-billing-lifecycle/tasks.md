## 1. Adapter and demo model

- [ ] 1.1 Replace the settle-only billing adapter shape with typed composer, open-order, payment, customer lookup, shift history, manager history and correction contracts derived from generated schema types.
- [ ] 1.2 Extend the shared demo store with a direct payment, an order taken and paid on handover, an aggregator order collected by a rider, a cancellation with a reason, a bill that is not sent yet, one command needing attention, and a repeat customer found by phone.
- [ ] 1.3 Reconcile every demo sales, payment-date cash, owner, history and daily-cash figure after the fixture expansion.
- [ ] 1.4 Unit-test owning-tablet enforcement, paying an order a manager cancelled, customer autofill decisions, immutable paid correction, cancellation and demo reset.

## 2. Counter workflow

- [ ] 2.1 Preserve the fast Pay now flow and add Save order without adding a step to the common payment path.
- [ ] 2.2 Show the order number on save, large enough to read across a counter, and keep it on the order until it is paid or cancelled, visually unmistakable against a bill number.
- [ ] 2.3 Build Open orders for this tablet with reopen and edit, pay in full by one method including the aggregator methods, and attributed cancellation.
- [ ] 2.4 Report a payment against an order a manager already cancelled as a cancellation, naming who, rather than as a conflict.
- [ ] 2.5 Show plainly when a bill is not sent yet, and never show a bill number before the server assigns one.
- [ ] 2.6 Add exact complete-phone lookup, prompted autofill, conflict warning, decline behaviour, and automatic new-profile save.
- [ ] 2.7 Build My shift with this shift's bills and running totals by payment method only.

## 3. Manager history

- [ ] 3.1 Build outlet, date, status and payment-filtered bill history and immutable bill detail for FA and SA personal contexts.
- [ ] 3.2 Build reasoned void plus re-ring, leaving the original paid bill unchanged.
- [ ] 3.3 Build the outlet's open-order list with a reasoned cancel, which is how a stranded order is cleared. No transfer and no recovery surface exists.
- [ ] 3.4 Build correction and discard for a command needing attention, so a replacement uses a new linked UUID and a discard retains actor and reason.

## 4. Gates, responsive design, and docs

- [ ] 4.1 Register the Counter composer, Open orders, My shift and manager history as separate `demo` surfaces with context-correct navigation.
- [ ] 4.2 Verify density, focus order, touch targets, empty and loading states, and semantic-token contrast on phone and tablet viewports in light and dark themes.
- [ ] 4.3 Reshape the shimmer for every surface whose layout this change alters, in this change.
- [ ] 4.4 Confirm no surface uses the words quarantine, envelope, idempotency, grant or provisional.
- [ ] 4.5 Update `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md` and `docs/LIMITATIONS.md`.

## 5. Verification

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`.
- [ ] 5.2 Run the four-role demo walkthrough and prove no demo action touches Supabase and no real user sees the demo-only surfaces.
- [ ] 5.3 PHASE GATE: demo mode walks direct payment, an order taken, called by number and paid on handover, an aggregator order collected by a rider, exact-phone autofill, this shift's history, a manager's void and re-ring, and a manager clearing a stranded order, with every figure reconciled.
