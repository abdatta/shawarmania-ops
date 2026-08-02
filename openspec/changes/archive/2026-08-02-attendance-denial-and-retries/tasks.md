## 1. Canonical day, immutable history and commands

- [x] 1.1 Add one migration that creates typed, append-only `attendance_attempts` and
  `attendance_decisions` tables with `outlet_id`, person/date links, client UUID idempotency,
  evidence/decision constraints, no-delete guards, canonical attendance links/version state, and
  RLS policies for owner, own-person and live Franchise Admin outlet scope in the same migration.
- [x] 1.2 Backfill every existing check-in, approval, manual settlement and row-only outcome into the
  new shape while preserving stored evidence and ensuring legacy present, leave, half-day and
  historical rows do not become waiting; add migration assertions that fail on an unrecognised or
  lossy shape.
- [x] 1.3 Implement guarded, idempotent database commands for initial check-in/retry, approve, deny,
  correct outcome and reopen retry; derive caller authority, assignments, active outlet, explicit
  target business date, geofence distances, deadlines, manager identity/time and reason rules in
  Postgres, lock the canonical person-day, and return named stale/changed-payload refusals.
- [x] 1.4 Revoke legacy authenticated direct attendance mutation after the commands are complete;
  harden every `security definer` function with an empty search path and explicit execution grants,
  and preserve seed/service operation without introducing a browser service-role path.
- [x] 1.5 Regenerate `src/data-access/database.types.ts` from the reset schema and update compile-time
  fixture-shape assertions for attempts, decisions, retry state and removed/compatibility fields.

## 2. Database and tenancy proof

- [x] 2.1 Extend database contract tests for initial pending, denied-absent plus pending, repeated
  outside/unverifiable retry, inside retry lock, global prevent/reopen retry, approval lock, target
  assignment/activity/cutover checks, stamped deadline/lateness, mandatory reasons and no-location
  denial.
- [x] 2.2 Prove exact command retry is idempotent, changed-payload UUID reuse is refused, and
  approval-versus-denial and retry-versus-decision races leave one complete outcome, one current
  attempt, one waiting outlet and append-only history.
- [x] 2.3 Add matching RLS isolation coverage for both new outlet-scoped tables: a Kalyani Franchise
  Admin cannot read or act on Kanchrapara evidence after a retry, a superseded manager learns no new
  outlet facts, an unrelated Employee reads nothing, the subject reads their full history and the
  Super Admin reaches all outlets.
- [x] 2.4 Extend the REST/adapter integration suite to exercise the commands through an authenticated
  client, including hand-crafted unassigned-outlet, blank-reason, forged-manager, stale-version and
  cross-outlet requests.
- [x] 2.5 Add reset/backfill regression assertions for representative approved-on-site,
  approved-away, pre-approval legacy present, manual, waiting, late, leave, half-day and no-check-in
  rows, including unchanged person/date/outlet counts and no invented GPS evidence.

## 3. Typed adapter seam and demo parity

- [x] 3.1 Extend the attendance adapter types with canonical outcome, current attempt, ordered attempt
  and decision history, retry eligibility/version and idempotent deny/retry/correction commands; keep
  all screens independent of Supabase.
- [x] 3.2 Implement Supabase reads and commands over the guarded database functions, map named
  refusals to actionable `AttendanceActionError` messages, and ensure command success invalidates the
  shared attendance/attention read.
- [x] 3.3 Rework the mock attendance adapter to enforce the same assignment, business-date, evidence,
  reason, idempotency, stale-version, retry and correction rules without allowing a transition live
  would refuse.
- [x] 3.4 Extend the coherent demo fixtures with an editable outside-denial prefill, an unverifiable
  denial, a retry-prevented day, a wrong-outlet retry, a denied-absent day with a newer pending
  attempt, an audited correction and complete two-outlet employee/owner history.
- [x] 3.5 Add adapter/mock tests for every transition and demo-safety tests proving the full denial,
  retry and correction walkthrough issues no request outside the app origin.

## 4. Employee retry experience

- [x] 4.1 Update the shared attendance derivation so an initial pending day, denied absent, denied
  absent plus pending, approved, manual, leave and half-day remain distinct and day/person tallies
  intentionally count denied-plus-pending as both absent outcome and waiting work.
- [x] 4.2 Update the check-in card to offer retry only for newest outside/unverifiable evidence or an
  open denial, suppress it for newest in-fence pending and every approved/manual/leave/half-day or
  prevented day, and stop it when no assigned target still reckons the explicit date as current.
- [x] 4.3 Reuse the multi-outlet geofence resolver for permitted retries at any live assigned outlet,
  retain every prior attempt, and show the active outlet and “Absent — new check-in awaiting manager
  review” without implying the denial was suspended.
- [x] 4.4 Add one employee confirmation that lists all outlet, on-time/late and
  inside/outside/unverifiable before→after changes, writes only after `Use new check-in`, writes
  nothing for `Keep existing check-in`, and does not appear when no material fact changes.
- [x] 4.5 Handle a stale confirmed retry by reloading the manager-decided state, with component tests
  for races, repeated weak readings, inside retry lock, wrong-outlet recovery, cutover disagreement,
  approved-day lock and every confirmation combination.

## 5. Manager denial and compact corrections

- [x] 5.1 Add Deny beside Approve on one current waiting row and a two-input sheet with required
  editable reason plus `Prevent another check-in today`, always unchecked initially; prefill measured
  outside and unverifiable evidence honestly and never request manager location for denial.
- [x] 5.2 Render denied outcomes, retry permission, current pending evidence and ordered immutable
  attempt/decision history consistently on the manager day, manager person range and employee own
  history surfaces.
- [x] 5.3 Add one unobtrusive `Correct attendance` entry in expanded settled details, showing only
  state-relevant actions to mark present/absent, allow another check-in, or mark absent and allow
  retry; require a reason for every correction and keep ordinary rows free of correction-button
  clutter.
- [x] 5.4 Reuse the existing approval position/reason flow for corrections to present while retaining
  the employee's latest immutable time/location; make absent and retry-only corrections locationless
  and preserve every earlier approval or denial.
- [x] 5.5 Add component tests for denial defaults and editing, blank refusal, prevent/reopen retry,
  present↔absent correction, wrong-approval recovery, location/no-location behavior, compact action
  discoverability and Franchise Admin/Super Admin authority.

## 6. Waiting attention and cross-outlet presentation

- [x] 6.1 Derive waiting counts from the single current pending attempt so retry moves attention
  atomically between outlets, denial/approval clears it, a later retry restores it, and a
  denied-absent plus pending day appears in both the appropriate outcome and work queues.
- [x] 6.2 Preserve the bounded `working elsewhere` disclosure: a former-outlet Franchise Admin sees
  only their superseded local evidence and no new-outlet facts, while employee and owner histories
  name the complete sequence.
- [x] 6.3 Extend notification, outlet-switching and owner combined-day tests for count transfer,
  foreground freshness, no zero badge, no stale previous-outlet rows under a new label and immediate
  invalidation after every successful command.

## 7. Durable documentation

- [x] 7.1 Update `docs/DATA_MODEL.md` for the canonical day, attempt/decision tables, append-only
  invariants, explicit business-date/cutover rule, command boundary and migration compatibility.
- [x] 7.2 Update `docs/SCREENS.md`, `docs/ROLES_AND_PERMISSIONS.md` and `docs/DEMO_MODE.md` for employee
  eligibility/confirmation, the two-input denial, compact corrections, multi-outlet visibility and
  the coherent demo walkthrough.
- [x] 7.3 Update `docs/SECURITY_AND_PRIVACY.md` and `docs/LIMITATIONS.md` for additional deliberate GPS
  attempts, strict evidence visibility, no background capture, existing retention-policy deferral
  and the absence of staff scheduling/expected-outlet knowledge.
- [x] 7.4 Update `docs/TESTING.md` with denial/retry/correction, race, migration, RLS, phone/tablet and
  both-theme verification; reconcile any generated roadmap description with
  `npm run roadmap:sync` rather than hand-stamping status.

## 8. Verification and phase gate

- [x] 8.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run contrast`, `npm run build` and `npm run test:e2e`; use `npm run format` if formatting needs
  repair and record exact results.
- [x] 8.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and
  `npm run test:e2e:auth`, including all four roles' landing/chrome expectations after the Employee
  home and manager attendance index change.
- [x] 8.3 Inspect the live and demo flows at phone and tablet viewports in light and dark themes:
  ordinary approve/deny density, denial sheet, material-change confirmation, absent-plus-waiting
  copy, history, compact correction menu, badges and cross-outlet switching.
- [x] 8.4 PHASE GATE — Attendance denial and retries: demonstrate denial with exactly two inputs and
  no manager location; default-open and prevented retry; repeated weak evidence; confirmed material
  changes; wrong-outlet recovery; absent retained until approval; approved-day employee lock;
  audited present/absent/retry corrections; one outcome and one waiting attempt under races; legacy
  history preservation; and hand-crafted cross-outlet refusals before implementation is considered
  complete.
