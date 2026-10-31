## 1. The gate

- [x] 1.1 Declare `agreed-part-months` (*AM*) in `src/change-gates/gates.ts`, `roundTrip: 'none: …'`, and its row (off) in migration `20261107000000_part_months_cost_what_was_agreed.sql`
- [x] 1.2 `npm run lint:migrations` and `lint:change-gates` pass

## 2. The money

- [x] 2.1 `src/domain/fixed-costs.ts`: `alreadyPaidIn` and `closingCost` (D2), with cases in `fixed-costs.test.ts`
- [x] 2.2 Migration: `create_fixed_cost_v2`, `update_fixed_cost_v2`, `stop_fixed_cost_v2` (D2–D4), granted to `authenticated` only
- [x] 2.3 pgTAP `supabase/tests/`: Jayanta Da's closing (paid now, paying later, nothing more), a retried stop counts once, a mid-month start settles its first month, another outlet's manager is refused
- [x] 2.4 Adapters: `close`, and `firstMonthPaise` on `add` and `update`, live and mock; mock tests

## 3. The screens (on path; off untouched)

- [x] 3.1 Stop sheet asks for the final payment, Paid now / Paying later; Close {Month} on a stopped cost with an unsettled part month
- [x] 3.2 Add and Edit ask what a mid-month start month comes to
- [x] 3.3 List: no day count, Stopped / Stops date, done rows greyed with no Pay, placement (in the order added: the read lists stopped costs last) and the Stopped · N · Show line
- [x] 3.4 A cost's months: closing / first month with Change; no N of M days
- [x] 3.5 Unit tests with `describeChangeGate('agreed-part-months', …)` in `fixed-costs.test.tsx`
- [x] 3.6 Browser test `@cg-on:agreed-part-months` in `e2e/fixed-costs.spec.ts`: stop with a final payment, and the page reads Stopped with no Stop or Pay

## 4. Verify and release

- [x] 4.1 Quick gates, `test:db`, `test:rls`, types diff clean locally (2026-10-30: the REST suites that call Edge Functions answer 503 on the shared local stack, which serves none; this change touches no function or policy, and Staging runs them)
- [x] 4.2 Pushed to `stage`, Staging green; the owner tries it on the staging outlet (2026-10-31: tried; asked for the round below)
- [x] 4.2a Owner's staging round: stopping closes the cost (`stop_fixed_cost_v3`, migration `20261109000000`): no Paying later, no Nothing more, *Any final payment at close?*, last day today or earlier and last in the sheet, earlier short months closed, a second stop refused; a stopped cost is done at once — greyed, red cross, *Stopped* without a date, no Pay on row or page, *Stopped* in place of Stop; a cost stopped before the change shows Close
- [x] 4.2b Pushed to `stage`, Staging green, and the owner tries the round (2026-10-31: tried; Promoted `e93d97d0`; gate on in production 23:59 IST by `change_gate_force` at the owner's word; Jayanta Da un-stopped by the agent at the owner's word and stopped by the owner: October ₹4,000, all paid)
- [x] 4.2c The owner's production look: the paid ring stays on a stopped row, only greyed (no red cross)
- [ ] 4.2d Pushed to `stage`, Staging green, Promoted
- [ ] 4.3 Promote, then turn `agreed-part-months` on; close Jayanta Da's October with Close (final payment ₹2,000, last day 28 Oct) unless it was closed with Pay first
- [ ] 4.4 Pull once (off and on), real use, then docs (`SCREENS.md`, `DATA_MODEL.md`, `TESTING.md`) and archive after #79
- [ ] 4.5 PHASE GATE: follow-up to #79; no ROADMAP checkpoint of its own — Staging green and the owner's Promote
