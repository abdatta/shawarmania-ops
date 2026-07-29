# Tasks: multi-outlet-people

## 1. Database — the assignments relation

- [x] 1.1 Migration `multi_outlet_people`: create `public.assignments` (person, role, outlet, `started_on`, `ended_on`) with the outlet-matches-role check, the ended-after-started check, both partial unique indexes (D1), and the `(person_id, role) where ended_on is null` lookup index
- [x] 1.2 Same migration: backfill one live assignment per existing profile from its `role` / `outlet_id`, carrying `joined_on` into `started_on` and `left_on` into `ended_on`
- [x] 1.3 Same migration: add `app_is_owner()`, `app_outlets_for(role)`, `app_has_role_at(role, outlet)`, `app_may_manage_person(person)` — all `stable security definer`, granted to `authenticated` only (D2)
- [x] 1.4 Same migration: `assignments` RLS — select (own, owner, manager of an outlet the person is assigned to), insert/update under the self-assignment carve-out (D7), no delete grant; `app_profile_has` rewritten against assignments (D3)
- [x] 1.5 Same migration: translate every policy on outlets, profiles, counter_devices, menu_categories, menu_items, customers, shifts, bills, bill_items, inventory_items, inventory_movements, expenses, attendance, cash_withdrawals, daily_cash_records, alerts, alert_responses, account_invites to membership (D2 table)
- [x] 1.6 Same migration: translate the trigger and function bodies that read claims — `attendance_guard`, `bills_void_only`, `close_business_day`, `outlet_references`, `failed_activation_count`
- [x] 1.7 Same migration: owner's bounded remote writes — `expenses_insert` gains a non-cash owner branch, `inventory_movements_insert` gains a correction-only owner branch (D8)
- [x] 1.8 Same migration: attendance unique constraint becomes `(person_id, outlet_id, business_date)`; `app_person_outlet` retired in favour of the assignment check (D4)
- [x] 1.9 Same migration: retire staff codes — `profiles.staff_code`, its constraints, `profiles_issue_code`, `profiles_code_guarded`, `issue_staff_code`, `staff_code_guard`, `random_staff_suffix`, `outlets.staff_code_prefix` with its constraints, `derive_staff_code_prefix`, the prefix default trigger and `outlet_prefix_guard` (D9)
- [x] 1.10 Same migration: `account_invites.outlet_id` dropped, select policy moved to `app_may_manage_person`; `supersede_invites_on_reassignment` moves from `profiles` to `assignments`
- [x] 1.11 Same migration, last: drop `custom_access_token_hook`, `app_role()`, `app_outlet_id()`, and the `profiles.role` / `outlet_id` / `joined_on` / `left_on` columns with the outlet-matches-role check (D13); unregister the hook in `supabase/config.toml`
- [x] 1.12 Rewrite `supabase/seed.sql`: assignments for every seeded person, one person (`Synthetic Split Shift`) assigned to both outlets with a day worked at each, an owner-recorded non-cash expense and stock correction, no staff codes or prefixes. **Deviation from the plan**: the owner is seeded outlet-less rather than as Kalyani's Franchise Admin — seeding it would let the owner pass every manager branch and quietly weaken the isolation sweeps, so owner-as-manager is granted inside `14_assignments.sql` instead
- [x] 1.13 `npm run db:reset` green, then `npm run db:types` and commit the regenerated `database.types.ts`

## 2. Database tests

- [x] 2.1 `02_isolation_matrix.sql`: `pg_temp.impersonate` sets only `sub`; scope comes from seeded assignments (D12); add the multi-outlet persona sweep (reads both assigned outlets, zero from a third-party filter)
- [x] 2.2 `01_schema_coverage.sql`: classify `assignments` (outlet-scoped) and re-classify `account_invites` (child-scoped, its `outlet_id` gone)
- [x] 2.3 New `14_assignments.sql`: live/ended semantics, one live per person per outlet, self-grant of `super_admin` refused for every role, owner self-granting an outlet role permitted, non-owner self-grant refused, last Super Admin cannot be ended, ended assignment retained and undeletable
- [x] 2.4 `03_status_and_scope.sql`: role/outlet scope restated against assignments; deactivation still immediate; a person with two assignments reads both outlets
- [x] 2.5 `05_write_contract_inventory_cash.sql`: owner correction at an unassigned outlet accepted; owner `added`/`used`/`wasted` refused; day close and withdrawal from the owner path refused; owner-as-manager close accepted
- [x] 2.6 `06_write_contract_attendance_alerts.sql` + `08_geofence.sql`: split-day rows at two outlets accepted, duplicate at one outlet refused; check-in policy accepts an employee at any outlet they are assigned to and refuses one they are not
- [x] 2.7 Expenses write contract: owner non-cash at an unassigned outlet accepted, owner cash refused, manager unchanged
- [x] 2.8 Delete `13_generated_staff_codes.sql`; strip staff-code cases from `09_outlet_and_staff_setup.sql` and `12_required_fields_not_blank.sql`
- [x] 2.9 REST probes: `rls-probes.test.ts` personas rebuilt on assignments plus a two-outlet persona; `generated-staff-codes.test.ts` deleted; `account-flows.test.ts`, `outlet-and-staff-setup.test.ts`, `attendance-adapter.test.ts`, `outlet-deletion.test.ts` updated for the dropped columns

## 3. Edge functions

- [x] 3.1 `_shared/authority.ts`: `Caller` and `TargetAccount` carry assignments; `mayProvision` / `mayManage` / `managesAnyone` re-derived from them, including "a manager may not act on a person assigned outside their outlets"
- [x] 3.2 `admin-accounts`: provision writes the account plus its first assignment in one call; new grant/end-assignment operations with the D7 carve-out enforced server-side as well as in the database; `emails` scoping follows the new `mayManage`
- [x] 3.3 `redeem-invite` unchanged except where it reads dropped columns

## 4. Adapters and session

- [x] 4.1 `adapters.ts`: `Assignment` type; `AccountSummary` gains `assignments` and drops `staffCode` / `joinedOn` / `leftOn` / `outletId`; `NewAccount` carries the first assignment; `AccountsAdapter` gains `grantAssignment` / `endAssignment`; `AttendanceRecord` drops `staffCode`; `NewOutlet` drops `staffCodePrefix`
- [x] 4.2 `session/session.ts`: `Session` gains `assignments`, keeps `role` / `outletId` as derived conveniences (D11); helpers for highest role, outlets for a role, and whether a role is held
- [x] 4.3 `use-real-session.ts`: drop the claim comparison and the `role-changed` end reason; load assignments alongside the profile; the no-assignment state
- [x] 4.4 Supabase adapters: `accounts.ts`, `attendance.ts`, `outlets.ts`, `operations.ts` updated for the dropped columns and the new relation
- [x] 4.5 Mock adapters and `demo-scope.ts` follow the same shape

## 5. UI

- [x] 5.1 `gates/registry.ts` + `routes/`: navigation unions the roles a session holds; a session may render any shell it is assigned for and is redirected from any it is not (D6)
- [x] 5.2 Per-surface outlet selector (`useOutletScope` + `PageHeader scope` slot) for the six outlet-scoped manager surfaces — attendance, expenses, stock, menu, cash, admin home — rendered only for somebody assigned to more than one (D6). The counter's two surfaces are deliberately excluded: an enrolled tablet has one outlet and no second to choose
- [x] 5.3 People surface: assignment list per person, grant and end controls within the caller's authority, the lever board states (D10), staff-code chips and edit fields removed
- [x] 5.4 Check-in card: fence-resolved outlet across assignments, nearest-assigned fallback, the refuse-and-explain case with no reading (D5)
- [x] 5.5 `my-attendance` names each row's outlet; `outlet-attendance` unchanged but re-sourced from assignments
- [x] 5.6 Owner's remote entry, through the surfaces that already exist (owner decision 2026-07-29, option A): `useOutletScope` offers a Super Admin **every** outlet and reports whether they *manage* the one in scope; at an outlet they do not run the expense form drops `cash`, the stock form offers only `correction`, stock-item creation is withdrawn, and the cash surface shows the day but neither closes it nor takes money out — each with the reason on screen rather than discovered by refusal. Reading the other outlet's full lists is deliberate: adding to books you cannot see is a mistake waiting to happen
- [x] 5.7 Outlets surface: staff-code prefix field removed
- [x] 5.8 Component tests updated alongside each surface

## 6. Demo fixtures

- [x] 6.1 `fixtures/accounts.ts` + `personas.ts`: assignments replace role/outlet; a two-outlet person; the owner as Kalyani's manager; the no-assignment and one-assignment-ended states
- [x] 6.2 `fixtures/attendance.ts`: the split-shift person's days at both outlets
- [x] 6.3 `fixtures/operations.ts`: an owner-recorded non-cash expense and stock correction; the trading day still reconciles

## 7. E2E

- [x] 7.1 `e2e/attendance.spec.ts`: the two-outlet person's check-in walk in demo mode
- [x] 7.2 `e2e/setup.spec.ts` + `demo-screens.spec.ts` + `shell.spec.ts`: assignment management, union navigation, no staff codes anywhere
- [x] 7.3 `e2e-auth/auth.spec.ts`: four roles still land correctly with claims gone; the mixed-role person lands on the manager shell

## 8. Docs

- [x] 8.1 `docs/ROLES_AND_PERMISSIONS.md` — assignments replace the role/outlet pair; the capability matrix restated; the owner's bounded remote path; D7's carve-out
- [x] 8.2 `docs/DATA_MODEL.md` — the `assignments` table; columns dropped from `profiles`, `outlets`, `account_invites`; the attendance uniqueness change
- [x] 8.3 `docs/SECURITY_AND_PRIVACY.md` — nothing authority-bearing in the token; membership as the boundary
- [x] 8.4 `docs/SCREENS.md` — union navigation, the per-surface outlet selector, People's assignment management
- [x] 8.5 `docs/GLOSSARY.md` — "assignment" defined; "staff code" removed
- [x] 8.6 `docs/LIMITATIONS.md` — the no-position-several-assignments refusal; the self-assignment carve-out
- [x] 8.7 `docs/OPERATIONS.md` — onboarding steps lose staff codes and gain assignments
- [x] 8.8 `AGENTS.md` + `docs/ARCHITECTURE.md` — the claim-helper description replaced by the membership helpers

## 9. PHASE GATE

- [x] 9.1 **Gate**: a person assigned to two outlets checks in and out at each from their own phone — nothing to switch, the fence works out where they are; every row still records exactly who; a Franchise Admin still cannot reach the other outlet's data, proved by a hand-crafted request; the owner, assigned as manager of one outlet, does that outlet's operational writes there and nowhere else; the owner records a non-cash expense and a stock correction remotely, each visibly the owner's, and anything cash from that path is refused by the database; ending one assignment leaves the person's other assignment and their account untouched; **no staff code exists anywhere in schema or UI**; **nobody grants themselves the owner role and the last Super Admin cannot lose it** (D7 — amended from the seed's "nobody assigns themselves anything"); and the four-role demo walkthrough still walks
