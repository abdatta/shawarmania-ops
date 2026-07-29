# Tasks: staff-as-accounts

## 1. Database — the merge

- [x] 1.1 Migration `manual_check_in_source`: `alter type public.check_in_source add value 'manual'` in its own file (D8's transaction hazard)
- [x] 1.2 Migration `staff_as_accounts`: add `profiles.staff_code / role_title / joined_on / left_on` with `unique (outlet_id, staff_code)`, not-blank check, and the `left_on >= joined_on` sanity check
- [x] 1.3 Same migration: backfill linked people from their roster rows (code, title, joined_on, terminated → `left_on`); auto-provision `auth.users` + `profiles` for unlinked roster rows with `<uuid>@placeholder.invalid` addresses (mirror seed.sql's insert shape), carrying their staff facts
- [x] 1.4 Same migration: add `attendance.person_id` referencing `profiles (id)` (no cascade), rewrite values via the link map, swap the unique constraint and indexes, drop `employee_id`
- [x] 1.5 Same migration: drop `employees` (policies, triggers, `employee_profile_same_outlet`, `app_employee_outlet`) and the `employment_status` enum; add `app_person_outlet(uuid)`; rewrite the three attendance policies (employee branch `person_id = auth.uid()`, FA/biller via outlet, SA cross-outlet for manual entry)
- [x] 1.6 Same migration: repoint staff-code machinery at `profiles` — issue trigger (person roles with an outlet), code guard (SA-only change, no blanking/nulling an issued code), prefix-freeze predicate now "any profile at the outlet carries a code"; backfill codes for FA accounts that lack one
- [x] 1.7 Same migration: deletion refusal — implementation simplified from design D5's trigger: every FK onto profiles(id) is NO ACTION except the invites cascade, so the keys themselves refuse history-bearing deletes (outlets precedent); a migration-time self-check aborts deploy if a cascade ever appears, and pgTAP proves the refusal. Staff-field column grants + `profiles_update_staff` policy (SA any, FA own outlet)
- [x] 1.8 Migration `manual_attendance_entry`: four `entered_by`/`entered_by_name` columns, manual⇔enterer and manual⇒no-coordinates and not-future constraints, guard v4 (stamp enterer, refuse manual from non-admin sessions, current-business-day rule); geofence needed no change — its denial branch names `phone` and a null distance cannot exceed a radius
- [x] 1.9 Rewrite `supabase/seed.sql`: staff as profiles (keep KAL-E1/KAL-E2 codes for the isolation positive controls), no `employees` inserts, no payroll values anywhere; grillers become accounts (Kalyani's on a placeholder address). A seeded manual check-out was tried and reverted — it collided with 09's "close an open day at a deactivated outlet" proof; manual entries are exercised live in the 06 contract, the demo fixtures and e2e instead
- [x] 1.10 `npm run db:reset` green, then `npm run db:types` and commit the regenerated `database.types.ts`

## 2. Database tests

- [x] 2.1 `02_isolation_matrix.sql`: retarget the employees positive control and cross-outlet inserts at `profiles`/`attendance.person_id`; confirm the catalog sweep still classifies every table
- [x] 2.2 `03_status_and_scope.sql`: employee self-scope via `person_id`; rework "no client can insert/update a profile" for the new staff-field update policy (insert still refused; identity columns still refused)
- [x] 2.3 `06_write_contract_attendance_alerts.sql` + `08_geofence.sql`: re-key on `person_id`; add manual-entry contract cases (enterer stamped and unforgeable, no coordinates, not judged by the fence, future time refused, employee/biller refused)
- [x] 2.4 `09_outlet_and_staff_setup.sql`: delete the link section; add deletion-refusal proofs (delete `auth.users` and `public.profiles` for a person with attendance → refused; fresh account → deletable); departure/deactivation independence cases
- [x] 2.5 `12_required_fields_not_blank.sql`: swap `employees_*` constraints for `profiles_staff_code_not_blank` in the named-completeness list
- [x] 2.6 `13_generated_staff_codes.sql`: rework wholesale against `profiles` (issue, keep-supplied, uniqueness retry, guard, prefix freeze)
- [x] 2.7 `01_schema_coverage.sql`: confirm classification still passes with `employees` gone
- [x] 2.8 REST probes `rls-probes.test.ts`: replace `employees` with `profiles` in the it.each isolation list; update persona expectations (staff codes on profiles, manual-entry denial probes for employee/biller)

## 3. Adapters and data access

- [x] 3.1 `adapters.ts`: fold staff facts into `AccountSummary` (staffCode, roleTitle, joinedOn, leftOn, placeholder-address flag); extend `NewAccount` with roleTitle/joinedOn; delete `EmployeesAdapter`, `EmployeeSummary`, `NewEmployee`, `EmployeePatch`, `LinkedAccount`, `EmploymentStatus`; attendance types move to `personId`/`staffCode`/`personName` and gain `enteredBy`/`enteredByName` + `'manual'` source; add `recordManualEntry` and `updateStaffFacts` methods
- [x] 3.2 Supabase adapters: `accounts.ts` reads/writes the new profile columns (staff-fact updates as the admin's own session); `attendance.ts` joins `profiles` instead of `employees`; delete `supabase-adapters/employees.ts`; translate the new refusal messages
- [x] 3.3 `admin-accounts` edge function: `provision` accepts roleTitle/joinedOn, drops every roster concern; `emails` unchanged; restart the edge runtime container when testing
- [x] 3.4 Mock adapters: delete `mock/employees.ts`; accounts mock carries staff facts and placeholder-address state; attendance mock re-keys to account ids and implements manual entry with enterer stamping

## 4. Demo fixtures

- [x] 4.1 `fixtures/accounts.ts` restated per D10: staff codes/titles/dates on accounts; Demo Helper → placeholder address; Demo Former Staff → departed; one deactivated-not-departed person; Demo Griller → ordinary active; delete `fixtures/employees.ts`
- [x] 4.2 `fixtures/attendance.ts` re-keyed to account ids, blocked/overridden/normal days preserved, plus one manually entered event; `fixtures.test-d.ts` retyped against the regenerated schema
- [x] 4.3 `DemoData`/`createMockAdapters` drop the employees slot; demo store consistency checks still construct; trading day still reconciles

## 5. UI — one People surface

- [x] 5.1 `accounts-surface.tsx` becomes People per D9: one-step create (roleTitle/joinedOn fields, no roster radios), staff facts in the list, placeholder-address badge, edit-staff-facts sheet, mark-departed confirm (deactivation pre-checked), return, departed toggle; `Select` primitive replaces the inline selects
- [x] 5.2 Delete `employee-roster.tsx` (+ its test); gate registry: remove `owner-employees`/`admin-employees`/`counter-attendance-kiosk`, rename FA `admin-people` nav to "People"; remove the `employees` route from `surfaces.tsx`
- [x] 5.3 `outlet-attendance.tsx`: people list from accounts (person roles, current, deactivated included); manual-entry sheet (person, in/out, past time on today's business day); manual events render "entered by <name>" via the evidence components
- [x] 5.4 Employee surfaces: `use-own-attendance.ts` reads by own account id, `no-roster` state deleted from hook/`staff-home`/`my-attendance`; check-in card untouched otherwise
- [x] 5.5 Component tests updated alongside each surface (accounts-surface, outlet-attendance, staff-home, use-own-attendance)

## 6. E2E

- [x] 6.1 Rewrite `e2e/setup.spec.ts` as the one-step people walk (create → code panel → on the list; unfinished states readable); update `e2e/attendance.spec.ts` for manual entry + the removed `employees` route; sweep remaining specs for `demo/*/employees` navigations
- [x] 6.2 `e2e-auth`: update landing/nav assertions (Staff nav gone, People renamed), employee no-roster assertions removed, staff-code expectations from profiles

## 7. Verification

- [x] 7.1 Non-Docker gates: `npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run contrast`, `npm run build`, `npm run test:e2e`
- [x] 7.2 Docker gates: `npm run db:reset`, `npm run test:db`, `npm run test:rls`, `npm run test:e2e:auth` — all green, types drift-free
- [x] 7.3 Walk the change's Gate line clause by clause and record which test or action proves each
- [x] 7.4 PHASE GATE — Wave D `staff-as-accounts` (#21): staff exist only as accounts; attendance survives attributed; deactivation ≠ departure; deletion with history refused by the database; no payroll anywhere; manual entry attributed; the four-role demo walkthrough walks and the trading day reconciles
