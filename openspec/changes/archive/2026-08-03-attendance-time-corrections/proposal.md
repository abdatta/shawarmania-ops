## Why

An arrival can be recorded with the wrong time because a phone clock was wrong or an admin mistyped a manual entry, but today the only remedies change the day's attendance outcome or retry permission. The owner and the responsible outlet admin need a narrowly scoped way to correct that effective time without erasing the original arrival evidence or who changed it.

## What Changes

- Add `Change check-in time` to the existing `Correct attendance` flow for settled attendance records.
- Require a replacement time and the existing non-blank correction reason.
- Allow corrections on historical settled days, while refusing future times and times outside the recorded outlet business date.
- Preserve the original immutable attempt and append an attributed correction containing the previous time, new time, database timestamp, and reason.
- Use the latest corrected time as the effective arrival time everywhere, including lateness, summaries, manager views, and the employee's own history.
- Keep authority unchanged: a Franchise Admin may correct only attendance at an outlet where they hold that role; a Super Admin may correct any outlet.
- Show the correction history to the employee and authorised managers alongside the original arrival.

## Non-goals

- Changing the recorded outlet, person, business date, GPS evidence, source, or original attempt.
- Correcting an arrival that is still waiting for approval.
- Giving Employees, Billers, or counter-device sessions correction authority.
- Adding a general-purpose audit-log subsystem.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: Permit an authorised manager to append an audited effective-time correction to a settled attendance record while retaining the original attempt and existing tenancy boundary.

## Impact

- Attendance correction UI, typed adapter contract, demo adapter, and Supabase adapter.
- Attendance decision schema and correction command, including generated database types and RLS/write-contract verification.
- Attendance history rendering, lateness derivation, demo fixtures, and unit/browser/database tests.
- Before archive, update `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, and `docs/TESTING.md`.
