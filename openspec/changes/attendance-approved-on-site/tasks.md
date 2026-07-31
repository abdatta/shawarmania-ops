# Tasks: attendance-approved-on-site

## 1. Protect what is about to be destroyed

- [x] 1.1 🧍 Full `pg_dump` of the production database (schema + data), taken before any migration runs, stored outside the repo under the established snapshot procedure
- [x] 1.2 🧍 Restore that dump into a scratch database and confirm `attendance` comes back with its check-out columns populated — an unverified dump is not a backup
- [x] 1.3 Record in the dump's notes how many production rows carry a `check_out_at`, so what was traded away is a number and not a guess

## 2. Database — the migration

- [x] 2.1 Migration `attendance_approved_on_site`: rename `override_by` / `override_by_name` / `override_reason` / `override_at` to `approved_by` / `approved_by_name` / `approval_reason` / `approved_at`, carrying the completeness and not-blank constraints across under their new names (D4)
- [x] 2.2 Same migration: add `approver_lat`, `approver_lng`, `approver_accuracy_m`, `approver_distance_m` to `attendance` (D3), with a check that an approver position is only present alongside an approval
- [x] 2.3 Same migration: add `outlets.arrival_deadline` (`time not null default '13:00'`) and `attendance.arrival_deadline` (`time`, nullable, stamped) (D5)
- [x] 2.4 Same migration: drop `check_out_at`, `check_out_lat`, `check_out_lng`, `check_out_accuracy_m`, `check_out_distance_m`, `check_out_source`, `check_out_entered_by`, `check_out_entered_by_name` and every constraint referencing them (`attendance_checkout_needs_checkin`, `attendance_check_out_entered_iff_manual`, the check-out half of `attendance_entered_by_named`, `attendance_manual_check_out_unlocated`) (D6)
- [x] 2.5 Same migration: rewrite `attendance_evaluate_geofence()` — no check-out leg; compute `check_in_distance_m` and `approver_distance_m` from the stored coordinates; an unapproved check-in is never stored `present` whatever its distance (D1); the closed-outlet refusal stays on check-in arrival only and never blocks an approval
- [x] 2.6 Same migration: rewrite `attendance_guard()` — freeze identity and check-in evidence as today, minus the check-out branches; stamp `arrival_deadline` from the outlet when a check-in first lands and freeze it (D5); stamp `approved_by` as the writing session and snapshot `approved_by_name`; freeze approver evidence once written
- [x] 2.7 Same migration: the approval rule in the guard (D2, D9) — approval only by a Super Admin or a Franchise Admin with a live assignment at the row's outlet; approval requires a check-in on the row; `approval_reason` required unless the approver reading is inside the outlet's radius **and** the approval is recorded on the row's own business day; blank reason refused; nothing refused on distance alone
- [x] 2.8 Same migration: manual entry keeps its enterer stamp and its current-business-day and non-future rules, loses its check-out half, and settles the day it records without a separate approval (D10)
- [x] 2.9 Same migration, last: leave every existing row's status untouched, with empty approver evidence and no back-filled approver (D10)
- [x] 2.10 Rewrite `supabase/seed.sql` for the new shape: no check-outs, an approved arrival, a waiting arrival, a late arrival, and an outlet whose arrival deadline is not the default
- [x] 2.11 `npm run db:reset` green, then `npm run db:types` and commit the regenerated `database.types.ts` — the compile errors it produces are the client checklist

## 3. Database tests

- [x] 3.1 `08_geofence.sql`: an in-fence check-in is stored `absent` until approved; distance still recomputed from coordinates against a lying client; unsurveyed outlet and no-coordinates cases restated without check-out
- [x] 3.2 New cases in `08_geofence.sql` or a sibling: `approver_distance_m` computed from the approver's coordinates and never from the client
- [x] 3.3 `06_write_contract_attendance_alerts.sql`: approval by an FA of the row's outlet accepted; by an FA of another outlet refused; by the Employee whose row it is refused; approval with no check-in on the row refused; `approved_by` forced to the writing session
- [x] 3.4 Same file: the reason rule — in-fence same-day with no reason accepted; out-of-fence with no reason refused; out-of-fence with a reason accepted; no approver position with no reason refused; in-fence but a later business day with no reason refused; blank reason refused in every case
- [x] 3.5 Same file: `arrival_deadline` stamped from the outlet and not from the client; frozen on later updates; a check-in after it still accepted with its real time
- [x] 3.6 Same file: a batch approval over several ids settles each row with its own approver, time and computed distance
- [x] 3.7 `02_isolation_matrix.sql` / `03_status_and_scope.sql`: the per-person range read returns nothing for an outlet the caller holds no live assignment at, including for a person who works at both
- [x] 3.8 `01_schema_coverage.sql` and every test touching dropped columns (`09_outlet_and_staff_setup.sql`, `rest/outlet-and-staff-setup.test.ts`) updated
- [x] 3.9 `rest/attendance-adapter.test.ts`: check-out cases deleted; approval, reason rule, deadline stamp, and the per-person range exercised through the real adapter

## 4. Adapters and shared derivation

- [x] 4.1 `adapters.ts`: `AttendanceEvent` keeps its shape; `AttendanceRecord` drops `checkOut`, renames `override` to `approval`, and gains the approver's position and the stamped `arrivalDeadline`; `CheckOutInput` deleted
- [x] 4.2 `adapters.ts`: `AttendanceAdapter` drops `checkOut`; `approveOverride` becomes `approve(ids, { reason, reading })` covering one row or many (D8); `listPersonRange(personId, outletId, from, to)` and a ranged `listHistory(personId, from, to)` added, each documented as meaning one thing (D7)
- [x] 4.3 `supabase-adapters/attendance.ts`: check-out write removed; approval sends the approver's reading and one statement over the selected ids; the two range reads; `toActionError` learns the reason rule, the approval-without-check-in refusal and the closed-outlet case, and loses the check-out messages
- [x] 4.4 `features/attendance/attendance-record.ts`: `isAwaitingOverride` becomes `isWaitingForApproval`; add `isLate(record)`, `wasApprovedOnSite(record)`, and `readDay(record | null, outlet, businessDate, now)` returning the derived not-yet-arrived / absent / waiting / present reading (D6); delete `isFlaggedCheckOut` and the `open` / `complete` day phases
- [x] 4.5 `domain/`: the deadline instant for a business date under an outlet's cutover and Asia/Kolkata, unit-tested including a 01:30 arrival on a 04:00 cutover reading late against the previous day's 13:00

## 5. Surfaces

- [x] 5.1 `check-in-card.tsx`: check-out phase and handler removed; a recorded arrival states plainly that it is waiting for a manager; the blocked state says an approving manager will have to give a reason; late arrival shown after the deadline
- [x] 5.2 `evidence.tsx`: one event instead of two; the late tag; the approval note showing approver, whether they were on site, and any reason
- [x] 5.3 `outlet-attendance.tsx`: the day view keeps its roll-call and gains derived absent / not-yet-arrived rows, the late tag, the waiting count, and an approve action per row
- [x] 5.4 The approval flow: reads the manager's position once, asks for a reason only when the rule requires one, and surfaces the database's refusal when a hand-crafted or stale attempt is rejected
- [x] 5.5 `outlet-attendance.tsx`: the person axis — pick a staff member, pick a range defaulting to this month, with the present / late / absent / waiting summary, reading through `listPersonRange` with its outlet explicit
- [x] 5.6 `my-attendance.tsx` + `use-own-attendance.ts`: the same range control over the person's own days across every outlet they work at
- [x] 5.7 `staff-home.tsx`: the Employee's home reflects a day that is recorded but not yet counted
- [x] 5.8 `outlets-surface.tsx`: the arrival deadline field on the owner's outlet form, defaulting to 13:00, with the note that editing it applies to arrivals from then on
- [x] 5.9 The owner's cross-outlet waiting count on the live attendance surface, not in the demo-gated console
- [x] 5.10 Both themes and both viewports checked on every surface touched; `npm run contrast` green

## 6. Mocks, fixtures and demo

- [x] 6.1 `mock/attendance.ts`: check-out removed; approval with its position and reason rule; the two range reads; the derived readings served consistently with the real adapter
- [x] 6.2 `fixtures/attendance.ts`: an approved-on-site day, an approved-from-elsewhere day with a reason, a waiting day, a late day, and an absent day, spread over enough of the month that the range view shows a pattern
- [x] 6.3 `fixtures/accounts.ts` and the demo personas updated for the dropped columns; the split-shift person still holds days at both outlets
- [x] 6.4 `insights` mock and the owner's day view: attendance counts restated against the new readings so the demo scenario still reconciles

## 7. Component and E2E tests

- [x] 7.1 `check-in-card.test.tsx` and `my-attendance.test.tsx`: check-out cases deleted; waiting, late and approved states asserted
- [x] 7.2 `outlet-attendance.test.tsx`: approve one, the reason rule as the UI applies it, the person view and its summary, derived absent rows
- [x] 7.3 `e2e/attendance.spec.ts`: the demo walk becomes check in, see it waiting, approve as the manager, read the month by person
- [x] 7.4 `e2e/setup.spec.ts`: the arrival deadline on the outlet form
- [x] 7.5 `npm run lint`, `format:check`, `typecheck`, `test`, `contrast`, `build`, `test:e2e` all green; then `db:start` + `db:reset` and `test:db`, `test:rls`, `test:e2e:auth`

## 8. Docs

- [x] 8.1 `docs/DATA_MODEL.md` — the approval columns and their rename, approver evidence, both deadline columns, the dropped check-out columns
- [x] 8.2 `docs/SCREENS.md` — the check-in card without a check-out, the day view's approve actions, the person axis, the arrival deadline on the outlet form
- [x] 8.3 `docs/ROLES_AND_PERMISSIONS.md` — approval as a capability, who holds it, and the one rule that governs it
- [x] 8.4 `docs/SECURITY_AND_PRIVACY.md` — the approving manager as a new subject of location capture, what is stored, and that the employee sees it
- [x] 8.5 `docs/BUSINESS_CONTEXT.md` — the arrival rule and what the deadline means to the business
- [x] 8.6 `docs/PROJECT_OVERVIEW.md` — attendance restated as arrival plus approval
- [x] 8.7 `docs/DEMO_MODE.md` — the Employee demo day restated
- [x] 8.8 `docs/GLOSSARY.md` — approval, on-site approval, arrival deadline, late; "override" and "check-out" removed
- [x] 8.9 `docs/LIMITATIONS.md` — a genuine day off reads absent because nothing knows a roster; recorded check-out history is gone and lives only in the task-1 dump
- [x] 8.10 `openspec/todos/`: a note for weekly offs / rostering, and one for a pending-approval notification, each with its trigger

## 9. PHASE GATE

**Walked last, after section 10.** The amendment landed before this gate was
walked, so the gate certifies the behaviour that actually ships rather than
behaviour already superseded.


- [ ] 9.1 🧍 **Gate**: real staff check in on their own phones in production and the day counts only once a manager approves it; an in-fence approval on the row's own business day is one tap with no reason, and an off-site or later one is refused without a reason, proved by a hand-crafted request; a check-in past the outlet's arrival deadline records its real time and evidence and reads late; a person with no check-in reads absent once that deadline passes; **no check-out exists anywhere in schema, adapter, UI or spec**; a manager opens one person's month and its figures reconcile exactly with the same days read by day; a Franchise Admin's person view returns no rows worked at the other outlet, proved by a hand-crafted request; and the four-role demo walkthrough still walks

## 10. Amendment — approving is deliberate, and the work sorts first

Owner decisions of 2026-07-31, taken after the change was deployed but before
its gate was walked, so they are folded in here rather than raised as a change
to undo one that never closed.

- [x] 10.1 Remove the approve-all control from the day view's waiting banner, keeping the count, which is its own requirement (D8)
- [x] 10.2 Cache a successful position reading in memory for 60 seconds and reuse it across approvals, dropping it when the outlet in scope changes; never cache a failed reading (D11)
- [x] 10.3 Sort the roll-call waiting → not-yet-arrived → absent → recorded, alphabetical inside each, and freeze that order until the view is reopened or the chosen day changes (D12)
- [x] 10.4 Make the owner's stranded-days list switch the outlet in scope, with the outlet already in scope marked rather than offered; `useOutletScope` gains a setter for it
- [x] 10.5 Tests: no bulk control exists; approving one row leaves the order alone; a second approval inside the window reads no new position; the stranded list switches outlet
- [x] 10.6 Docs restated: `OPERATIONS.md` loses approve-all as the answer to a backlog, `SCREENS.md` the day view's actions, `pending-approval-notification.md` its reference to it
- [x] 10.7 Full gate suite green again: `lint`, `format:check`, `typecheck`, `test`, `contrast`, `build`, `test:e2e`, then `test:db`, `test:rls`, `test:e2e:auth`
