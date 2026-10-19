# Tasks: fixed-costs-are-spread-over-the-month

Read `proposal.md` and `design.md` first. The owners' thirteen decisions and the
rejected alternatives are in the design; do not reopen them without a reason it
did not consider.

**The demo comes first, and the owner approves it before anything is wired live**
(decision 13). Sections 1–5 build the gate, the rules, the table shapes the mocks
are typed from, and every screen in the demo. Section 6 is the checkpoint. Nothing
after it starts until the owner has approved the screens, and **no commit carrying
the migration is pushed to `stage` before then**, so the schema stays editable
while the screens are argued over.

The off path is today's code, untouched: every edit to an existing screen is a new
branch taken only when `useChangeGate('pro-rata-pnl')` is true, and every database
object is new.

## 0. Before anything

- [x] 0.1 Branch from `origin/stage`. Take the next free migration timestamp after
  the newest on `stage` (`20261028000000` when this was written).
- [x] 0.2 Confirm `one-revenue` is declared on `stage`; this gate depends on it.
  Re-check that the code `PR` and the key `pro-rata-pnl` are unused and not
  tombstoned.

## 1. The gate, off

- [x] 1.1 Declare `pro-rata-pnl` in `src/change-gates/gates.ts`: `kind: 'change'`,
  `code: 'PR'`, `change: 'fixed-costs-are-spread-over-the-month'`, `dependsOn:
  ['one-revenue']`, `retireBy` about eight weeks after first turned on,
  `roundTrip: 'tested'`. A doc comment in the file's voice.
- [x] 1.2 Migration `<timestamp>_fixed_costs_are_spread_over_the_month.sql`, first
  statement: the `change_gates` row, off, title *P&L (Pro-rata)*, `on_means` and
  `off_means` word for word from the proposal, `change_name`, `change_number` 79,
  and the dependency on `one-revenue`.
- [x] 1.3 The gate's words in `WORDS` in `src/data-access/mock/change-gates.ts`.
- [ ] 1.4 `npm run lint:migrations`, `npm run lint:change-gates`, and the
  change-gate suite: the row reads back off and depends on `one-revenue`. *The row reads back off; `lint:change-gates` still wants the `@cg-on` and `@cg-round-trip` browser tests of §9, so it stays red until then.*

## 2. The rules, pure (D3–D6)

- [x] 2.1 Failing tests first, then `src/domain/fixed-costs.ts`, integer paise
  throughout and rejecting a non-integer input:
  - `monthCost`: a whole month; a start on the 20th of a 30-day month (11/30,
    floored); a stop on the 12th of a 31-day month; a raise from a later month;
    the latest unvoided settlement winning; a voided one ignored; a month with no
    active date costing nothing.
  - `balance` and `coverage` (FIFO): an advance over two months and over three; a
    withdrawn payment; a corrected amount; *To pay*, *All clear*, *Paid ahead*;
    the unpaid months once ended.
  - `payChoices`: what is owed through the month a payment counts in; the three
    choices each way with the defaults by category; *new monthly amount* withheld
    in a prorated month; exact payment asking nothing; the settlement and amount
    each choice records.
  - `countsInDefault`: last day of the latest earlier month with a balance;
    the day paid for cash and when nothing earlier is owed.
  - `proRata`: spread to today, `unpaid = max(0, spread − covered)`, an earlier
    month's balance excluded, an earlier advance included; covered percentage
    capped at 100%; still to pay; the 18 October case (₹1,89,368 → ₹1,994).
- [x] 2.2 `src/domain/fixed-cost-cases.json`: the cases above as data, read by the
  Vitest suite now and by the pgTAP file in §7.

## 3. The table shapes the mocks are typed from

- [x] 3.1 In the same migration, after the gate row: the four tables of D2 with
  their checks, composite foreign keys, RLS enabled, the policies of *RLS and
  authority*, the no-delete and update-limiting triggers, and the payment link's
  same-outlet trigger. No functions yet. `npm run lint:migrations`.
- [x] 3.2 `npm run db:reset`, `npm run db:types`; check the diff contains only the
  new tables (`db-types-telemetry-noise`).
- [x] 3.3 `FixedCostsAdapter` in `src/data-access/adapters.ts`: list an outlet's
  fixed costs for a month, read one with its months and payments, add, edit the
  amount, stop, pay, drop, undo, and the unpaid count; `OverviewMonth` gains its
  optional `fixedCosts`; the expenses and Ledger month adapters gain the payment
  marks. Types from the generated rows.

## 4. The demo

- [x] 4.1 The mock adapter over the store, folding with `src/domain/fixed-costs.ts`
  so demo and live cannot disagree; fixtures typed from the generated rows.
- [ ] 4.2 The demo outlet's fixed costs (design *Demo*): rent; three salaries (one
  half-paid by a mid-month advance, one paid a month ahead, one joining on the
  20th); electricity settled higher last month; garbage; last month ending with
  one salary unpaid. Fill out the demo's trading days enough that its month reads
  as a shop that trades, and update `the-demo-month-reads-as-a-loss.md`. *Seeded (`seedDemoFixedCosts`). The demo month already reads ₹4.6L of revenue and a P&L (Pro-rata) of ₹3.5L, so the trading days were left alone; the todo is updated with the rest of the docs in §10.*
- [x] 4.3 Turn `pro-rata-pnl` on in the demo's change-gate snapshot, as the
  owner's demo runs every gate it is shown.

## 5. The screens, in the demo (D9)

- [x] 5.1 Registry: `owner-fixed-costs` and `admin-fixed-costs` at
  `ledger/fixed-costs`, state `demo`, no navigation of their own; attention
  `fixed-costs-unpaid` on the Expenses entries, opening the Fixed tab; the source
  in `src/features/attention/sources.ts`.
- [x] 5.1a One Expenses entry, **Daily | Fixed** (decision 15): the tabs for the
  owner and a manager while the fixed-costs surface is renderable, staff's page
  unchanged; Daily's `?date=`; *Recorded on … · View* after Pay.
- [x] 5.1b *Short of covering {Month}* under the Covered bar (decision 14),
  `shortOfCoveringPaise` and its case.
- [x] 5.2 The Fixed costs list in Team's shape, the outlet picker, the total row,
  **Add** with its five fields, the *Stopped* group; its shimmer.
- [x] 5.3 A fixed cost's page: tiles, Months with **Drop** and **Undo**, Payments
  with paid-on and counted-in, **Pay**, **Edit** (from which month), **Stop**
  (with *Clear* or *Keep it* when paid ahead); its shimmer.
- [x] 5.4 The pay sheet: the amount as the Expenses form takes it, Paid on, Counts in (only
  when it applies, forced for cash), Paid with unchosen, note, the three choices
  with their defaults and live figures; Save refused until a choice is taken
  where one is needed.
- [x] 5.5 Gated: Overview's P&L tile (*{Month} P&L (Pro-rata)*, its usual *Expenses ₹X ·
  margin* line with the unpaid share among the expenses); the Ledger's current
  month block, covered bar and Fixed costs group; the Fixed chip and paid-on on
  the Expenses page (owner and manager only) and on the Ledger's month lines.
- [x] 5.6 Unit tests: each screen's figures and words, the choices' defaults, the
  chip's absence on a typed lookalike, the tile and the Ledger reading with no
  fixed cost unchanged; `describeChangeGate('pro-rata-pnl', …)` for every toggle
  point in both states.
- [x] 5.7 Browser, in the demo: phone and tablet widths, light and dark; no
  console errors; the counter's demo expense list makes no new request.

## 6. CHECKPOINT: the owner approves the demo

- [x] 6.1 Send the owner screenshots of the list, a fixed cost's page, the pay
  sheet in each of its choice states, Overview's tile, Needs attention, the
  Ledger's current and past month, and the Expenses chip, at phone width in both
  themes, with a short walk through the demo.
- [x] 6.2 Record the owner's verdict and every change asked for in `design.md`
  (*The owner's demo round*), make them, and repeat until approved. **Stop here
  until the owner says so.**

## 7. The database, live

- [ ] 7.1 In the migration: `fixed_cost_month_cost`, `create_fixed_cost`,
  `settle_fixed_cost_month`, `record_fixed_cost_payment` (its authority check,
  idempotency on `p_id`, the server's recomputation of the choice),
  `fixed_costs_list` (an outlet's fixed costs with their amounts, settlements
  and effective payments, and its business date, in one read: what
  `FixedCostsAdapter.list` returns), `fixed_costs_unpaid` and `overview_month_v2`, each with the grants of *RLS and authority*.
  `npm run lint:migrations`.
- [ ] 7.2 pgTAP: the shared case table against `fixed_cost_month_cost` and the
  balance; a payment counted in last month landing in that month's P&L; a cash
  payment forced to the day paid and moving the drawer's expected cash; a retried
  payment written once; a choice the server computes differently refused; a typed
  lookalike unmarked; `overview_month_v2` equal to `overview_month` plus its
  fixed costs.
- [ ] 7.3 **Isolation, one test per table** (`fixed_costs`, `fixed_cost_amounts`,
  `fixed_cost_settlements`, `fixed_cost_payments`) **and per read**: another
  outlet's Franchise Admin refused by a crafted request; a Biller, an Employee,
  a counter-shift session and anonymous refused; a deactivated owner refused; a
  link to another outlet's expense refused; a Biller calling the pay function
  refused with no expense written; no delete for anyone.
- [ ] 7.4 `npm run db:reset`, `npm run test:db`, `npm run test:rls`,
  `npm run db:types`, and the types diff clean.

## 8. Live

- [ ] 8.1 The Supabase adapter for `FixedCostsAdapter`, the v2 month read on the
  gated Overview path, and the marks read alongside the Ledger month and the
  Expenses day, for the owner and a manager only.
- [ ] 8.2 Registry state `live` for both surfaces; the demo still walks.

## 9. Browser suites

- [ ] 9.1 Demo suite: add a fixed cost, pay part, keep pending, pay the rest; an
  advance across months; a salary paid on the 2nd counted in last month; Needs
  attention appearing and clearing; tagged `@cg-on:pro-rata-pnl` where they assert
  the gated screens.
- [ ] 9.2 Authenticated suite: the same against the local stack, a manager
  refused another outlet's page, a Biller seeing a cash payment without the chip,
  and `@cg-round-trip:pro-rata-pnl` (design D10).
- [ ] 9.3 `e2e-auth/request-budget.spec.ts` green and unchanged: the counter and
  kitchen make no new request.
- [ ] 9.4 The quick gates (`format` first, then `lint`, `format:check`, both
  typechecks, `npm test`, `contrast`, `build`) and the DB job; push to `stage` and
  read the Staging run for the browser suites.

## 10. Docs

- [ ] 10.1 Every page in the proposal's *Docs To Update Before Archive*, and
  `docs/TESTING.md` for the shared case table.

## 11. Release

- [ ] 11.1 Once Staging has published, the owner tries it on the fake outlet.
- [ ] 11.2 After Promote: with the owners, add Kalyani Cafe's fixed costs, each
  starting 1 October, and **withdraw the fifteen placeholder rows of 19
  October** on the Expenses page, so October is not charged twice. Then turn
  `pro-rata-pnl` on (with `one-revenue` already on) and read Overview and the
  Ledger together.
- [ ] 11.3 Pull it once, off and on again, and confirm the round trip on the real
  data.

## 12. PHASE GATE

- [ ] 12.1 The checkpoint in ROADMAP.md row #79 holds, every item checked against
  the running app: the owner approved the demo before it was wired live; fixed
  costs carry over and prorate from a start date and to a stop date; a payment is
  an expense with a chip no typed expense carries, offers its three choices, and
  keeps the day paid apart from the month it counts in; an unpaid month is under
  Needs attention until paid or dropped; Overview and the Ledger's current month
  show P&L (Pro-rata) beside P&L, and past months P&L alone; only the owner and the
  outlet's manager reach any of it; and with the gate off every figure reads as
  it does today.
