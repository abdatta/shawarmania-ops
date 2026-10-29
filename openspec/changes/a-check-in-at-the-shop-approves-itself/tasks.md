# Tasks: a-check-in-at-the-shop-approves-itself

Read `proposal.md` and `design.md` first. The owner's eleven decisions and the
rejected alternatives are in the design. Do not reopen them without a reason
it did not consider.

**The demo comes first, and the owner approves it before anything is wired
live** (decision 11). Sections 1–5 build the gates, the shapes the mocks are
typed from, and every screen in the demo. Section 6 is the checkpoint. Nothing
after it starts until the owner has approved the screens, and **no commit
carrying the migration is pushed to `stage` before then**, so the schema stays
editable while the screens are argued over.

**The off path is today's code, untouched.** Every edit to an existing screen is
a new branch, taken only when its gate reads on. Every database object is new,
except the one widened check of D4, which the owner agreed to on 2026-10-26.

## 0. Before anything

- [x] 0.1 Branch from `origin/stage`. Take the next free migration timestamp
  after the newest on `stage` (`20261101010000_…` was the newest when this was
  written). *The worktree's HEAD was `origin/stage` (`aa82e161`); the migration
  is `20261103000000_a_check_in_at_the_shop_approves_itself.sql`, after #80's unmerged `20261102…` waiter migrations so the two never share a version.*
- [x] 0.2 Re-check that the keys `auto-approve-at-the-shop` and `refreshed-staff-screens` and
  the codes `AA` and `RS` are unused and not tombstoned. Re-count the
  independent live gates. The design counted four, which leaves room for
  `auto-approve-at-the-shop`; `refreshed-staff-screens` depends on it and does not count.
- [x] 0.3 Read `attendance_submit_attempt_v2`
  (`20261101000000_staff_roles_include_other_roles.sql:166-336`),
  `attendance_evaluate_geofence` (`20260731000001…sql:195-238`) and
  `set_outlet_service_settings` (`20260927000000…sql:84-`). v3 is v2 plus D3,
  and the settings command is #60's shape.

## 1. The gates, off

- [x] 1.1 Declare both in `src/change-gates/gates.ts`:
  - `auto-approve-at-the-shop`: `kind: 'change'`, `code: 'AA'`.
  - `refreshed-staff-screens`: `code: 'RS'`, `dependsOn: ['auto-approve-at-the-shop']`.
  - Both: `change: 'a-check-in-at-the-shop-approves-itself'`, `retireBy` about eight
    weeks after first turned on, and `roundTrip` `none:` with the sentences of
    D10. A doc comment for each, in the file's voice.
- [x] 1.2 Migration `<timestamp>_a_check_in_at_the_shop_approves_itself.sql`. Header
  `-- change-gate: auto-approve-at-the-shop`. First statements:
  - both `change_gates` rows, off, with `on_means` and `off_means` word for word
    from the proposal, `change_name` and `change_number` 81;
  - the `refreshed-staff-screens` → `auto-approve-at-the-shop` dependency row.
- [x] 1.3 The gates' words in `WORDS` in `src/data-access/mock/change-gates.ts`.
- [x] 1.4 Run `npm run lint:migrations`, `npm run lint:change-gates` and the
  change-gate suite: both rows read back off, and `refreshed-staff-screens` depends on
  `auto-approve-at-the-shop`. (`lint:change-gates` stays red until §9's tagged tests
  exist; note it, as #79 did.) *`lint:migrations` green; the rest is run at
  the end of §5.*

## 2. The shapes the mocks are typed from

- [x] 2.1 In the same migration, after the gate rows, the shapes only (no
  functions yet):
  - `outlets.attendance_needs_manager` and `outlets.attendance_blocks_away`,
    `boolean not null default false`, with comments;
  - `alter type public.attendance_decision_kind add value 'auto_approved'`;
  - `attendance_decisions.fence_radius_m integer`, nullable, with a comment.

  Run `npm run lint:migrations`.
- [x] 2.2 Run `npm run db:reset` and `npm run db:types`. *Done at §7.3 (2026-10-29): the hand-edited columns and enum value matched
  the generated ones exactly; the regenerated diff added only v3 and
  `set_outlet_attendance_rules`.* Check the diff holds
  only the new columns and enum value (`db-types-telemetry-noise`). The local
  stack is shared, so re-reset before trusting any later gate.
- [x] 2.3 Adapter contracts in `src/data-access/adapters.ts`:
  - `OutletsAdapter.setAttendanceRules(outletId, { needsManager, blocksAway })`;
  - the `blocked_away` code on `AttendanceActionError` with its sentence
    (D5);
  - `auto_approved` in the decision kind (types from the generated rows).

## 3. The rule, pure

- [x] 3.1 Failing tests first, then a pure `approvesAtShop(reading, outlet,
  otherOutlets, rules)` in `src/features/attendance/`, used by the mock only
  (the database is the authority live). Cases:
  - inside;
  - inside at ±104 m;
  - exactly on the radius;
  - outside;
  - no position;
  - an unsurveyed outlet;
  - inside two fences;
  - *needs manager* on;
  - *blocks away* on, outside and with no position.
- [x] 3.2 `DECISION_LABELS.auto_approved = 'Auto-approved at the shop'`, a
  `?? 'Recorded'` fallback, and no "by" for an actorless decision
  (`evidence.tsx`), with unit tests. This renders whatever the gate (D6).

## 4. The demo

- [x] 4.1 The mock attendance adapter reads `auto-approve-at-the-shop` from the boot
  snapshot, as `role-includes` is read. With it on, `checkIn` uses
  `approvesAtShop`, writes an `auto_approved` decision with
  `fence_radius_m`, honours both settings on the mock outlet, and refuses a
  blocked check-in with the adapter's code and sentence.
- [x] 4.2 The mock outlets adapter stores the two settings and enforces who may
  change them (owner or that outlet's manager), with the live sentences.
- [ ] 4.3 Fixtures with the gate on:
  - the in-fence waiting seeds (`NEAR_COUNTER`, five days ago; Kanchrapara's
    arrival today) become waiting outside or with no position;
  - one recent in-fence day reads *Auto-approved at the shop*;
  - one day is refused under *Block* and then recorded by hand.

  Gate off: the fixtures exactly as today. *Done: `whenAutoApproving` on the
  seeds. Days 1 and 3 and the griller today are approved by the fence; day 5
  waits from down the road; Kanchrapara today waits with no position. Not yet:
  the refused-then-recorded day. It needs Block on at a demo outlet, which is
  left off so the walk starts as production will.*
- [x] 4.4 Turn both gates on in the demo's change-gate snapshot.

## 5. The screens, in the demo

- [x] 5.1 Split `check-in-card.tsx`: the attempt state machine stays; a
  presentational `TodayPass` draws D7, taken only when `refreshed-staff-screens` is on.
  Unit tests for each state:
  - not yet;
  - late, not checked in;
  - approved automatically;
  - waiting (away, needs manager, pre-switch in-fence);
  - outside (recordable, and blocked);
  - no location (denied with its how-to, unavailable, timeout);
  - which outlet;
  - confirm retry;
  - error.
- [x] 5.2 `StaffHome` with `refreshed-staff-screens` on:
  - no greeting title, no *Assigned to…*, no My attendance button;
  - the date heading;
  - the month line from the own-attendance month read: on mount and on
    returning to the foreground, never a timer.
- [x] 5.3 Plain evidence words on the person's own screens (*At the shop*,
  *1.2 km away*, *No location*), the numbers behind **Why?**. The manager's
  roll-call keeps its numbers.
- [x] 5.4 Adaptive sampling in the check-in flow: one `readPosition`, and only
  when outside or worse than ±50 m, `watchBestPosition` for up to 6 s with the
  reading shown tightening. Update `geolocation.ts`'s header to state the
  reversal and its reason. Unit tests with a fake geolocation.
- [x] 5.5 `navigator.permissions.query({ name: 'geolocation' })` up front, where
  supported, to show the denied-permission help before a reading is attempted.
  Guarded and unit-tested where unsupported.
- [x] 5.6 The month calendar (D8): one component for My attendance and By staff;
  each day's state drawn by shape as well as colour (redrawn after the owner's
  first look, 2026-10-26); tapping opens a bottom sheet with the shared evidence
  components; the counts are tiles beside their marks; weekday on every date; Leave reads *Leave*; the
  approval line reads *Approved by Name, time · at the shop* / *away*. Remove
  the subtitles under the three staff headings.
- [x] 5.7 The manager's roll-call and person view: *Auto-approved at the shop · time*
  in place of an approval note, for an `auto_approved` day.
- [x] 5.8 The outlet page's **Attendance** section, in #60's shape:
  - two switches with their one-line state;
  - the unsurveyed warning on *Block*;
  - shown to the owner and that outlet's managers while `auto-approve-at-the-shop` is
    on.
- [x] 5.9 Expenses (D9), wherever `ExpenseList` renders, behind
  `refreshed-staff-screens`:
  - Today / Yesterday / date headings on a multi-day list;
  - the **You** tag;
  - Cash kept;
  - the Add sheet with amount first, then the typed category, then the method
    where it applies, then the note with *What was it for?*;
  - no subtitle.

  Prove that the counter makes no new request.
  *Done. The form reads what it read before, so no new request is made. The
  category buttons first built here were withdrawn after a 28-day production
  replay (design D9). Not yet seen at tablet width on
  the counter: the counter draws the same component, unit-tested; its browser
  check is §9.3.*
- [x] 5.10 Unit tests: `describeChangeGate('auto-approve-at-the-shop', …)` and
  `describeChangeGate('refreshed-staff-screens', …)` for every toggle point, in both
  states. *`attendance-rules.test.ts` (the mock's rule),
  `refreshed-staff-screens.test.tsx` (Home, My attendance, the auto-approved
  line), `refreshed-expense-list.test.tsx`, `outlet-attendance-section.test.tsx`,
  `at-the-shop.test.ts`, and `readCheckInPosition` in `geolocation.test.ts`.
  `demo-safety` and `demo-reset` got the minimal both-state edits #79's
  precedent allows (the demo runs every gate on). Full unit suite: 3,143 run
  and green after those edits.*
- [x] 5.11 Browser, in the demo: phone width (375 px) for the staff screens and
  the outlet page, tablet width for the counter, light and dark, no console
  errors. Screenshots attached, not compared to baselines. *Sixteen states in
  each theme, at 375 px, captured by a scratch Playwright script against the dev
  server with real geolocation emulation. No console errors from the app.*

## 6. CHECKPOINT: the owner approves the demo

- [x] 6.1 Send the owner screenshots at phone width in both themes, with a
  short walk through the demo:
  - Home in each state (approved automatically, waiting, outside recordable, outside blocked,
    location denied, late not checked in);
  - My attendance's month and a day's sheet;
  - By staff;
  - the roll-call with an auto-approved day;
  - the outlet's Attendance section;
  - the staff and counter expense lists and the Add sheet.
- [x] 6.2 Record the owner's verdict and every change asked for in `design.md` →
  *The owner's demo round*. Apply the changes and repeat until approved.
- [x] 6.3 The owner's agreement to the one widened check of D4, recorded in
  `design.md` (2026-10-26, before the demo was built).

## 7. The database, live

- [x] 7.1 In the migration:
  - `set_outlet_attendance_rules(p_outlet, p_needs_manager, p_blocks_away)`
    (security definer, authority re-derived, two columns only), its revoke and
    grant;
  - `attendance_submit_attempt_v3`: v2's body plus D3 — the gate read, the
    block before any write, the arrival unchanged, the settle as a **second**
    update, the two-outlet ambiguity check — with its revoke and grant;
  - the widened `attendance_decision_actor_required`, one statement under its
    `release-lint: allow` line.

  Run `npm run lint:migrations`.
- [x] 7.2 pgTAP `supabase/tests/<n>_a_check_in_at_the_shop_approves_itself.sql`:
  - **counting:** a first-of-day in-fence check-in counts and reads present
    after commit (the trigger trap); an in-fence retry of an outside attempt
    counts; ±104 m at 31 m counts; exactly on the radius counts; one metre
    outside waits; no position waits; an unsurveyed outlet waits; inside two
    assigned active fences waits; *needs manager* waits; late counts and keeps
    its stamped deadline; the decision has no actor and stamps the radius; the
    auto-approved day refuses another check-in;
  - **blocking:** an outside check-in under *Block* is refused and writes
    nothing, and so are no position and an unsurveyed outlet; Record arrival
    still settles a blocked day;
  - **gate off:** v3 behaves as v2 for every case above;
  - **authority:** settings changed by the owner and the outlet's manager;
    refused for another outlet's manager, an Employee, a Biller and a counter
    device; position and radius still refused to a manager; a direct insert of a
    `auto_approved` decision refused;
  - `attendance_correct` corrects an auto-approved day.

  Existing files stay untouched; v1 and v2 tests keep passing.
- [x] 7.3 Run `npm run db:reset`, `npm run test:db`, `npm run test:rls` and
  `npm run db:types`, then check the types diff. *2026-10-29, on a fresh reset:
  pgTAP 98 files, 4,107 tests, green (this change's file: 57). REST: billing
  races, drawer writes, counter telemetry, change gates (with this change's
  probe), ledger timing and dish ticks green. The main REST phase failed
  locally only where the local stack serves no Edge Functions (account flows,
  activation, outlet setup, counter handshake), plus one tablet count and one
  server-clock check left skewed by the earlier phases and a container clock
  about a minute off; none touches this change, and CI's fresh stack runs them.*

## 8. The adapters, live

- [x] 8.1 The toggle point: the check-in calls `attendance_submit_attempt_v3`
  when `auto-approve-at-the-shop` reads on, else today's call, exactly as it is.
  `describeChangeGate` tests in both states.
- [x] 8.2 The error mapping: `check-in away from the shop is blocked here` →
  `blocked_away` with D5's sentence; the settings command's refusals → their
  sentences. The mock answers with the same codes.
- [x] 8.3 `setAttendanceRules` live, through `set_outlet_attendance_rules`.
- [x] 8.4 REST suite (`supabase/tests/rest/`): a hand-crafted check-in 2.6 km
  away under *Block* is refused through PostgREST; a hand-crafted settings
  change by another outlet's manager is refused; an auto-approved day reads back with
  its decision.

## 9. Browser suites

- [x] 9.1 Tag the contradicted specs `@cg-off:auto-approve-at-the-shop` (the only
  edit allowed): `e2e/attendance.spec.ts:79-84, 117-209`. Write `@cg-on` twins
  for counting, waiting away, blocked, and the manager's auto-approved line.
- [x] 9.2 Tag the specs anchored on *Hello, name* `@cg-off:refreshed-staff-screens`:
  - `e2e/attendance.spec.ts:67, 847-850`;
  - `e2e/demo.spec.ts:45, 115`;
  - `e2e/demo-screens.spec.ts:34`;
  - `e2e-auth/auth.spec.ts:25, 30, 450, 486`.

  Write `@cg-on` twins anchored on the Today pass.
- [x] 9.3 An expense `@cg-on:refreshed-staff-screens` spec on the counter tablet and the
  staff phone: headings, You, Cash, amount first.
- [x] 9.4 A `@cg-on:refreshed-staff-screens` spec on a fake clock: check in from away
  at 12:50; recheck still away records nothing and reads *Still not at the
  shop*; recheck at the shop at 13:10 approves the day as late with no
  confirmation, and leaves no button.
- [x] 9.5 `npm run lint:change-gates` green.

## 10. Docs

- [x] 10.1 Every page under *Docs To Update Before Archive* in the proposal,
  plus the code comments named there. Walk all 22 files
  `grep -rlin approv docs openspec/specs` lists for the old rule
  (corrections go to every first-read surface).

## 11. Verify

- [x] 11.1 The quick gates (`npm run format` first): lint, format check, both
  typechecks, `npm test`, contrast, build. Then the database job above, through
  the types diff. *2026-10-29: lint, format, typecheck, contrast, build and
  3,154 unit tests green; the browser suite 344/344 gates off and 354/354 gates
  on, all three projects. The Edge Function typecheck is unaffected (no function
  changed). The auth browser suites need Edge Functions this local stack does
  not serve, so they are left to the `stage` run.*
- [ ] 11.2 Push to `stage`. Read the run for the four browser suites (gates off
  and on) and the request budget. Fix what the log names.
- [ ] 11.3 The owner tries it on the staging fake outlet:
  - an in-fence check-in counts;
  - *Block* refuses from away;
  - the manager records the refused day;
  - the manager turns *needs manager* on and the next check-in waits.

## 12. Release

- [ ] 12.1 The owner approves a Promote. The build reaches the counters with
  both gates off.
- [ ] 12.2 `/release auto-approve-at-the-shop` after the 04:00 cutover and before
  the first arrival (design, *Release*). Watch the next morning's check-ins read
  *Approved* and the waiting badge drop to away days. Pull it once, off and on.
- [ ] 12.3 `/release refreshed-staff-screens` at a quiet hour. Watch the counter's
  expense list through the next service and the staff phones' first check-ins.
  Pull it once.

## 13. PHASE GATE

- [ ] 13.1 The checkpoint in ROADMAP.md row #81 holds, every item checked
  against the running app:
  - the owner approved the demo before it was wired live;
  - an in-fence check-in is approved at once, late or not, with no manager, and an
    away or no-location one waits;
  - *Manager approves every check-in* puts every check-in back in the queue;
  - *Block check-ins away from the shop* refuses away and no-location
    check-ins, proved by a hand-crafted request, and the manager records the day
    instead;
  - only the outlet's managers and the owner change either setting, and only the
    owner the position and radius, proved by hand-crafted requests;
  - an auto-approved day is corrected with one action;
  - with `auto-approve-at-the-shop` off every check-in waits, and with
    `refreshed-staff-screens` off every screen reads as before;
  - both gates were turned on in production and pulled once;
  - the four-role demo walkthrough still walks.
