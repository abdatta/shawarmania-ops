# Tasks: a-sale-taken-on-paper-says-so

No change gate (proposal, *Change gate*; owner, 2026-10-15). No entry screen
(Q5). The work is the database, a script, one mark, and an audit that decides
whether any of it is safe to use in production.

## 1. Audit before anything is written

- [x] 1.1 List every SQL function and view that reads `public.bills` (current
      definitions, not the first migration that created each) and, for each,
      every inner join from `bills` to `counter_devices`, `counter_shifts`,
      `shifts` or `profiles`. Classify each: **money read** (a sum, count or
      figure a screen shows), **shift read** (correct to drop a bill with no
      shift), or **display read** (names a till or biller). Record the table in
      `design.md` under *Version skew*.
- [x] 1.2 List every client read that renders a bill's till, biller or shift
      (Billing history first), and what a published build shows when those are
      null. Record it beside 1.1.
- [x] 1.3 Confirm, by reading the current definitions and one rolled-back call
      each: `bills_stamp_departure_exception` tolerates a null shift;
      `void_billing_bill` accepts an admin voiding a bill with no shift;
      `bill_receipt_deliveries` admits `state = 'skipped'` with a null
      `failure_code`; the drawer's late-arriving exception keys on payment time.
      Where one fails, apply the alternative `design.md` names and record it.
- [x] 1.4 Bring the audit to the owner if any money read drops paper bills and
      cannot be fixed by a `_v2` the new build reads (design, *Version skew*
      step 1). Do not continue past this task without that answer recorded.
      *(2026-10-16: not needed. The audit found no money read that drops a paper
      bill; recorded in design, Version skew.)*

## 2. Database

- [x] 2.1 Failing pgTAP tests first (`supabase/tests/`): the attribution check
      refuses both mismatches; a published-build insert still succeeds;
      `record_paper_bill` refuses a counter tablet, a Biller, an Employee, an
      anonymous caller and a manager naming another outlet; accepts the owner for
      a closed outlet and a manager for their own; refuses a future business
      date, a time outside the stated day, an unknown dish and payments not
      summing to the total; replays the same id and content to the same bill and
      number; refuses the same id with different content; snapshots a stated
      price; takes a 100% discount with its reason.
- [x] 2.2 Failing tests for customers: a paper bill with a valid mobile links the
      customer, earns points at the outlet's rules as of its stated time,
      reverses them on void, cannot spend points, and never reaches
      `bill_receipt_claim`.
- [x] 2.3 Failing tests per money read from 1.1: seed one settled paper bill and
      assert each figure moves by its amount (Overview, the Ledger's day and
      month, Analytics totals, dish figures and hour groupings, the drawer's
      expected cash and its late-arriving exception).
- [x] 2.4 Migration: add `entry_source` (default `'counter'`), `entered_by`,
      `entered_at`; drop `not null` on `counter_device_id` and
      `biller_profile_id`; add `bills_entry_source_attribution` in one statement
      with the `-- release-lint: allow constraint` comment `design.md` gives
      (owner's agreement, Q12). Run `npm run lint:migrations`.
- [x] 2.5 Migration: `record_paper_bill(p_bill_id, p_outlet_id, p_payload)` as designed,
      including the pre-inserted skipped receipt row, and the `_v2` reads 1.1
      requires. Grant execute to `authenticated` only; the function's own
      authority check is the boundary. Run `npm run lint:migrations`.
- [x] 2.6 Isolation: add the manager-names-another-outlet and counter-tablet
      refusals to `test:rls` over HTTP, not only in pgTAP.
- [ ] 2.7 `npm run db:reset`, `test:db`, `test:rls`, `db:types`; inspect the
      generated diff (`counter_device_id` and `biller_profile_id` become
      nullable) and fix every compile error by rendering *Paper*, never by a
      non-null assertion.

## 3. The script

- [x] 3.1 `scripts/paper-sales.mjs` with unit tests: CSV parsing (one row per
      order, time required), UUIDv5 from outlet and order key, dish resolution
      against the outlet's menu, totals in integer paise through the shared
      billing totals, and the dry-run report.
- [x] 3.2 `--commit` signs in with the enterer's own credentials from an
      untracked `.env` and calls `record_paper_bill` once per order, stopping at
      the first refusal with the order key and the database's reason; a rerun
      resumes. `--undo --reason` voids the file's recorded bills. `--target
      staging|production`. It refuses to start if a service-role key is the only
      credential available.
- [x] 3.3 Run it against the local stack with a 200-order fixture file: dry run,
      commit, rerun (nothing added), undo, undo again (nothing changed).
      *(2026-10-16: 200 orders, ₹55,739, recorded in 3.6 s; the rerun found 200
      already recorded and wrote nothing; the undo voided 200; the second undo
      found none.)*

## 4. The mark

- [x] 4.1 Billing history: a paper bill's row reads **Paper** where the till and
      biller are; its detail reads *Entered by <name> · <date>*. Every other
      screen from 1.2 does the same. Component tests for both kinds of bill.
- [x] 4.2 Demo: add a few paper bills to the scenario at one outlet, typed from
      the generated schema, and check the walkthrough reaches them.
- [x] 4.3 Look at Billing history with paper bills on a phone and a tablet
      viewport, light and dark. *(2026-10-16, `/demo` as owner, Kanchrapara three
      days back: two rows read Paper, the timeline reads Entered from paper · Demo
      Manager · 14 Oct, 10:15 am; phone dark, tablet light.)*

## 5. Docs

- [x] 5.1 `docs/OPERATIONS.md`: *A day traded on paper* — the sheet layout to
      ask the stall for, the CSV format, the dry run against the sheet and the
      UPI app, staging then production, the undo, and what to do for a
      counter-down day. Complete enough for an agent to follow alone.
- [x] 5.2 `DATA_MODEL`, `SCREENS`, `ROLES_AND_PERMISSIONS`, `GLOSSARY`,
      `LIMITATIONS`, `BUSINESS_CONTEXT`, as the proposal lists.

## 6. Verify and release

- [ ] 6.1 `npm run format`, then lint, `format:check`, both typechecks,
      `npm test`, `contrast`, `build`; the database job through the types diff.
- [ ] 6.2 Push to `stage`; read the Staging run for the browser suites. On
      staging, record a fake outlet's paper day with the script, read it on
      Overview, the Ledger, Analytics, the drawer and Billing history, and undo
      it.
- [ ] 6.3 Owner Promote. Before the first production entry, confirm every
      device the owner uses runs the promoted build (1.2's display reads).
- [ ] 6.4 PHASE GATE (#77, Wave F): the owner runs the script against a file of
      written orders for an outlet already marked closed, sees the day's totals
      by tender before anything is written, then writes one bill per order;
      each bill reads Paper in Billing history, naming who entered it and when,
      and names no tablet, shift or biller; the bills count in Overview, the
      Ledger, Analytics and the drawer exactly as counter bills do, proved
      against the file's totals; the same file again creates nothing; the undo
      cancels the file's bills; a paper bill carrying a phone earns points and
      sends no SMS; a manager's crafted request for an outlet they do not manage
      and a counter tablet's request are both refused; every revenue read a
      published build calls counts paper bills; and the four-role demo
      walkthrough still walks. Do not archive until the owner has used it on a
      real paper day.
