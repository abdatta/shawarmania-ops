## 1. The command contract, written as failing tests first

- [x] 1.1 Add `supabase/tests/21_attendance_batch_decisions.sql` asserting the whole-set contract against a not-yet-existing `attendance_decide_set`: authority per row, the enrolled-device condition, expected attempt and version per item, atomic refusal, and the 100-item bound.
- [x] 1.2 Extend that file with the approval partition rules: one reading judged per row, reason required only where the row is out of fence or its date has closed, reason stored only on those rows, distances computed server-side and client-supplied distances ignored.
- [x] 1.3 Extend it with the denial rules: shared non-blank reason on every row, shared retry choice against each row's own business date, and no manager position stored for any denial.
- [x] 1.4 Extend it with identity rules: one `command_id` shared by an action's decisions, one decision per person, exact replay settling once, and refusal of a reused command or decision id carrying a changed payload.
- [x] 1.5 Add cross-date and cross-outlet cases: a set spanning two business dates at one outlet, and a set spanning two outlets where the reading is inside one fence and outside the other.
- [x] 1.6 Add tenancy cases proving a hand-crafted set naming another outlet's row is refused entirely, for a single-outlet FA, a multi-outlet FA, an SA holding no assignment, and a person whose assignment ended mid-review.
- [x] 1.7 Run `npm run test:db` and confirm every new assertion fails for the right reason before any migration exists. **Proved by holding the migration back and resetting:** every new assertion failed with `42883: function public.attendance_decide_set(...) does not exist`, and the `command_id` assertions with `column "command_id" does not exist`.

## 2. The migration and the command

- [x] 2.1 Add the forward migration adding nullable `command_id uuid` to `attendance_decisions` with its index, leaving every existing row and the append-only guard untouched.
- [x] 2.2 Implement `attendance_decide_set(p_command_id, p_action, p_items jsonb, p_reason, p_prevent_retry, p_manager_lat, p_manager_lng, p_manager_accuracy_m)` returning `setof public.attendance`, locking selected rows in `attendance.id` order and validating the complete set before appending anything.
- [x] 2.3 Implement the approval path inside it: per-row fence and business-date evaluation from one reading, per-row reason requirement, per-row distance, and the same canonical row updates the single-row command performs today.
- [x] 2.4 Implement the denial path inside it: shared reason, shared retry choice applied per row, no manager position, and the same canonical row updates as today.
- [x] 2.5 Implement replay: match on `p_command_id`, verify actor and whole-payload fingerprint, and return the settled rows without appending a second decision.
- [x] 2.6 Drop `attendance_approve_attempt` and `attendance_deny_attempt`, and set the `revoke from public, anon` plus `grant execute to authenticated` pattern on the new command to match the surviving attendance commands.
- [x] 2.7 Rewrite the assertions in `supabase/tests/19_attendance_denial_retries.sql` and `supabase/tests/rest/attendance-command-races.test.ts` that call the dropped functions, preserving every rule they proved rather than deleting coverage. **Four more files also called them** and are rewritten on the same terms: `06_write_contract_attendance_alerts.sql`, `08_geofence.sql`, `09_outlet_and_staff_setup.sql`, `17_owner_reach.sql` and `rest/rls-probes.test.ts`.
- [x] 2.8 Run `npm run test:db` and `npm run test:rls` until section 1 and the rewritten suites pass, and regenerate types with `npm run db:types`. **1425 database assertions and 202 REST/RLS assertions pass.**

## 3. The adapter seam

- [x] 3.1 Replace the per-row loop in `src/data-access/supabase-adapters/attendance.ts` with one `attendance_decide_set` call, with identities generated once by the caller and reused unchanged on retry.
- [x] 3.2 Give `deny` the same set shape as `approve` in `src/data-access/adapters.ts`, and add a typed stale/conflict error the surface can act on without parsing a message (`isRecoverableSetRefusal`).
- [x] 3.3 Mirror the semantics in the mock adapter, including atomic refusal on stale state, idempotent replay, per-row reason partitioning and the 100-item bound, so demo mode exercises the real contract.
- [x] 3.4 Extend `src/data-access/supabase-adapters/attendance.test.ts` and the REST adapter tests to cover a set, a single-item set, a stale refusal and a replay.

## 4. Selection on the roll-call

- [x] 4.1 Add selection state to `src/features/attendance/outlet-attendance.tsx` on its own row control, leaving the row body's open and close behaviour untouched in and out of selection mode.
- [x] 4.2 Make only currently waiting rows selectable, including off-staff-list waiting rows, with nothing selected on entry and no control that adds more than one person.
- [x] 4.3 Add the sticky action bar with the exact count, `Approve`, `Deny` and `Clear`, and keep the existing per-row Approve and Deny actions working through the same command.
- [x] 4.4 Clear the selection on a successful action, on leaving the day, on an outlet scope change and on cancel. **Carried with the scope key rather than reset in an effect**, so it cannot race the render that reads it.
- [x] 4.5 Remove `POSITION_CACHE_MS`, the per-outlet cached reading map and its scope reset, so every action reads the position fresh.
- [x] 4.6 Cover the selection rules in `outlet-attendance.test.tsx`, including that opening a row does not select it and that no multi-select control exists.

## 5. Reason, confirmation and denial surfaces

- [x] 5.1 Build the approval partition summary grouped by treatment, naming outlets and counts, and stating that the reason reaches only the rows requiring it.
- [x] 5.2 Add the confirmation naming every selected person, their outlet, and their date where the set spans dates, shown only when more than one person is being decided.
- [x] 5.3 Sequence the reason form before the confirmation so the confirmation is always the last step before the write.
- [x] 5.4 Extend the denial form with the shared consequence, naming the count and each row's own business date instead of `today`, and start the shared reason blank where selected attempts carry mixed evidence.
- [x] 5.5 Implement refusal recovery: re-read the day, keep every still-valid selection, drop and name only the rows that changed, and surface no information about rows the reader cannot see.
- [x] 5.6 Invalidate the attention counts once after a successful action, and confirm the nav badge and outlet chips agree with the roll-call afterwards.
- [x] 5.7 Cover the confirmation, the partition summary, the denial wording and refusal recovery in component and accessibility tests, including screen-reader announcement of the selected count (`role="status"` on the count, and on the dropped-rows notice).

## 6. Demo and fixtures

- [x] 6.1 Add coherent demo fixtures for inside-one-outlet-away-from-another, unavailable position, a shared denial, a stale refusal preserving selection, and an off-staff-list waiting row. **No new fixtures were needed and none were invented.** The existing demo already carries two waiting Kalyani rows, one waiting Kanchrapara row and an off-staff-list waiting row, which is every shape these walks need; inside-one/away-one, unavailable position and the shared denial are produced by emulating the position rather than by seeding an outcome. The stale refusal is deliberately not a fixture: staging it would mean seeding a failure into demo mode that nothing in a demo can trigger, so it is proved in `outlet-attendance.test.tsx` against a real refusal instead.
- [x] 6.2 Walk the four-role demo end to end and confirm the trading day still reconciles and no multi-select shortcut exists anywhere on the Employee, Biller, Franchise Admin or Super Admin path.

## 7. Documentation

- [x] 7.1 Update `docs/DATA_MODEL.md` with `command_id` and the set command, and `docs/ROLES_AND_PERMISSIONS.md` with the device condition now required on the write path.
- [x] 7.2 Update `docs/SCREENS.md` with selection mode, the confirmation and the refusal recovery, and `docs/DEMO_MODE.md` with the new fixtures. **`docs/OPERATIONS.md` also carried the retired reuse window** and is corrected in the same pass.
- [x] 7.3 Update `docs/SECURITY_AND_PRIVACY.md` with one reading per action and the retirement of the reuse window, and `docs/TESTING.md` with the new database and component suites.
- [x] 7.4 Record in `docs/LIMITATIONS.md` that GPS accuracy gates nothing and that one imprecise reading can now carry a set of approvals.

## 8. Position-dependent behaviour, proved by emulated position

Geolocation is emulated through Playwright's own `permissions` and
`context.setGeolocation`, never through a test hook in the app, so these specs
drive the same `navigator.geolocation` path a phone takes. Coordinates come from
the outlet fixtures, as `e2e/attendance.spec.ts` already does.

- [x] 8.1 Extend `e2e/attendance.spec.ts`: standing at the counter, a manager selects several waiting people one at a time, confirms the named set, and approves it in one action with no reason asked for.
- [x] 8.2 Add the away case: from outside every selected outlet's fence, the same set requires one reason, and every approved row afterwards shows the approver was not at the outlet and carries that reason.
- [x] 8.3 Add the two-outlet partition case: standing inside one outlet's fence with rows selected at both, assert the summary names which outlet's rows are normal and which need the reason, and assert after the write that the reason reached only the second outlet's rows while each row carries its own computed distance.
- [x] 8.4 Add the unavailable-position case by clearing the emulated position, asserting every selected approval requires the reason and each row records the approver's position as unknown.
- [x] 8.5 Assert in `outlet-attendance.test.tsx`, by counting calls to the mocked `readPosition`, that one action reads the position exactly once however many rows it settles, and that a second action reads again rather than reusing the first reading.
- [x] 8.6 Assert the denial path requests no position at all, for a set of any size, by failing the test if `readPosition` is called. **Proved twice**: in the component suite by call count, and in `e2e/attendance.spec.ts` by asserting no denied row carries a position afterwards.
- [x] 8.7 Add the refusal case: a retry lands mid-action, the set is refused, nothing is settled, the moved person is named and dropped, and the remaining selection settles in one further action. **Proved in the component suite rather than in Playwright**, because a demo page holds its own in-memory state and nothing in a browser walk can move a row underneath the set the same page is building; the component test refuses a real command and asserts the recovery.
- [x] 8.8 Assert no multi-select control exists on the roll-call under any of the banned names, and that opening a row changes no selection. **Asserted in both suites.**

## 9. Full gate

- [x] 9.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:rls`, `npm run contrast`, `npm run build`, and `npm run test:e2e` in both themes at phone and tablet widths, plus `npm run test:e2e:auth`.
- [x] 9.2 Run `npm run roadmap:sync` and confirm the board reflects this change's real state.
- [x] 9.3 PHASE GATE, proved by the suites in sections 1, 2, 6 and 8 rather than by hand: an FA or SA adds each waiting employee by one manual action, with no Select all and no subset shortcut, then approves or denies the explicit set atomically after confirming the named people; one fresh position is judged independently against each selected row's own outlet and date, a common reason reaches only approvals that require it, denial reads no manager position and applies one stated retry choice to all, stale or unauthorised state changes none, every person retains an immutable decision carrying a shared batch identity, and the four-role demo walkthrough still walks.
