## 1. The gate

- [ ] 1.1 Declare `agreed-part-months` (*AM*) in `src/change-gates/gates.ts`, `roundTrip: 'none: …'`, and its row (off) in migration `20261107000000_part_months_cost_what_was_agreed.sql`
- [ ] 1.2 `npm run lint:migrations` and `lint:change-gates` pass

## 2. The money

- [ ] 2.1 `src/domain/fixed-costs.ts`: `alreadyPaidIn` and `closingCost` (D2), with cases in `fixed-costs.test.ts`
- [ ] 2.2 Migration: `create_fixed_cost_v2`, `update_fixed_cost_v2`, `stop_fixed_cost_v2` (D2–D4), granted to `authenticated` only
- [ ] 2.3 pgTAP `supabase/tests/`: Jayanta Da's closing (paid now, paying later, nothing more), a retried stop counts once, a mid-month start settles its first month, another outlet's manager is refused
- [ ] 2.4 Adapters: `close`, and `firstMonthPaise` on `add` and `update`, live and mock; mock tests

## 3. The screens (on path; off untouched)

- [ ] 3.1 Stop sheet asks for the final payment, Paid now / Paying later; Close {Month} on a stopped cost with an unsettled part month
- [ ] 3.2 Add and Edit ask what a mid-month start month comes to
- [ ] 3.3 List: no day count, Stopped / Stops date, done rows greyed with the red cross and no Pay, placement and the Stopped · N · Show line
- [ ] 3.4 A cost's months: closing / first month with Change; no N of M days
- [ ] 3.5 Unit tests with `describeChangeGate('agreed-part-months', …)` in `fixed-costs.test.tsx`
- [ ] 3.6 Browser test `@cg-on:agreed-part-months` in `e2e/fixed-costs.spec.ts`: stop with a final payment, the row reads Stopped and the red cross

## 4. Verify and release

- [ ] 4.1 Quick gates, `test:db`, `test:rls`, types diff clean locally
- [ ] 4.2 Pushed to `stage`, Staging green; the owner tries it on the staging outlet
- [ ] 4.3 Promote, then turn `agreed-part-months` on; close Jayanta Da's October with Close October (final ₹2,000, paid now, 28 Oct) unless it was closed with Pay first
- [ ] 4.4 Pull once (off and on), real use, then docs (`SCREENS.md`, `DATA_MODEL.md`, `TESTING.md`) and archive after #79
- [ ] 4.5 PHASE GATE: follow-up to #79; no ROADMAP checkpoint of its own — Staging green and the owner's Promote
