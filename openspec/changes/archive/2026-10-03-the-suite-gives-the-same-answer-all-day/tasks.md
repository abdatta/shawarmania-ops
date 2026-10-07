## 1. Survey before sweeping

- [x] 1.1 List every `current_date` in `supabase/tests/`. The known spread is at least twelve files, with 42 occurrences in `39_preparing_order_pipeline.sql`, 42 in `05_write_contract_inventory_cash.sql`, 24 in `18_attendance_elsewhere.sql` and 11 in `09_outlet_and_staff_setup.sql`.
  - Found in 34 files before the change. The largest after `39` (42 lines): `05` (42), `26_billing_transaction_contract` (32), `40` (24), `18` (24), `32` (15), `31` and `53` (13 each), `09` and `27` (11 each); the rest carry six or fewer.
- [x] 1.2 Split that list in two: occurrences labelling a row whose business date the guard validates, and occurrences answering an ordinary calendar question. **Only the first group changes.** Record the split in this file so the reviewer can check the judgement rather than re-derive it.
  - **Changed — a guarded row whose date and timestamp came from different clocks, or a "today" built from UTC:** `50`, `51`, `52` (bill labelled `current_date`, stamped `now()`), `39` and `54` (a "yesterday" shift on `current_date - 1` expiring at `current_date + 1` 04:00 IST, which has already passed inside the window).
  - **Left alone — the timestamp is built from the date it is filed under,** e.g. `((current_date - 2) + time '12:15') at time zone 'Asia/Kolkata'` beside `current_date - 2`: consistent by construction at every hour. This is the shape of the remaining guarded fixtures in `05`, `26`, `18`, `27`, `40` and the seed's D-1/D-2 history.
  - **Left alone — not a guarded row:** assignment start dates (`14`, `09`, `15`), expense and inventory dates (`05`, `22`, `42`), invites and account transitions (`07`, `31`), settlement windows (`32`), Overview ranges (`53`).
  - The evidence for the split is the in-window run in 7.2: a calendar-dated label on a clock-stamped guarded row fails in exactly that window, as `50` did, and none of the untouched files failed there.
- [x] 1.3 Confirm which tables the guard actually covers by reading `20260811000001_billing_transaction_contract.sql` rather than assuming — it branches per table on `opened_at`, `check_in_at` and others, and a table absent from that branch is not in scope.
  - `bills` (on `ordered_at` when `app.billing_command` is set, otherwise `created_at`), `shifts` (`opened_at`) and `attendance` (`check_in_at`). `counter_shifts` and `orders` are not guarded.
- [x] 1.4 Reproduce the failure deterministically, off-window, by stamping a fixture row with a timestamp inside the window. If this does not fail at three in the afternoon, the diagnosis in `design.md` is wrong and the rest of this plan is built on it.
  - Reproduced live instead, because the run happened in the window: 2026-09-28 23:04Z, a fresh reset failed exactly the seven files CI's `Deploy` on `bfafdb6` (since squashed into `1e6bca1`) failed at 22:34Z (`03`, `30`, `39`, `50`, `51`, `52`, `54`). The clock-free reproduction is `65_the_guard_holds_either_side_of_the_cutover.sql`: 04:30 IST on the 21st is 23:00 UTC on the 20th, and filing it under the 20th is refused at any hour.

## 2. One way to answer the question

- [x] 2.1 Add a single harness helper that returns the business date for a given instant at a given outlet, delegating to `public.app_business_date` with that outlet's cutover. Every fixture uses it; nothing recomputes the rule locally.
  - The rule lives in one place, `public.app_business_date`, and every changed fixture calls it. The per-file wrapper is `pg_temp.business_today()`, repeated in each file that needs it, because pgTAP files run in separate sessions and share nothing. The wrapper reads the outlet's cutover once while the session is privileged: read per call, it returned null as soon as a test impersonated another outlet's tablet (see `design.md`).
- [x] 2.2 The helper takes **the instant the row is stamped with**, not `now()`. A fixture that asks for "today" separately from the timestamp it writes can still disagree with itself near a boundary, which is the whole bug in miniature.
  - Met the other way round, which the spec now states: the changed fixtures pick the business date first and **build every timestamp from it** (`(pg_temp.business_today() - 1) + time '12:00'`), so date and instant come from one source. `51`'s command-written bill stamps `ordered_at`, `paid_at` and `payment_business_date` from the same instant; the guard reads `ordered_at` there, not `created_at`.

## 3. Fix the fixtures

- [x] 3.1 Convert the guarded occurrences from group 1.2, suite by suite, starting with the three that failed on 2026-09-21: `50_public_bill_receipt_links.sql`, `51_the_public_receipt_reader.sql`, `52_what_the_receipt_says.sql`.
- [x] 3.2 Then `39_preparing_order_pipeline.sql`, whose ten failing subtests — `the unwound bill reads void`, `the order reopens`, `the paid order becomes cancelled history` — name rows the guard checks.
  - Same fault, different mechanism: the rows were consistent, but the shift they ran on expired at `current_date + 1` 04:00 IST, which inside the window is already past. `54_the_ticket_is_two_switches.sql` had the identical shape and got the identical fix.
- [x] 3.3 Then the attendance fixtures, which is where the 2026-09-08 timezone attempt pushed the failures when it moved them off the receipts. They are the evidence that this fix is not the same shape as that one.
  - No change needed: they passed inside the window untouched. They broke on 2026-09-08 only because the session timezone was changed under them; this change leaves the timezone alone.
- [x] 3.4 Leave the unguarded occurrences alone, and say so in the diff. A reviewer should be able to see that the sweep was selective on purpose.
- [x] 3.5 *(Found while applying.)* Compress the seed's intraday timeline into the part of today that exists, so a reset in the first hours after the cutover no longer puts the open shift and its bills on different trading days. Cleared `03 #18` and `30 #5, 6, 8`. Decision and rejected alternatives in `design.md`.
- [x] 3.6 *(Found while applying.)* `43_the_drawer_explains_its_figures.sql` section 5 counts its thirteen bills against what the interval already held, because a compressed seed bill can fall inside it.

## 4. The proof that does not read a clock

- [x] 4.1 Add assertions covering both sides of the cutover from **fixed** timestamps: 03:30 IST with the previous business date, 04:30 IST with the current one, and the mismatched version of each. The matching pairs are accepted; the mismatched pairs are refused.
  - `supabase/tests/65_the_guard_holds_either_side_of_the_cutover.sql`, eight assertions.
- [x] 4.2 Prove these fail when they should: temporarily relax the guard and confirm the mismatched cases start passing. An assertion that has never failed is not yet evidence.
  - With `validate_business_date` replaced by a no-op inside a rolled-back transaction, exactly the four refusal assertions failed (`# Looks like you failed 4 tests of 8`); the real guard was confirmed back in place afterwards.
- [x] 4.3 Confirm they are identical under a session timezone of UTC and of Asia/Kolkata. If the timezone moves the result, the test is reading a clock it should not be.
  - The file runs all four cases under each timezone; all eight pass.

## 5. The end-to-end case with the same shape

- [x] 5.1 The authenticated two-tablet test opens its spare shift with `new Date().toISOString().slice(0, 10)` while the counter uses the outlet business date. Give it the outlet's business date.
  - `e2e-auth/tills.ts` reads the outlet's cutover and dates the shift through `resolveBusinessDate`. Its opening is an hour back **or the cutover, whichever is later**: an hour back in the first hour of a trading day is yesterday, and dating it faithfully reproduced the bug.
- [x] 5.2 Verify the symptom the note records — the spare's payment dialog staying open between the cutover and UTC midnight — is gone, with the clock moved rather than by waiting.
  - Verified live rather than by moving the clock, inside the window: at 23:17Z the old helper failed `billing-two-tablets` on `dialog[open]` still counting 1; at 23:22Z the new one passed.

## 6. Record the consequences

- [x] 6.1 `docs/TESTING.md`: how a time-sensitive fixture picks its business date, and the rule underneath it — a fixture never asks a different clock than the guard does.
- [x] 6.2 Close `openspec/todos/a-local-stack-left-open-across-the-cutover.md`, **leaving the open-stack case behind**: a seeded local stack left across the cutover expires its active shifts, a fresh reset resolves it, it never affects CI, and this change did not take it. Closing the whole note would lose that.
- [x] 6.3 **No roadmap row**, per the rule under "How work enters": `ROADMAP.md` sequences product capability, and test-harness work is not product. Same treatment as `ci-on-deployable-change`. Run `npm run roadmap:sync` and confirm it agrees.
  - `Roadmap status reconciled: 0 row(s) updated. (already in sync)`

## 7. PHASE GATE

- [x] 7.1 **Gate**: the database suite passes with the database's own clock inside the window that currently breaks it — proved by moving the clock, not by waiting for 04:00 IST. No time-sensitive fixture derives a business date from a UTC calendar date. A fixture's business date and its timestamp come from the same instant. The production guard is unchanged, proved by the both-sides assertions still refusing a mismatched pair. The two-tablet test opens its spare shift on the outlet's business date. And a full run inside the window reports the same result as a full run outside it.
  - Every clause is met, locally (7.2) and on the runner (7.4): a full run inside the window reports the same result as one outside it. The window was met by running in it rather than moving the clock. `validate_business_date` is untouched: no migration is in this diff.
- [x] 7.2 Run the full suite twice on the same commit — once with the container clock inside the window, once outside — and record both results here. **Two green runs at the same hour prove nothing**, which is the trap this whole change exists to escape.
  - **Inside**, 2026-09-28 23:41–23:50Z (05:11–05:20 IST), fresh stack, CI's job order run strictly in series: `test:db` 72 files / 2782 tests PASS, `test:rls` all pass, `test:e2e:auth` 34 passed.
  - **Outside**, 2026-09-29 00:00–00:07Z, same commit `2a713b6`, same fresh stack and order: `test:db` 72 files / 2782 tests PASS, `test:rls` all pass, `test:e2e:auth` 34 passed. The same result on both sides of UTC midnight.
- [x] 7.3 `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, `npx openspec validate --strict`, `npm run roadmap:sync`.
  - All pass on 2026-09-28/29, along with `npm run build` and `npm run test:e2e` (284 passed), except `npx openspec validate --strict`, which cannot run: this repo has no `openspec` CLI, and `npm run lint:specs` (in sync) is what stands in for it. Also passing: `functions:typecheck`, `contrast`, `lint:todos`.
- [x] 7.4 Confirm on a real CI run, since the local container and the runner are not the same environment and the 2026-09-21 failure also carried a Docker Hub `toomanyrequests` rate limit that should be checked for separately rather than assumed to be part of this.
  - To prove the window rather than merely pass, the `Deploy` gate has to run inside 22:30–00:00Z: push at about 22:25Z (its database job starts about six minutes after the push), or trigger `Deploy` by hand then. A docs-only push does not run it; `deploy.yml` ignores `docs/**`, `openspec/**` and `*.md`.
  - **Outside the window**: the fix shipped as `4f2e268`, whose `Deploy` passed on 2026-09-29 at 01:56Z with no rate limit.
  - **First attempt inside it, 2026-09-30, `Deploy` on `434cdd3` (failed).** Seed 23:52–23:56Z, pgTAP 23:56:45–23:56:56Z and the REST probes all passed inside the window: the first runner proof of the database half. The auth e2e step then failed one test three times, `billing-served.spec.ts` "two tills seat one table while one is offline": in the first attempt the online till's table-4 order never reached the server and the test timed out; the two retries failed only on the first attempt's leftovers (table 4 already busy, confirm disabled). That attempt ran across 00:00 UTC (its bills read 05:29–05:31 IST). The same commit passed 34/34 locally outside the window minutes later.
  - **Inside the window, 2026-10-03, `Deploy` run `37161386763`, dispatched by hand on `7e6a0dc`: green.** Seed 23:19:36–23:21:15Z, pgTAP 23:21:15–23:21:25Z (74 files, 2939 tests), REST probes to 23:22:22Z, auth e2e 23:22:46–23:27:08Z (34 passed, none flaky), then migrate, functions and deploy. A local serial run of the same job in the same window, 23:16–23:27Z, was also green, the two-tills test included at about 04:54 IST.
