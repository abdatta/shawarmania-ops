## 1. Survey before sweeping

- [ ] 1.1 List every `current_date` in `supabase/tests/`. The known spread is at least twelve files, with 42 occurrences in `39_preparing_order_pipeline.sql`, 42 in `05_write_contract_inventory_cash.sql`, 24 in `18_attendance_elsewhere.sql` and 11 in `09_outlet_and_staff_setup.sql`.
- [ ] 1.2 Split that list in two: occurrences labelling a row whose business date the guard validates, and occurrences answering an ordinary calendar question. **Only the first group changes.** Record the split in this file so the reviewer can check the judgement rather than re-derive it.
- [ ] 1.3 Confirm which tables the guard actually covers by reading `20260811000001_billing_transaction_contract.sql` rather than assuming — it branches per table on `opened_at`, `check_in_at` and others, and a table absent from that branch is not in scope.
- [ ] 1.4 Reproduce the failure deterministically, off-window, by stamping a fixture row with a timestamp inside the window. If this does not fail at three in the afternoon, the diagnosis in `design.md` is wrong and the rest of this plan is built on it.

## 2. One way to answer the question

- [ ] 2.1 Add a single harness helper that returns the business date for a given instant at a given outlet, delegating to `public.app_business_date` with that outlet's cutover. Every fixture uses it; nothing recomputes the rule locally.
- [ ] 2.2 The helper takes **the instant the row is stamped with**, not `now()`. A fixture that asks for "today" separately from the timestamp it writes can still disagree with itself near a boundary, which is the whole bug in miniature.

## 3. Fix the fixtures

- [ ] 3.1 Convert the guarded occurrences from group 1.2, suite by suite, starting with the three that failed on 2026-09-21: `50_public_bill_receipt_links.sql`, `51_the_public_receipt_reader.sql`, `52_what_the_receipt_says.sql`.
- [ ] 3.2 Then `39_preparing_order_pipeline.sql`, whose ten failing subtests — `the unwound bill reads void`, `the order reopens`, `the paid order becomes cancelled history` — name rows the guard checks.
- [ ] 3.3 Then the attendance fixtures, which is where the 2026-09-08 timezone attempt pushed the failures when it moved them off the receipts. They are the evidence that this fix is not the same shape as that one.
- [ ] 3.4 Leave the unguarded occurrences alone, and say so in the diff. A reviewer should be able to see that the sweep was selective on purpose.

## 4. The proof that does not read a clock

- [ ] 4.1 Add assertions covering both sides of the cutover from **fixed** timestamps: 03:30 IST with the previous business date, 04:30 IST with the current one, and the mismatched version of each. The matching pairs are accepted; the mismatched pairs are refused.
- [ ] 4.2 Prove these fail when they should: temporarily relax the guard and confirm the mismatched cases start passing. An assertion that has never failed is not yet evidence.
- [ ] 4.3 Confirm they are identical under a session timezone of UTC and of Asia/Kolkata. If the timezone moves the result, the test is reading a clock it should not be.

## 5. The end-to-end case with the same shape

- [ ] 5.1 The authenticated two-tablet test opens its spare shift with `new Date().toISOString().slice(0, 10)` while the counter uses the outlet business date. Give it the outlet's business date.
- [ ] 5.2 Verify the symptom the note records — the spare's payment dialog staying open between the cutover and UTC midnight — is gone, with the clock moved rather than by waiting.

## 6. Record the consequences

- [ ] 6.1 `docs/TESTING.md`: how a time-sensitive fixture picks its business date, and the rule underneath it — a fixture never asks a different clock than the guard does.
- [ ] 6.2 Close `openspec/todos/database-tests-cross-the-business-cutover.md`, **leaving the open-stack case behind**: a seeded local stack left across the cutover expires its active shifts, a fresh reset resolves it, it never affects CI, and this change did not take it. Closing the whole note would lose that.
- [ ] 6.3 **No roadmap row**, per the rule under "How work enters": `ROADMAP.md` sequences product capability, and test-harness work is not product. Same treatment as `ci-on-deployable-change`. Run `npm run roadmap:sync` and confirm it agrees.

## 7. PHASE GATE

- [ ] 7.1 **Gate**: the database suite passes with the database's own clock inside the window that currently breaks it — proved by moving the clock, not by waiting for 04:00 IST. No time-sensitive fixture derives a business date from a UTC calendar date. A fixture's business date and its timestamp come from the same instant. The production guard is unchanged, proved by the both-sides assertions still refusing a mismatched pair. The two-tablet test opens its spare shift on the outlet's business date. And a full run inside the window reports the same result as a full run outside it.
- [ ] 7.2 Run the full suite twice on the same commit — once with the container clock inside the window, once outside — and record both results here. **Two green runs at the same hour prove nothing**, which is the trap this whole change exists to escape.
- [ ] 7.3 `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, `npx openspec validate --strict`, `npm run roadmap:sync`.
- [ ] 7.4 Confirm on a real CI run, since the local container and the runner are not the same environment and the 2026-09-21 failure also carried a Docker Hub `toomanyrequests` rate limit that should be checked for separately rather than assumed to be part of this.
