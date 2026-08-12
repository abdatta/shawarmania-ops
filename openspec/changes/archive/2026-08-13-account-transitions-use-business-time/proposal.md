> **Gate**: An assignment edit or Mark as left performed after midnight in Kolkata but before midnight UTC succeeds atomically, records valid Kolkata-calendar transition dates, and preserves the existing authority, history, and deactivation invariants.

## Why

Account transitions currently combine a browser-generated Asia/Kolkata start date with PostgreSQL's UTC `current_date` when ending replaced assignments. During the five-and-a-half-hour Kolkata/UTC date gap this can produce `ended_on < started_on`, reject legitimate edits and departures, and block deployment's live-backend auth suite.

## What Changes

- Derive assignment transition dates from the business timezone, Asia/Kolkata, inside the database commands that edit assignment sets and mark a person as left.
- Pin the UTC/Kolkata midnight boundary with database coverage that proves a same-Kolkata-day assignment can be replaced and ended without an invalid date range.
- Keep assignment transitions atomic and retain all existing caller-authority, final-owner, private-email, history, and account-active-state rules.
- Update the durable data-model and roles documentation to state which calendar governs assignment transition dates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-and-access`: Assignment edits and explicit departures use the Kolkata calendar consistently, including while UTC is still on the previous date.

## Impact

- Forward Postgres migration pinning the two service-only account transition functions to the Asia/Kolkata calendar.
- Database regression coverage for the Asia/Kolkata versus UTC date boundary; existing real-backend auth E2E remains the end-to-end proof.
- No new table, RLS policy, client adapter, Edge request, or UI layout change.
- Archive requires updates to `docs/DATA_MODEL.md` and `docs/ROLES_AND_PERMISSIONS.md`.

## Non-goals

- Changing assignment history shape, authority policy, or the complete-set editing contract.
- Adding configurable business timezones or outlet-specific assignment calendars.
- Changing attendance business-day cutovers, billing dates, or offline behavior.
- Redesigning the People surface or changing its adapter seam.
