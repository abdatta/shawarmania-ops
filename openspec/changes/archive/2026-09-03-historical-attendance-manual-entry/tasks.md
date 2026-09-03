## 1. Pin the present restriction and desired past flow

- [x] 1.1 Preserve the observed before-state evidence: on today's derived-absent
  card the rendered button is **Record arrival** and opens the time-only **Record
  an arrival** sheet, while the equivalent past card omits it.
- [x] 1.2 Change the existing component assertion that pins “past day must not”
  into a positive test that fails before implementation: the past card offers
  the same button, the sheet names the selected date, submission settles one
  manual-present row, and the manager/no-GPS evidence is visible.
- [x] 1.3 Add negative component cases for before-assignment dates, working
  elsewhere, existing arrivals and future navigation so the new action appears
  only on a genuine eligible derived absence.

## 2. Expand the guarded database command

- [x] 2.1 Add one forward migration replacing
  `attendance_record_manual(uuid, uuid, uuid, uuid, date, timestamptz)` without
  changing its signature, return type, grants, empty search path, actor-derived
  authority, command ids, fingerprint or append-only transition.
- [x] 2.2 Accept current-or-past named business dates, refuse future dates and
  instants, and require `p_attempted_at` to resolve to `p_business_date` under
  the target outlet's cutover.
- [x] 2.3 Require the subject to hold both a live Employee/Biller assignment
  making them current visible staff and an Employee/Biller assignment window at
  that outlet covering the named historical date; keep the actor a currently
  authorised Super Admin or Franchise Admin at that outlet.
- [x] 2.4 Preserve one person-day across outlets, exact replay behavior,
  database-stamped enterer/actor, no coordinates, stamped deadline and immediate
  settlement as `manual_present`.

## 3. Prove time, assignment and tenancy boundaries in the database

- [x] 3.1 Add a rolled-back pgTAP case that records a historical derived absence
  and asserts the explicit date, asserted instant, manual source, actor/enterer,
  decision time, no GPS, settled present status and exactly one attempt/decision.
- [x] 3.2 Prove future business date, future instant and mismatched
  cutover/business-date instant each refuse without partial rows.
- [x] 3.3 Prove before-start and after-end assignment dates, a person who is no
  longer current visible staff, another outlet, Employee, Biller device and
  forged enterer inputs are refused or overwritten as appropriate.
- [x] 3.4 Prove an existing person-day at another outlet and concurrent/changed
  command identity cannot create a second row, while exact replay stays one
  immutable sequence.
- [x] 3.5 Exercise the unchanged RPC payload through PostgREST against the reset
  database for one accepted historical entry, so TypeScript payload assertions
  are not mistaken for database acceptance.

## 4. Make the existing UI and adapters date-aware

- [x] 4.1 Add a shared staff-assignment-window predicate over `AccountSummary`
  and use it to assemble a manager day only from selected outlets where that
  person was Employee/Biller staff on the selected business date.
- [x] 4.2 Remove the today-only `offerManual` condition while retaining off-list,
  existing-row and working-elsewhere exclusions; pass only historically eligible
  outlets into the existing sheet.
- [x] 4.3 Make `ManualEntrySheet` state the selected business date and retain the
  exact **Record arrival**, arrival-time and **Record it under my name** process
  for both current and past dates.
- [x] 4.4 Update the adapter contract comments and refusal mapping for past,
  future-date, wrong-day and assignment-window outcomes without changing the
  typed method signature.
- [x] 4.5 Align the demo adapter's current/historical assignment, business-date,
  time and duplicate validation with the live command; preserve demo-only
  writes and existing fixture consistency.

## 5. Verify the user-visible flow and unchanged attendance behavior

- [x] 5.1 Add browser coverage that opens the previous day, expands a genuine
  derived absence, presses **Record arrival**, enters a valid time, saves, and
  observes settled Present with entered-by evidence and no phone/GPS evidence.
- [x] 5.2 Re-prove today's identical process, historical settled-row correction,
  late classification, by-staff/month tally, working-elsewhere suppression,
  waiting badges and one-person-day behavior.
- [x] 5.3 Inspect the expanded attendance card and sheet at phone and tablet
  viewports in light and dark themes; keep the existing action geometry and
  shimmer unchanged.
- [x] 5.4 Inspect browser console and unexpected requests during current and past
  entry, and prove demo mode remains visibly marked and performs no real-data
  writes.

## 6. Update durable attendance documentation

- [x] 6.1 Update `docs/DATA_MODEL.md` with current-or-past manual business dates,
  asserted-instant/cutover validation, current-plus-historical staff membership
  and unchanged append-only attribution.
- [x] 6.2 Update `docs/SCREENS.md` with the same **Record arrival** action on
  eligible past derived absences and date-aware sheet copy.
- [x] 6.3 Update `docs/ROLES_AND_PERMISSIONS.md` and
  `docs/SECURITY_AND_PRIVACY.md` with current actor authority, historical subject
  scope, no forged enterer and no manager-location evidence.
- [x] 6.4 Update `docs/TESTING.md` with past acceptance, cutover mismatch,
  assignment-window, duplicate/cross-outlet and unchanged-RPC REST proofs.

## 7. Full verify-fix-reverify loop

- [x] 7.1 Run formatting, lint, format check, TypeScript and Edge Function type
  checks, touched tests, full unit/component tests, contrast and production
  build; fix and rerun every in-scope failure.
- [x] 7.2 Run the full Playwright suite and the focused current/past attendance
  walks; fix and rerun every affected browser case.
- [x] 7.3 Reset the local Supabase stack, run pgTAP, REST/RLS and authenticated
  four-role E2E in the required order, regenerate database types, and require a
  clean generated-type diff.
- [x] 7.4 Confirm `openspec/changes/ROADMAP.md` is byte-for-byte untouched and do
  not run roadmap sync, per the owner's explicit instruction.

## 8. PHASE GATE — re-prove attendance checkpoint #26 with historical entry

- [x] 8.1 PHASE GATE — an authorised manager records a current visible staff
  member's row-less past absence through the same **Record arrival** process and
  gets one settled, attributed, locationless manual-present day; before/after
  assignment, future/wrong-day, another outlet, duplicate person-day and
  non-manager handcrafted requests are refused by the database; today's manual
  entry, historical correction, waiting decisions, one-person-day, demo safety
  and the four-role walkthrough still pass; every applicable repository and
  Docker gate is green; and ROADMAP remains untouched.

## 9. Review follow-ups, before archive

Found reviewing the applied change against its own proposal, design and gates.
Six items, none of which alters the contract in section 3 — they close the gap
between what the change decided and what the repository actually carries.

- [x] 9.1 Clamp the manual-entry instants in
  `supabase/tests/06_write_contract_attendance_alerts.sql` and
  `supabase/tests/26_attendance_server_time.sql` to
  `greatest(<offset ago>, day start)`, the clamp `17_owner_reach.sql` already
  carries. Both name today and built their instant by subtracting minutes from
  `now()`, so D3's new instant/date check refuses them for the first 10 and 7
  minutes after the 04:00 cutover — a daily window the change introduced into
  two suites that had nothing to do with it. Confirmed against the live stack
  before fixing.
- [x] 9.2 Map `person is not current staff at this outlet` in `toActionError`
  alongside the historical-window refusal. It matched no branch and fell through
  to `failed` — "Try again in a moment" for a request that will never succeed —
  while the demo adapter answered the same situation with `manual_refused`,
  which is the parity D6 forbids breaking. Pinned in the adapter test.
- [x] 9.3 Correct the comments the expanded contract falsified: both
  `ManualEntryInput` and `recordManualEntry` in `src/data-access/adapters.ts`
  still read "on the outlet's current business day", and `17_owner_reach.sql`
  still called back-filling a closed day out of scope. The proposal's Impact
  section promised the first two.
- [x] 9.4 Restate the commit's gate figures from an actual run. The message
  claimed 1,476 unit tests where the suite runs more than the previous commit's
  own 1,542, 248 browser e2e where the suite runs 256, and 2,033 pgTAP
  assertions where it runs 2,034.
- [x] 9.5 Replace the component assertion
  `businessDate: expect.not.stringMatching(/^$/)` with the previous business
  date, the outlet, and the instant resolved onto that date, and assert the
  sheet names the day. The old assertion passed for a call sending today's date,
  which is the one regression this change exists to prevent; proved the new one
  fails against that regression before keeping it.
- [x] 9.6 Restore today's manual entry at the two boundaries where this change
  moved its coverage to a past date rather than adding to it: one browser case
  and one REST case. "Today's process is unchanged" is a scenario in the delta,
  and it was left proved only by pgTAP and one component test.
