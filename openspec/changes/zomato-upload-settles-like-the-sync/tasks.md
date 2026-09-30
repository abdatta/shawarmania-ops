# Tasks: zomato-upload-settles-like-the-sync

## 1. The parser (`supabase/functions/_shared/statement-parser-core.ts`)

- [x] 1.1 Fixtures in `statement-parser.test.ts` built to the measured layout
  (design Context): a paid and an unpaid Kalyani week, each with `HSummary`, an
  `Order Level` sheet with the settlement columns and a full `Customer ID`
  column, and `Addition Deductions Details` carrying a Hyperpure line. Add a TDS
  week too.
- [x] 1.2 Refuse an unpaid week (D1), naming how many orders are pending.
- [x] 1.3 Take the week from the report period and refuse an order outside it
  (D2).
- [x] 1.4 One mapped restaurant per workbook; name an unmapped one; send
  `restaurant_ref` (D3).
- [x] 1.5 Itemise the deduction sheet per D6, and refuse a line still pending.
- [x] 1.6 Reconcile Zomato's totals against the itemised lines before returning,
  and refuse on a difference of more than ₹1 (D4).
- [x] 1.7 Prove the customer column never reaches the payload.

## 2. The Edge Function (`parse-operator-statement`)

- [x] 2.1 Leave an already-reconciled week alone and say whether the file agrees
  (D5).
- [x] 2.2 Return write-contract refusals (`22023`, `42501`) as `422` with their
  message (D7).

## 3. The upload screen

- [x] 3.1 The adapter reads the refusal reason out of the `Response` body (D7),
  with a test.
- [x] 3.2 `describeUpload` words an already-settled week, agreeing or not.

## 4. The sync half (`abdatta/shawarmania-sync`)

- [x] 4.1 `isFinal` / `cyclesToRead`; closed but unpaid weeks go in provisional
  (D8). *Branch `zomato-settles-only-when-paid`, ba102f6; npm test 89/89.*
- [x] 4.2 Rehearse the branch against production, read-only. *Done 2026-09-30,
  run 36706260023: 21-27 Sep provisional, 14-20 and 07-13 Sep settled, ops `ok`.*
- [x] 4.3 Merge to the sync repo's `main` in the owner's deploy window, together
  with this change's deploy. *Done 2026-09-30 (ba102f6, nothing trading until
  10-01); a real run afterwards posted 21-27 Sep provisional and ops said `ok`.*

## 5. Docs

- [x] 5.1 `docs/OPERATIONS.md`, `docs/LIMITATIONS.md`, `docs/SCREENS.md` (per
  proposal).
- [x] 5.2 `openspec/todos/` entry: one deduction identity across the sync and
  the upload (D6).

## 6. PHASE GATE — the checkpoint is this change's own Gate line

- [x] 6.1 `format`, `lint`, `typecheck`, `functions:typecheck`, `test`,
  `contrast`, `build`, `test:e2e`. *Done 2026-09-30 in the worktree: lint and
  format clean, typecheck and `functions:typecheck` clean, plus `deno check` of
  `parse-operator-statement` itself; unit 2125/2125; contrast 64 pairs AA;
  build clean; `test:e2e` 284/284. The database and auth job is left to CI: no
  SQL, policy, migration or generated type changes here.*
- [x] 6.2 Every clause of the Gate line, each proved by a named test.
- [x] 6.3 After deploy: the owner uploads a paid week's workbook and a TO BE PAID
  one; the first reports already settled and matching, the second is refused with
  its reason.
  *Done 2026-09-30 in production from the owner's Edge: 14-20 Sep read "already
  settled at ₹8,467.09 and this file agrees"; 21-27 Sep was refused "Zomato has
  not paid ... 54 of 55 orders are still pending settlement". A database hash
  before and after both was identical. The first attempt exposed D9.*
