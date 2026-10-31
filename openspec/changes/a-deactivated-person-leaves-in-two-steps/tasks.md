# Tasks: A Deactivated Person Leaves in Two Steps

Read `proposal.md` and `design.md` first. Off is today for both gates: the off
path in `accounts-surface.tsx` and `outlet-attendance.tsx` is left untouched,
and new behaviour sits beside it behind `useChangeGate`.

## 1. The gates

- [ ] 1.1 Declare `deactivate-then-leave` (*DL*) and
  `owner-access-in-the-database` (*OD*) in `src/change-gates/gates.ts`:
  `kind: 'change'`, `change: 'a-deactivated-person-leaves-in-two-steps'`,
  `retireBy: '2027-03-31'`, `roundTrip: 'none: …'` with the sentences from the
  proposal's *Change gate*. Neither depends on anything.
- [ ] 1.2 Re-check before writing: no live gate already uses `DL` or `OD`
  (`AM` is the fixed-costs follow-up's). Five gates depending on nothing is the
  limit; if a sixth has landed, stop and tell the owner. Fetch `origin/stage`
  and date the migration after its latest one (`20261110000000` on 2026-10-31);
  never before it, because staging refuses an out-of-order migration.

## 2. Migration `<next free slot>_a_deactivated_person_leaves_in_two_steps.sql`

- [ ] 2.1 `alter table public.profiles add column deactivated_on date;` with a
  column comment (design D2). No default, no constraint, no backfill.
- [ ] 2.2 `mark_account_as_left_v2(uuid, uuid, text)` per design D3: gate check,
  refuse active, refuse an owner while OD is on, `left_on`,
  `greatest(left_on, started_on)`, phone cleared, `deactivated_on` filled if
  null. `set timezone = 'Asia/Kolkata'`, `search_path = ''`. Revoke from
  `public, anon, authenticated`; grant to `service_role`. Comment it.
- [ ] 2.3 Insert both `change_gates` rows, off, with the proposal's title, On
  and Off, change name and number 82.
- [ ] 2.4 `npm run lint:migrations`, `npm run db:reset`, `npm run db:types`;
  check the types diff is only the new column and function (memory: a
  telemetry line can land in `database.types.ts`).

## 3. Database tests (pgTAP)

- [ ] 3.1 A new file after the last numbered one: v2 refuses with the gate off;
  refuses an active account; leaves a deactivated Employee with
  `ended_on = deactivated_on`; ends an assignment started after the
  deactivation on its own start; clears the phone; fills a missing day with
  Kolkata today; refuses a stale fingerprint; refuses a manager for a person
  who also works at an outlet they do not manage; refuses an owner target with
  OD on.
- [ ] 3.2 RLS: a manager reads `deactivated_on` only for people `profiles_select`
  already shows them; another outlet's manager reads nothing (extend the
  existing profiles isolation case rather than adding a table test, since no
  table is new).
- [ ] 3.3 Execute grant: `authenticated` cannot call v2.

## 4. Account function (`supabase/functions/admin-accounts`)

- [ ] 4.1 `set-active`: on `true → false` write `deactivated_on` (Kolkata day,
  computed in the database) with `is_active`; on `false → true` clear it; else
  leave it. Ungated (design D2).
- [ ] 4.2 Old `mark-as-left`: after its RPC succeeds on an account that was
  active, stamp `deactivated_on` the same way. Nothing else changes.
- [ ] 4.3 New action `mark-as-left-v2`: calls v2; then moves the Auth email to
  `<profile-id>@left.shawarmania.invalid`; returns `left_on`; on an already
  left account skips the RPC and retries the move; on a failed move answers
  `left_username_held` (design D3). Add `LEFT_ALIAS_SUFFIX` beside
  `AUTH_ALIAS_SUFFIX` in `shared/username.ts`.
- [ ] 4.4 OD refusals (design D5), each reading
  `app_change_gate('owner-access-in-the-database')` through the service client:
  provision, assign, end-assignment, edit-account (adds or omits a Super Admin
  row), set-active, both mark-as-left actions. Error `owner_access_in_database`,
  403. `set-account-email` unchanged.
- [ ] 4.5 `npm run functions:typecheck` (Deno is at `~/.deno/bin`, off PATH).

## 5. Data access

- [ ] 5.1 `RosterPerson` and `AccountSummary` gain `deactivatedOn: string | null`;
  the people read selects `deactivated_on`.
- [ ] 5.2 `adapter.markAsLeftV2(profileId, fingerprint)` returning `leftOn`, and
  a `DataActionError` message for `left_username_held` and
  `owner_access_in_database`.
- [ ] 5.3 `wasActiveOn(person, businessDate)` beside `wasStaffAtOn` in
  `src/data-access/adapters.ts`, with unit tests: active, deactivated before,
  on and after the day, inactive with no day.
- [ ] 5.4 Mock accounts adapter: stamping, v2 (refusals, dating, phone and
  username cleared), OD refusals, all reading the same gates. Fixture: one
  deactivated Biller, day ten days back, attendance rows before it. Mock
  attendance honours `wasActiveOn` where the live read does.

## 6. Team, `deactivate-then-leave` on (design D4)

- [ ] 6.1 Main list holds active people; deactivated-not-left go to a collapsed
  **Deactivated (n)** table, newest day first; left people are not listed.
  Status *Deactivated · 12 Oct*, or *Deactivated* with no day.
- [ ] 6.2 Deactivated row menu: Edit, Reactivate, Mark as left. Active row menu
  loses nothing but keeps Deactivate.
- [ ] 6.3 Deactivate dialog's new wording; Mark as left dialog naming the day,
  the username and the freed phone; it calls `markAsLeftV2`.
- [ ] 6.4 Edit loses *Leaving the business*.
- [ ] 6.5 Unit tests under `describeChangeGate('deactivate-then-leave', …)`:
  both states, including a manager's list and the off path's *Show people who
  have left* unchanged.

## 7. Team, `owner-access-in-the-database` on (design D5)

- [ ] 7.1 Add person: no Super Admin role, no owner email field.
- [ ] 7.2 Edit: no Owner access section; an existing Super Admin row is carried
  through `intendedAssignments` unchanged.
- [ ] 7.3 An owner's row: no Deactivate, Reactivate or Mark as left.
- [ ] 7.4 Unit tests in both states; the existing *Grant owner access* tests
  stay as they are and run under the off state.

## 8. Edit's outlets (no gate, design D6)

- [ ] 8.1 Owner-only target: no outlets section, no Add outlet, no warning;
  `expanded` no longer opens for an owner target.
- [ ] 8.2 No addable outlet: neither Add outlet nor Works at multiple outlets.
- [ ] 8.3 Unit tests: one-outlet manager editing an Employee; owner editing an
  owner; owner editing a two-outlet manager still gets Add outlet.

## 9. Attendance, `deactivate-then-leave` on (design D8)

- [ ] 9.1 By day: rowless people listed only where `wasActiveOn` holds; a row
  always lists. The deactivated note stays on the day itself.
- [ ] 9.2 By staff: windows capped at `deactivatedOn`; picker keeps deactivated
  people who have not left.
- [ ] 9.3 Manual entry offers outlets only on days `wasActiveOn` holds.
- [ ] 9.4 Unit tests in both states: listed on the day, gone the next, a later
  row still shown, reactivation lists them again.

## 10. Browser tests

- [ ] 10.1 Demo suite, `@cg-on:deactivate-then-leave`: deactivate, see
  Deactivated (n), mark as left, see them gone; By day before and after the
  day. `@cg-on:owner-access-in-the-database`: no owner controls.
- [ ] 10.2 Tag `@cg-off:` on any existing spec the on states contradict
  (Mark as left in Edit, *Show people who have left*, Grant owner access); no
  other edit to them.
- [ ] 10.3 Auth suite: the hand-crafted owner refusals from design D5 as the
  owner's session, with OD on; a manager's v2 leave of a deactivated Employee
  and the username reused by a new provision, with DL on.

## 11. Demo approval

- [ ] 11.1 Run the demo with both gates on; screenshot Team (main list,
  Deactivated open, Mark as left dialog, Edit for an owner, Edit for a
  one-outlet manager) and By day on and after the day, phone width, both
  themes. The owner approves before 6 is wired to the live adapter.

## 12. Docs

- [ ] 12.1 SCREENS (Team; Attendance By day and By staff),
  ROLES_AND_PERMISSIONS (Team table), OPERATIONS (owner access procedure,
  losing access, someone has left), DATA_MODEL (`deactivated_on`, a left
  account), GLOSSARY if needed.

## 13. Verify and push

- [ ] 13.1 `npm run format`, then lint, `format:check`, both typechecks,
  `npm test`, `contrast`, `build`; the database job up to the types diff.
- [ ] 13.2 Squash to 3–5 commits; push `HEAD:stage`; read the run.

## 14. Release

- [ ] 14.1 The owner approves a Promote; both gates reach production off.
- [ ] 14.2 The D7 repair: list production's inactive accounts with no day, with
  last attendance and last sign-in; the owner reviews; write the agreed days in
  one transaction; record the list and statement in `repair.md`.
- [ ] 14.3 `/release owner-access-in-the-database`; pull it once.
- [ ] 14.4 `/release deactivate-then-leave`; check By day and By staff for each
  deactivated person; pull it once.

## 15. PHASE GATE

- [ ] 15.1 The checkpoint in ROADMAP.md row #82 holds, every item checked
  against the running app:
  - the owner approved the Team page's Deactivated section from the demo before
    it was wired live;
  - a deactivated person moves to Deactivated (n), the manager still sees them,
    and Reactivate restores them;
  - Mark as left is offered only there, ends their outlets on the deactivation
    day and frees their username and phone, and a new person can take the
    username;
  - attendance lists a deactivated person through that day and not after, by
    day and by staff;
  - nobody grants or removes owner access, or deactivates an owner, from the
    app, proved by hand-crafted requests;
  - Edit offers no outlets for an owner and no Add outlet where there is
    nowhere to add;
  - with both gates off Team and Attendance read exactly as today;
  - both gates were turned on in production and pulled once;
  - the four-role demo walkthrough still walks.
