# Tasks: mock-unwind-test-stays-in-its-day

- [x] 1. Reproduce: with the file's fake clock seeded from a scratch `PROBE_AT` hook (not committed), the test failed at 21:45Z, 22:15Z and 22:29Z (03:15–03:59 IST) with `That payment can no longer be taken back`, and passed at 14:25Z, 19:55Z, 21:00Z, 22:31Z and 23:00Z. The whole file at eleven instants: this is the only hour-dependent case.
- [x] 2. Find the cause: the test advances the payment clock by an hour; from 03:00 IST that crosses the 04:00 cutover, `preparedAtOf` projects the #69 day-change stamp, and the five-minute window has expired. Confirmed against `unpay_billing_order` in `20261009000000_the_day_change_finishes_paid_orders.sql`, which takes its deadline from the same `prepared_at`: the mock answers as the database does, so the fix is test-only.
- [x] 3. Pin the test's clock to 2026-10-13 12:00 IST and name what it proves (*that day*).
- [x] 4. Prove it: the whole file passes at ten start instants including 21:45Z, 22:29Z and 22:31Z; with only the pin removed, the test fails at 21:45Z with the reported refusal.
- [x] 5. `docs/TESTING.md`: a test that lets demo time run for an hour or more pins a start inside one business day.
- [x] 6. GATE: `npm run typecheck`, `npm run format:check`, `npm run lint`, and `npx vitest run src/data-access/mock/billing.test.ts` green locally; CI's Staging run green on the commit once the owner picks the push.
