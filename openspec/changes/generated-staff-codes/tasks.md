# Tasks: generated-staff-codes

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first.
> Decision references (D1–D8) are to that design.

## 1. The migration

- [x] 1.1 New migration `supabase/migrations/20260728000003_generated_staff_codes.sql`. No staff code changes; `employees_code_not_blank` and `employees_code_unique_per_outlet` untouched. **The number is third of three** — `…0001` belongs to #20 and `…0002` to #19, both of which ship before this. Settled in [#19's design D6](../blank-is-not-a-value/design.md); do not renumber without editing that table.
- [x] 1.2 `outlets.staff_code_prefix` — add **nullable**, backfill `kalyani` → `KAL` and `kanchrapara` → `KAN`, then `set not null`, `unique`, and a check constraining it to three characters of the Crockford alphabet. That order is the only one that works on a table with rows (D4).

  > **Three corrections, all found by running it rather than reading it.**
  >
  > **The backfill named the wrong outlets.** `kalyani` and `kanchrapara` are
  > the *local seed* codes; production's are `skalyani` and `skpa`. A backfill
  > written against either pair alone leaves the other's rows null, and the
  > `set not null` that follows aborts — in production, having passed locally,
  > which is the failure mode #19's design D7 warns about in as many words. The
  > migration now names both pairs explicitly and derives a prefix for anything
  > else, so an outlet it has never heard of cannot block a deploy. **The owner
  > chose `KAL` and `KAN`** (2026-07-28) over the `SKA`/`SKP` derivation would
  > have produced, because they are the place names.
  >
  > **The Crockford constraint contradicted this task.** D4 says three
  > characters of the Crockford alphabet; that alphabet drops `L`; `KAL`
  > contains `L`. The seed failed on it immediately. The two halves of a code
  > are not the same kind of string: the *suffix* is random, so a listener
  > transcribing `7KQ2` has nothing to reconstruct it from and an `O`/`0`
  > confusion loses information — that is what Crockford is for, and
  > `random_staff_suffix()` keeps it. The *prefix* is a fixed abbreviation of
  > the outlet's name that everyone there already knows; nobody spells `KAL`
  > out. Forbidding `L` would ban the natural abbreviation of a real outlet to
  > prevent a confusion that cannot happen. The prefix check is `^[A-Z0-9]{3}$`.
  >
  > **`not null` with no default broke every existing caller.** Two pgTAP files
  > failed at once: any insert that did not supply a prefix now violated the
  > column. Fixed with `issue_outlet_prefix()`, a `before insert` trigger that
  > derives one — the same shape this change already uses for staff codes, and
  > the same reason: it makes “an outlet has a prefix” a property of the table
  > rather than a habit of one caller (D1's argument, applied one level up).
- [x] 1.3 `public.random_staff_suffix()` — four characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, the alphabet already used by [`invite-code.ts`](../../../supabase/functions/_shared/invite-code.ts). Do not invent a second alphabet, and do not use one containing `I`, `L`, `O` or `U` (D3).
- [x] 1.4 `public.issue_employee_code()` — `before insert` trigger function. Return early when a code was supplied; `coalesce(btrim(new.employee_code), '') = ''` is the "not supplied" test, so `null`, `''` and whitespace all mean *issue one* (D2).
- [x] 1.5 Generate `prefix || '-' || random_staff_suffix()`, checking it is not already taken at that outlet, **bounded to ten attempts** and raising a named error if exhausted — a loop that can spin is not acceptable in a trigger (D3).
- [x] 1.6 `public.employee_code_guard()` — `before update` trigger function. Raise when `new.employee_code is distinct from old.employee_code` and `public.app_role() <> 'super_admin'`. Wrap the role check in `if auth.uid() is not null` so seeds and service-role writes still pass, exactly as `attendance_guard()` does in `20260726000007` (D5).
- [x] 1.7 `public.outlet_prefix_guard()` — `before update` trigger function on `outlets`. Raise when `staff_code_prefix` changes and that outlet has any roster row, because every code already issued reads from it (D4).
- [x] 1.8 Attach all three triggers. Name each raised message so an adapter can match it without matching a constraint name.
- [x] 1.9 Update `supabase/seed.sql` for the new `outlets` column, and regenerate database types — `outlets` has a new column, so the generated types change and every mock typed from them must still compile.

  > Both issued columns also gained an **empty-string default**, which is not
  > cosmetic. `supabase gen types` reads column defaults to decide what an
  > Insert may omit and cannot see a trigger, so a `not null` column with no
  > default is typed as **required** — which would have forced every TypeScript
  > caller to invent the very value this change exists to stop them inventing.
  > The defaults are sentinels the triggers always replace, and the check
  > constraints still run afterwards, so one that somehow survived is refused
  > rather than stored.

## 2. Database tests

- [x] 2.1 New `supabase/tests/13_generated_staff_codes.sql` — `11_` belongs to #20 and `12_` to #19 (#19 design D6). `supabase test db` globs the directory, so there is nothing to register.
- [x] 2.2 An insert with no `employee_code` succeeds and the row carries a code matching `^KAL-[0-9A-HJKMNP-TV-Z]{4}$` — assert the *shape*, never a literal value.
- [x] 2.3 An insert at the other outlet carries that outlet's prefix, proving the prefix comes from the row's outlet.
- [x] 2.4 A row inserted with an explicit code keeps it, unchanged (D1).
- [x] 2.5 An insert with `''` and one with `'   '` are both filled rather than refused (D2).
- [x] 2.6 Twenty inserts at one outlet produce twenty distinct codes — the retry path is what this exercises (D3).
- [x] 2.7 Issuing skips a code already taken: pre-insert a row whose code the generator would otherwise be free to pick, and assert no duplicate results.
- [x] 2.8 **A Franchise Admin session updating `employee_code` on a row in their own outlet is refused**, and the row keeps its code (D5).
- [x] 2.9 The same Franchise Admin session successfully updates `full_name`, `role_title` and `employment_status` on that row — the guard is about one column, not the row.
- [x] 2.10 A Super Admin session updates `employee_code` successfully.
- [x] 2.11 Updating a code to blank is still refused, for every role (D2).
- [x] 2.12 Updating a code to one already used at the same outlet raises `23505`; the same value at a *different* outlet is accepted.
- [x] 2.13 A second outlet cannot be created with a `staff_code_prefix` another outlet holds (D4).
- [x] 2.14 Changing an outlet's prefix succeeds while it has no roster rows, and is refused once it has one (D4).
- [x] 2.15 The existing isolation suite still passes unchanged — this change adds no table and alters no policy, and that should be visibly true rather than assumed.
- [x] 2.16 **The seam SQL cannot reach**, in `supabase/tests/rest/generated-staff-codes.test.ts` (11 tests). Added during apply, for one specific reason: `asRosterError` recognises the owner-only refusal by **matching the trigger's message text** — there is no constraint name and no SQLSTATE that distinguishes it from any other `insufficient_privilege`. If PostgREST reformatted or wrapped that message the match would fail silently and a manager would see *“That did not work”* instead of being told the owner has to do it, and nothing below the adapter could catch it because in SQL the message is exactly what was raised. Mutation-tested: breaking the match fails that one test out of 114 and no others. **It also caught a real defect** — `staffCodePrefix` was never wired into the real outlets adapter, so the form's prefix was silently discarded and the database derived its own. The mock handled it, so every component test passed.

## 3. The adapter seam

- [x] 3.1 `src/data-access/adapters.ts` — `NewEmployee.employeeCode` becomes optional.
- [x] 3.2 `EmployeePatch` gains an optional `employeeCode`, so the owner's edit has a path. Note in the type that only a Super Admin may send it and the database is what enforces that.
- [x] 3.3 `src/data-access/supabase-adapters/employees.ts` — `createEmployee` omits `employee_code` from the insert when none was given, rather than sending an empty string; `updateEmployee` writes it when the patch carries it.
- [x] 3.4 `asRosterError` gains a case for the owner-only refusal, phrased as a sentence a manager can act on ("Only the owner can change a staff code."). Keep `code_required` — it is now reachable only by blanking one on edit — and keep `code_taken`.
- [x] 3.5 A comment at the top of the adapter saying the code is issued by a database trigger, because nothing at the call site reveals that (D8 risk).

## 4. The mock

- [x] 4.1 `src/data-access/mock/employees.ts` issues `PREFIX-XXXX` codes of the same shape from the same alphabet (D7). The demo must not teach a product where the field is still asked for.
- [x] 4.2 **Deterministic, not random** — a seeded counter-based generator, no `Math.random()`, so snapshot tests do not flake and a demo walkthrough repeats identically (D7). Follow the existing `nextId` precedent in the same file.
- [x] 4.3 Its `code_required` refusal stops firing on an absent code and fires only where the database's does — a blank supplied on update.
- [x] 4.4 It refuses a code change from a non-owner session, mirroring the trigger, so the demo shows the same boundary the real stack enforces.
- [x] 4.5 The mock reads `staff_code_prefix` from the outlet fixtures rather than hardcoding `KAL`; add the field to those fixtures.

## 5. The Staff surface

- [x] 5.1 `src/features/employees/employee-roster.tsx` — remove the Staff-code field from the **add** path and the `!editing && !draft.employeeCode.trim()` guard at line 193.
- [x] 5.2 On the **edit** path the field stays, enabled for `session.role === 'super_admin'` and disabled otherwise (D6).
- [x] 5.3 Replace the helper text. *"A staff code identifies past records and does not change"* is now false: for the owner it says what changing it does and does not affect; for a manager it says the owner can change it. Neither sentence should read as an error.
- [x] 5.4 Send `employeeCode` in the update patch only when the owner actually changed it, so an ordinary edit by the owner does not trip the guard needlessly.
- [x] 5.5 Surface the two refusals — blank, and already-in-use at this outlet — as sentences on the form.

## 6. The Access surface

- [x] 6.1 `src/features/accounts/accounts-surface.tsx` — remove the Staff-code input (lines 552–566) and the `employeeCode` field from `Draft` and its resets.
- [x] 6.2 Remove the `rosterChoice === 'create' && !draft.employeeCode.trim()` guard at line 211 and its message. The *link them to someone* branch keeps its own "say who" guard — that half of the incomplete-answer scenario survives.
- [x] 6.3 The roster-choice copy no longer promises to ask for a code.
- [x] 6.4 The account-linking dropdown still shows `{employee.fullName} · {employee.employeeCode}` — the disambiguator keeps its job, now with a code the app chose.

## 7. The Outlets surface

- [x] 7.1 The outlet create/edit form gains a **Staff code prefix** field, pre-filled from the outlet code as it is typed — first three alphanumeric characters uppercased, with a numeric suffix if that prefix is taken (D4). Pre-filled, editable, never a blank box.
- [x] 7.2 Say what it is for in one line: it prefixes every staff code at this outlet.
- [x] 7.3 On edit, the field is inert once the outlet has roster rows, and the reason is on screen — codes have already been issued from it. Do not let the owner discover this by being refused.
- [x] 7.4 Surface the "prefix already taken" refusal as a sentence, not a constraint name.
- [x] 7.5 The outlets adapter (real and mock) reads and writes the new column.

## 8. Component tests

- [x] 8.1 Move the code-keyed test IDs to the row id in `employee-roster.tsx` (lines 509, 521, 531) and `outlet-attendance.tsx` (lines 256, 282), and update every test that selects on them (D8).
- [x] 8.2 `employee-roster.test.tsx` — adding a person succeeds with no code entered; the edit field is disabled for a Franchise Admin and enabled for a Super Admin.
- [x] 8.3 `accounts-surface.test.tsx` — provisioning an Employee with *add to the staff list* succeeds without a code; choosing *link to someone* without saying who still refuses.
- [x] 8.4 A test that the owner's code edit reaches the adapter only when the value actually changed (5.4).
- [x] 8.5 An outlets-surface test for the pre-filled prefix and for the field being inert once the outlet has roster rows.
- [x] 8.6 Assert code **shape**, never a literal code, anywhere a test touches an issued one.

## 9. Docs

- [x] 9.1 `docs/DATA_MODEL.md:89` — the `employees` row: how `employee_code` is filled, that it is display-only, and that only the owner changes it. Add `staff_code_prefix` to the `outlets` row.
- [x] 9.2 `docs/SCREENS.md` — the Staff description (line 75), the Access provisioning paragraph (line 81), and the Outlets paragraph (line 97) which now describes one more field.
- [x] 9.3 `docs/OPERATIONS.md` — the onboarding runbook step that tells an admin to add someone "to it with a staff code" (line 106), and the outlet-creation step (line 101) which now mentions the prefix.
- [x] 9.4 `docs/ROLES_AND_PERMISSIONS.md` — the capability matrix gains a *Change a staff code* row: Super Admin only.
- [x] 9.5 Check `docs/GLOSSARY.md` for a staff-code entry and correct it if present. *Searched; there is none. Nothing to correct — recorded so the check is visibly done rather than skipped.*

## 10. Roadmap

> Row #18 was added to the roadmap at propose time. It is deliberately **not**
> a checked box: one checked task derives this change's status as `active`,
> which would claim implementation had begun when none has.

- [x] 10.1 Confirm row #18 still reads Wave B and matches this proposal's banner — the wave letter is authored rather than derived, so `roadmap:sync` never corrects it.
- [x] 10.2 `npm run roadmap:sync` after the last task is checked, so the status cell tracks reality. Never hand-stamp it.

## 11. Verification

- [x] 11.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all green.
- [x] 11.2 The database test suite passes, including the new file and the untouched isolation suite.
- [x] 11.3 `npm run test:e2e:auth` — this change touches provisioning, so the auth end-to-end path must be run rather than assumed.
- [x] 11.4 Run the app: create an outlet, then add a person on Staff in demo mode and in a real session, on a phone viewport, in both themes.

## 12. PHASE GATE

- [x] 12.1 **An admin adds a person to the staff list without being asked to invent anything, the roster shows a readable code the app chose, and a Franchise Admin's attempt to change one is refused by the database rather than by the form** — the last clause proved by a hand-crafted request from a Franchise Admin session, not by observing that the field is disabled.

  > **Walked 2026-07-28, all three clauses.**
  >
  > *Adds without inventing anything*: the Staff form has no staff-code field on
  > the add path at all — confirmed in the running app on a 375px viewport,
  > where adding *Priya Sharma* required only a name.
  >
  > *The roster shows a readable code the app chose*: that row came back
  > `KAL-07QF`, carrying Kalyani's own prefix, sitting legibly beside the
  > seeded `KAL-01`…`KAL-04`.
  >
  > *Refused by the database rather than by the form*: proved twice over, and
  > never by observing a disabled control. In `13_generated_staff_codes.sql` a
  > Franchise Admin session issues a hand-crafted `update` and is refused
  > `42501` with the row's code intact, while the same session still updates
  > `full_name`, `role_title` and `employment_status` — the guard is about one
  > column, not the row. Over REST the same refusal arrives through the real
  > adapter as `code_not_yours`. The disabled field was checked too, but only
  > as the convenience it is.
