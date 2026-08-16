# Tasks: billing-history-two-controls

- [x] 1. Move `PeriodBar` and the day field out of `features/manual-ledger` into
      `components/ui/period-bar.tsx`, behind a test-id prefix, and have the
      ledger import them from there. No behaviour change; the ledger's own tests
      and e2e pass untouched.
- [x] 2. Pure totals for the Status cards in `day-totals.ts`: combined takings
      from the same Cash and UPI figures, and the average bill in integer paise
      with an explicit zero for a day with no paid bills. Unit tests including
      the empty day and the rounding boundary.
- [x] 3. `PaymentTotalCards` carries further cards in the same presentation, so
      the counter's two and the manager's four are one component.
- [x] 4. Billing history: drop the status and payment pickers and their state,
      read the outlet from the shared header selector, read the day from the
      moved day bar, and derive the totals from the one list already read. The
      day and the outlet's today each carry the outlet they belong to, so moving
      outlet cannot leave a frame reading one outlet's day under another's.
- [x] 5. Update the surface test and the e2e that asserted the four-picker grid.
- [x] 6. Gate: `npm run typecheck`, `npx vitest run` (1271 passing),
      `npm run format:check`, `npm run lint`, and the surface driven in the
      browser as both a single-outlet manager and the owner.
