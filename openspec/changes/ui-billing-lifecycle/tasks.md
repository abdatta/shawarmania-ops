## 1. Adapter and demo model

- [ ] 1.1 Replace the settle-only billing adapter shape with typed composer, open-order, payment, customer lookup, shift history, admin history, correction, and recovery contracts derived from generated schema types.
- [ ] 1.2 Extend the shared demo store with direct payment, unpaid/edit/pay/cancel, after-cutoff payment, global repeat customer, late sync, quarantine, and stranded-device transfer.
- [ ] 1.3 Reconcile every demo sales, payment-date cash, owner, history, and daily-cash figure after the fixture expansion.
- [ ] 1.4 Unit-test optimistic versions, same-device ownership, customer autofill decisions, immutable paid correction, cancellation, and demo reset.

## 2. Counter workflow

- [ ] 2.1 Preserve the fast Pay now flow and add Save unpaid without increasing the common payment path beyond its current interaction count.
- [ ] 2.2 Build Open orders for the current device with reopen/edit, stale-version refusal, pay-in-full, and attributed cancellation.
- [ ] 2.3 Show order references before payment and clearly non-official pending references before server numbering.
- [ ] 2.4 Add exact complete-phone lookup, prompted autofill, conflict warning, decline behavior, and automatic new-profile save semantics.
- [ ] 2.5 Build My shift with current-device bills and running totals by payment method only.

## 3. Admin history and recovery

- [ ] 3.1 Build outlet/date/status/payment-filtered bill history and immutable bill detail for FA/SA personal contexts.
- [ ] 3.2 Build reasoned void plus replacement, keeping the original paid bill unchanged.
- [ ] 3.3 Build quarantined-attempt correction/discard so replacement uses a new linked UUID and discard retains actor/reason.
- [ ] 3.4 Build audited stranded-order transfer/cancellation limited to an unavailable or revoked origin device.

## 4. Gates, responsive design, and docs

- [ ] 4.1 Register Counter composer, Open orders, My shift, admin history, and recovery as separate `demo` surfaces with context-correct navigation.
- [ ] 4.2 Verify density, focus order, touch targets, empty/loading/conflict states, and semantic-token contrast on phone and tablet in light and dark themes.
- [ ] 4.3 Update `docs/SCREENS.md`, `docs/DEMO_MODE.md`, `docs/BUSINESS_CONTEXT.md`, and `docs/LIMITATIONS.md`.

## 5. Verification

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`.
- [ ] 5.2 Run the four-role demo walkthrough and prove no demo action touches Supabase and no real user sees the demo-only surfaces.
- [ ] 5.3 PHASE GATE: demo mode walks direct payment and the full unpaid-order lifecycle, exact-phone autofill, current-shift history, immutable correction, quarantine, and stranded-device recovery with all figures reconciled.
