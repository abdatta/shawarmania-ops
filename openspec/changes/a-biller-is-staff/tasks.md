## 1. Reproduce before fixing

- [ ] 1.1 Pin the app defect first: extend `offers only staff in the by-person picker` in `src/features/attendance/outlet-attendance.test.tsx` to assert `Demo Morning Biller` is offered, and watch it fail. This test asserted only that managers and owners are excluded, so it stayed green throughout the bug.
- [ ] 1.2 Pin the database defect first: add a Biller case to `supabase/tests/18_attendance_elsewhere.sql` asserting that a Biller on the caller's staff list who worked at an out-of-scope outlet is returned, and watch it fail.

## 2. The app: a Biller is staff

- [ ] 2.1 `isStaffAt` in `src/data-access/adapters.ts` admits a live `employee` **or** `biller` assignment, stated as the two roles rather than as "not a manager or an owner" (design D1). Update its docstring, which currently argues for the list while naming one item.
- [ ] 2.2 Confirm the four consumers behave: the roll-call's expected rows, the by-staff picker, the lateness clock (`theirs`), and the manual-entry outlet list in `src/features/attendance/outlet-attendance.tsx`.
- [ ] 2.3 Confirm 1.1 now passes, and that a promoted person's month stays continuous across the ended Employee assignment and the live Biller one.

## 3. The database: the elsewhere answer covers Billers

- [ ] 3.1 Forward migration replacing `public.attendance_elsewhere` with `s.role in ('employee', 'biller')` in its staff-list check. Same signature, `security definer`, `search_path = ''` and grants, so no grant churn (design D2, D4).
- [ ] 3.2 Confirm 1.2 now passes, and that the existing assertions on what the answer withholds — outlet, time, status, evidence, approver, approval — still hold.
- [ ] 3.3 Confirm no policy, grant, column or row was touched by the migration.

## 4. Write the rule down

- [ ] 4.1 `docs/ROLES_AND_PERMISSIONS.md`: the attendance paragraph states the list as "the people holding a live Employee assignment there". Correct it to Employee or Biller and say why a Biller is staff, so the next reader does not have to infer it.
- [ ] 4.2 `docs/ROLES_AND_PERMISSIONS.md`: the `attendance_elsewhere` paragraph inherits the same scope; make its "own outlets' staff lists" explicit about the two roles.

## 5. Prove the correction

- [ ] 5.1 Revert each fix in turn, watch its pinning test fail, restore. Two fixes, two proofs.
- [ ] 5.2 Run `npm run typecheck`, the touched attendance test files, and the pgTAP attendance suite.
- [ ] 5.3 Run `npm run format:check` and `npm run lint`.
- [ ] 5.4 **GATE** — a person holding a live Biller assignment at an outlet appears on that outlet's attendance roll-call and in its by-staff picker exactly as an Employee does, and is reported as accounted-for elsewhere when their day was worked at another outlet. No ROADMAP.md row: this corrects shipped behaviour and sequences no planned capability.
