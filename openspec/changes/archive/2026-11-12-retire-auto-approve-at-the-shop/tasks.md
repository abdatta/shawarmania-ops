# Tasks: retire-auto-approve-at-the-shop

The `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`). No gate of
its own, and no migration in the code half. All three keys go together, each
dependant with the gate it depends on.

## 0. Preconditions

- [x] 0.1 The change is archived: `a-check-in-at-the-shop-approves-itself`
  (#81), on the owner's word on 2 November, the pull and the staging try waived.
- [x] 0.2 All three gates are on in production and have stayed on.
  *(`change_gate_events`: on at 12:04 IST on 30 October, nothing since; read
  when this folder was seeded on 2 November.)*
- [x] 0.3 Nothing outside the three depends on them: `refreshed-staff-screens`
  depends on `auto-approve-at-the-shop` and `expense-category-list` on
  `refreshed-staff-screens`, and no other declaration names any of them.
- [x] 0.4 Why now: #82 (`a-deactivated-person-leaves-in-two-steps`) declares two
  gates depending on nothing, and with AA, AM, TK and DO live that would make
  six, one over the limit (owner, 2 November: retire AA's code half first).

## 1. The retirement change — code

- [x] 1.1 Every toggle point keeps its on branch: the check-in goes to
  `attendance_submit_attempt_v3`, live and demo; the outlet page always offers
  its Attendance rules; Home is the Today pass; My attendance and By staff are
  the month calendar; the expense lists have day headings, the You tag and the
  amount-first form with the category tiles; Expense categories opens on the
  owners' list; the demo banner always carries the check-in place switch.
- [x] 1.2 The off path's code goes: the old check-in card (its retry
  confirmation included), the old Home and My attendance, the range day list,
  the typed-category form and the expense row's own date, the expense
  categories adapter's `names()` (live and demo), and the demo's
  `autoApproving` option with the attendance fixtures' gate-off shapes.
- [x] 1.3 The three keys move from `CHANGE_GATES` to `RETIRED_CHANGE_GATES`, and
  out of the demo's gate words.
- [x] 1.4 Tests: the `describeChangeGate` blocks become plain tests of the on
  behaviour (`attendance-rules`, `attendance-at-the-shop`, `staff-screens`,
  `expense-category-list`, `expense-list-layout`); the unit tests that drove the
  old screens without naming a gate now drive the Today pass, the calendar and
  the tiles, and the ones the on path no longer has (the retry confirmation, a
  check-in at the counter waiting, the `names()` request) go. In the browser
  suites the `@cg-off` tests with an on-path twin go and the `@cg-on` tags drop;
  the three `@cg-off` tests that were general (the demo shells' theme and
  viewport matrix, the four-role walk, the deep link) and the signed-in rename
  test were off only for the staff Home's greeting, so they anchor on the Today
  pass instead and run in both suites.
- [x] 1.5 The `attendance-and-location` and `outlet-expenses` deltas; `docs/`
  (BUSINESS_CONTEXT, DATA_MODEL, ROLES_AND_PERMISSIONS, SCREENS) no longer calls
  the behaviour gated.
- [x] 1.6 `npm run lint`, `format:check`, `typecheck`, `contrast`, `test`,
  `build`, `lint:change-gates`; the database and browser suites on Staging.
- [x] 1.7 Release: push to `stage`, Staging green, the owner promotes. The rows
  are left on, so a tablet on an older build keeps the behaviour it has.
  *(`b377929e`..`106dd273` reached production with Deploy `0fe6beed`, 3 November
  07:20 UTC, its Staging run green; ticked on 12 November.)*

## 2. Wait for every tablet

- [x] 2.1 The readiness check (`retire-gate` §2): every registered device on the
  retirement build or later, and three services on it. The staff phones, the
  owner's and the managers' screens carry these toggle points too: their phones
  reload the app before the contract Promote.
  *(Production, read-only, 12 November 10:43 IST: Cafe Laptop, Conti Kitchen and
  Shawarma Kitchen, every registered device, on `8b6a567f`, which contains it.
  Kalyani Cafe has traded eight services since Deploy `0fe6beed` (3 November
  07:20 UTC): 4 to 11 November. An older build left on a person's phone loses
  nothing it needs: with the rows retired it reads the gates off, checks in
  through `attendance_submit_attempt_v2`, which stays, and types a category.)*

## 3. The contract migration

- [x] 3.1 A migration headed `-- release: contract` for each key, EL's first. Re-run
  the reader query in production and on a fresh reset first; on 2 November
  `attendance_submit_attempt_v3(…)` read `auto-approve-at-the-shop` and the policy
  `expense_category_choices.expense_category_choices_select_tablet` read
  `expense-category-list`. Rewrite each to its on branch, then retire the rows.
  *(12 November: the same two readers in production and on a fresh reset, and
  production's v3 body matched the migration's. `20261116000000` (EL: the policy
  keeps its on branch), `20261116010000` (RS: the row), `20261116020000` (AA: v3
  keeps the block and the settle with no gate read). Nothing is dropped. The
  pgTAP files and the REST probe no longer turn the gates: they assert the rows
  retired and the readers gate-free.)*
- [x] 3.2 Every database gate on a fresh reset; release it through the normal
  path.
  *(Promote run 43190557656 moved `main` to `f632cc42`; Deploy run 43190699464
  green at 22:52 IST on 12 November: production lists the migration and the
  row reads retired.)*
