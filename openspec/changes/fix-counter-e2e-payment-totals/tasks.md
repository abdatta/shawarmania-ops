## 1. Counter E2E regression

- [x] 1.1 Replace the obsolete positive assertions for counter payment-total hooks with assertions that Cash and UPI totals remain absent from the shared shift rail.
- [x] 1.2 Run the focused browser test in tablet and desktop projects and prove it would fail under the old assertion.

## 2. Verification and phase gate

- [x] 2.1 Run `npm run typecheck` and the affected E2E test file.
- [ ] 2.2 PHASE GATE — the production Deploy workflow's browser gate passes while payment totals remain only in the manager billing-history Totals view.
