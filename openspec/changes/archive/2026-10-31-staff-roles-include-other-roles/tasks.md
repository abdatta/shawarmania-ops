# Tasks: staff-roles-include-other-roles

Read `proposal.md` and `design.md` first. This change gives every existing role
the answer it gets today. **A behaviour test that needs editing is a finding,
not a fix**: stop and say which answer moved. Structural tests that catalogue
tables or count policies are told about the new tables and the twins, each with
a comment (§3.4).

It needs no demo round: nothing on any screen changes.

## 0. Before anything

- [x] 0.1 Branch from `origin/stage` (f0b86000). Migration timestamp
  `20261101000000`. `role-includes` and `RI` are unused and not tombstoned; the
  root gates become four of five.
- [x] 0.2 Re-run the inventory against the live local database rather than the
  migration files: the three `manual_ledger_expenses` policies went with their
  table, and the five billing commands' `'biller'` is a discount source, not a
  role. Design *What names a staff role today* updated.

## 1. The gate, off

- [x] 1.1 `role-includes` (`RI`) in `src/change-gates/gates.ts`, root,
  `retireBy` 2026-11-18, `roundTrip: 'none: …'`.
- [x] 1.2 Migration `20261101000000_staff_roles_include_other_roles.sql`, header
  `-- change-gate: role-includes`, first statement the `change_gates` row, off,
  with the proposal's words. Its words in `WORDS` in the mock.
- [x] 1.3 `npm run lint:migrations` passes.

## 2. Which role includes which

- [x] 2.1 `staff_roles` (Employee, Biller) and `staff_role_includes` (*biller
  includes employee*), RLS on, select for `authenticated`, client writes
  revoked; the loop trigger; `app_role_includes`, `app_acts_as`,
  `app_outlets_acting_as` (D1). A numbered ladder was built first and replaced
  before anything was committed (design decision 5).
- [x] 2.2 pgTAP (`98_staff_roles_include_other_roles.sql` §0): the rows; each
  substitution for every `app_role` value; a loop, a role including itself and
  a manager row refused; the helpers for nine personas at both outlets against
  the role-by-name checks; an ended assignment; a manager not a staff role;
  client writes refused, even the owner's.

## 3. The database objects

- [x] 3.1 The six `_v2` functions of D2, generated from the live bodies with
  every swap asserted to match exactly as often as expected.
- [x] 3.2 The ten gated permissive twins of D3.
- [x] 3.3 pgTAP §1–§2: each twin alone, its original dropped in a
  subtransaction, admits exactly what the original alone admits for nine
  personas (select, insert, update; probes checked to discriminate); with the
  gate off a twin alone admits nobody; each `_v2` returns what its original
  returns per persona, and differs from it in exactly its role lines.
- [x] 3.4 Structural tests told about the change: both tables classified global
  in `01_schema_coverage.sql`; the policy counts in `01`, `21` and `24` count out
  `%_includes`, with a comment that the cleanup removes it.
- [x] 3.5 `npm run db:types`: only the new objects.

## 4. The app

- [x] 4.1 `src/data-access/role-includes.ts` (D7), and `role-includes.test.ts`
  with frozen copies of `STAFF_ROLES`, `isStaffRole`, `highestRole`,
  `reachableRoles` and `personalHeldRoles` checked over every holding at two
  outlets, owner or not; a branching map walked; and the map held to every
  migration's inserts.
- [x] 4.2 `STAFF_ROLES`, `isStaffRole`, `highestRole` (unknown roles never
  land), `reachableRoles`, `personalHeldRoles`, both `ROLE_ORDER`s, Team's
  choices, the demo's roles and the staff home read the map with the gate on,
  and run their old code, restored verbatim, with it off (owner, 2026-10-22).
  The billing mock's role type is now `AppRole`, a type with no runtime.
  `staff-roles.test.ts` now reads the original `attendance_elsewhere(`, as its
  own message asks when the predicate moves.
- [x] 4.3 The toggle points: `onRoleIncludes()` in
  `src/change-gates/role-includes.ts` for the five adapter calls and the session
  and seniority functions; `useChangeGate('role-includes')` in Team, the demo
  banner and the staff home. `role-includes.test.ts` and
  `supabase-adapters/role-includes.test.ts` cover both states with
  `describeChangeGate`; a mutation check shows the two states run different
  code; `e2e-auth/role-includes.spec.ts` covers the on state over the real
  transport.

## 5. The guard

- [x] 5.1 `scripts/check-roles.mjs` (D5) with `check-roles.test.mjs`, in `npm run
  lint` as `lint:roles`, and named in `AGENTS.md` (Tenancy and Verification).
  One allowed line: the demo's ledger personas.

## 6. Verify

- [x] 6.1 Database job on a fresh reset: `test:db`, then `test:rls`. The suites
  that call Edge Functions cannot run on the shared local stack, whose Edge
  container belongs to a deleted worktree; read them from the Staging run.
- [x] 6.2 `npm run format`, lint, `format:check`, both typechecks, `npm test`,
  `contrast`, `build`.
- [x] 6.3 Push to `stage` and read the Staging run: every suite, gates off and
  on, the Edge-dependent suites included. *Staging 39760734883 passed on
  0e9a80d8, all 24 jobs, with the app side still ungated.*
- [x] 6.4 The app side behind the gate (4.2, 4.3), and the explicit read grants
  (`20261101000001_staff_roles_have_explicit_grants.sql`, design *RLS and
  authority*): the gates again, the database job, and a Staging run on that
  commit.
  *(`cf071005` and `84e937df`. Staging 39765471627 on `84e937df` failed a unit
  shard; Staging 39769311920 passed on `aa82e161`, which carries both, and
  Deploy 39820324307 published it on 22 October.)*

## 7. Docs

- [x] 7.1 Every page in the proposal's *Docs To Update Before Archive*:
  Roles And Permissions, Data Model, Architecture, Glossary, and `AGENTS.md`.

## 8. Release

- [x] 8.1 The owner tries a check-in, an expense and a Team change on the fake
  outlet with the gate on.
  *(Waived by the owner on 31 October: production's real use below stands in
  for it.)*
- [x] 8.2 After Promote, at a quiet hour: turn it on, watch a check-in, an
  expense, a Team change and the counter's menu load.
  *(On in production at 19:17 UTC on 22 October and on since, read from
  `change_gate_events` on 30 October. By 31 October Kalyani Cafe had traded
  eight services on it: 420 bills, 54 expenses, 8 check-in attempts and 3
  manager decisions, with nothing reported.)*
- [x] 8.3 Pull it once, or record the owner's waiver.
  *(Waived, 31 October: the owner's rule of 30 October is that a gate whose on
  path has run a while, and which the owner is happy to retire, needs no pull.)*
- [x] 8.4 Record in design D8 whether the owner agrees the cleanup need not wait
  three services. *It waits them (owner, 2026-10-21).*
- [x] 8.5 `retire-role-includes` (the `retire-gate` workflow): code half, then the
  contract migration of D8 once every registered tablet reports the retirement
  build and the counter has traded three services on it. The contract also
  rewrites the three objects of D4, and removes the `%_includes` exclusions from
  `01`, `21` and `24`. Tell #80 the first Waiter may now be made.
  *(Seeded as `openspec/changes/retire-role-includes/`, which carries both
  halves from here; its code half started on 31 October.)*

## 9. PHASE GATE

- [x] 9.1 Every check of what a staff member may do asks which role includes
  which; every existing role gets today's answer, proved by the existing suites;
  a staff role listed by name fails lint in a migration and in the app; a loop
  is refused; with the gate off every check runs as before; and after the
  cleanup, adding a role is a row or two.
  *(Held on 31 October on the suites in both gate states and production use, the
  owner calling the archive. Its last clause, adding a role in a row or two,
  comes true with `retire-role-includes`' contract migration.)*
