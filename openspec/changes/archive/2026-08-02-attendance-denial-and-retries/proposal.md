## Why

Attendance can be approved but not denied, so a disputed arrival remains in the manager's queue
forever and an employee who records a bad or wrong-outlet reading can be stranded for the business
day. Managers need a small, auditable way to decide absent, permit a better attempt, and correct a
decision without erasing the location evidence or weakening the one-person-one-day rule.

## What Changes

- Add a one-person manager denial action that marks the day absent, requires an editable reason,
  and offers one `Prevent another check-in today` checkbox that is always unchecked by default.
  Outside-fence and unverifiable readings prefill an honest reason; the manager may edit it.
- Allow an employee to retry before cutover when the latest attempt is outside or unverifiable, or
  after a denial that did not prevent retries. A permitted retry may resolve to any outlet where the
  person holds a live staff assignment, while the person still has only one attendance outcome for
  the business date.
- Keep a denied day absent while a newer attempt waits. Only manager approval changes it to present;
  an in-fence reading never approves itself.
- Preserve every attempt and manager decision as immutable evidence. A newer attempt supersedes the
  previous pending attempt without overwriting its time, outlet, coordinates, accuracy, distance,
  source, decision, or reason.
- Warn the employee once, before saving, when a retry would materially change the outlet, lateness,
  or fence result. An approved day remains manager-controlled and cannot be reopened by the
  employee.
- Put rare corrections behind one unobtrusive `Correct attendance` entry point. A manager can mark
  absent or present, allow another check-in after blocking one, or mark an incorrectly approved
  outlet absent and allow a new attempt; every correction requires a reason and appends history.
- Move the waiting count atomically with the active attempt, so only the manager of its current
  outlet is asked to act. Franchise Admins see only their own outlet's evidence, while the employee
  and Super Admin can read the complete sequence.
- Migrate existing attendance without relabelling legacy present, approved, manual, leave, half-day,
  late, or historical rows.

## Non-goals

- Scheduling which outlet a multi-outlet person is expected to work on a date.
- Automatic approval from an in-fence reading, bulk approval or denial, check-out, payroll rules,
  or new attendance statuses beyond the existing present/absent/half-day/leave outcomes.
- Editing or deleting captured attempts or earlier decisions.
- Background location tracking, a new retention policy, or collecting location outside a direct
  check-in, approval, correction-to-present, or outlet-position action.
- Redesigning the attendance day, person history, or navigation badge beyond the controls and states
  needed for denial, retry, confirmation, correction, and audit history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: Add denial, retry eligibility, material-change confirmation,
  append-only attempt and decision history, reversible manager corrections, cross-outlet retry
  tenancy, and the resulting waiting-count behavior.

## Impact

- **Database:** attendance schema, migration/backfill, guarded command functions, append-only
  evidence, RLS policies, uniqueness and race enforcement, and generated database types.
- **Adapter seam:** attendance records and commands in the typed interface, Supabase adapter, mock
  adapter, and coherent demo fixtures.
- **UI:** employee check-in card and history; manager day/person views, denial form, compact
  correction entry point, evidence history, and attention refreshes.
- **Verification:** migration/backfill, database contract and RLS isolation tests, adapter tests,
  component tests, role/auth E2E coverage, demo safety, both themes and viewports, and every ordinary
  CI gate.
- **Durable documentation before archive:** `docs/DATA_MODEL.md`, `docs/SCREENS.md`,
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEMO_MODE.md`,
  `docs/TESTING.md`, and `docs/LIMITATIONS.md`.
