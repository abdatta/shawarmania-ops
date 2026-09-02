# Proposal: historical-attendance-manual-entry

> **Model**: GPT-5.6 Sol · **Roadmap**: intentionally unlisted at the owner's request · **Gate**: a manager opens a past business day, expands a current staff member's derived-absent row, uses the same **Record arrival** action and time-only sheet offered today, and the day becomes one settled manual-present record carrying the asserted historical time and database-stamped enterer; the database refuses future dates/times, wrong-day instants, dates outside that person's staff-assignment window, another outlet, a non-manager, and a second person-day, while today's flow, historical corrections, demo mode and the four-role walkthrough remain intact.

## Why

The attendance day already renders a missed deadline with no stored row as
**Absent** and, on the current business day, offers **Record arrival** so a
manager can attest that the person did arrive. The same row on a past date
removes that action. Historical corrections work only where a row already
exists, so a forgotten check-in discovered tomorrow cannot be repaired even
though the existing manual-entry audit model already records the claimed
arrival time, who entered it and when they did so.

The restriction was an explicit scope deferral, not a tenancy or integrity
requirement. Real use has now supplied the deferred need. Leaving the gap means
attendance used for external payroll can remain knowingly false, while the
only workaround is an unrecorded conversation outside the system.

## What Changes

- Keep the existing **Record arrival** button, sheet and settled-manual-entry
  semantics, and offer them on a selected past business day as well as today.
- Make the sheet name the selected date rather than describing every entry as
  today's, while retaining the one time field, enterer attribution, absence of
  fabricated GPS evidence and no second approval.
- Offer the action only when the person is currently visible as staff at the
  outlet and held an Employee or Biller assignment there on the selected date.
- Extend the existing database command, without changing its signature, to
  accept current or past business dates and to validate the asserted instant
  against the named outlet business day and historical assignment window.
- Preserve current manager authority, cross-outlet isolation, one person-day
  globally, append-only attempts/decisions, idempotent command identities and
  refusal of future entries.
- Keep demo and live adapters behaviorally aligned, and prove the complete
  flow at component, browser, database and REST/tenancy boundaries.

## Non-goals

- Automatically manufacturing absent attendance rows as time passes.
- Turning a manual entry into a correction, adding a second approval, or
  redesigning the existing correction/approval/denial flows.
- Allowing an Employee, Biller device or former manager to backdate attendance.
- Widening a Franchise Admin's profile visibility to departed people or people
  at another outlet; historical entry is limited to people already on the
  manager's current visible staff list.
- Adding leave, half-day, roster scheduling, payroll or attendance offline
  support.
- Changing gates, navigation, the demo seam, money arithmetic or billing.
- Adding this change to `openspec/changes/ROADMAP.md` or running roadmap sync,
  per the owner's explicit instruction.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: manager-attested manual arrival expands from the
  current business day to any current-or-past business date inside the visible
  staff member's assignment window, with the same audit and tenancy boundary.

## Impact

- **Manager UI:** the existing action becomes date-aware; no new layout or
  component family is introduced, so the attendance shimmer geometry is
  unchanged.
- **Database:** one forward migration replaces the existing
  `attendance_record_manual` body without changing its signature, grants,
  tables, enums or RLS policies.
- **Adapter seam:** the typed method and payload shape remain unchanged; comments,
  demo validation and refusal mapping are updated to the expanded contract.
- **Attendance truth:** a successful historical entry intentionally changes that
  person-day and derived month tally from absent to present. Other days and
  other outlets remain unchanged.
- **Verification:** focused UI, mock, adapter, database, RLS/REST and browser
  cases are added before the full repository and Docker-backed gates run.
- **Durable docs before archive:** `docs/DATA_MODEL.md`, `docs/SCREENS.md`,
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/SECURITY_AND_PRIVACY.md` and
  `docs/TESTING.md` are updated to state the historical manual-entry contract.
