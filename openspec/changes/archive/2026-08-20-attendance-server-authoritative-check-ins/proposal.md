## Why

A legitimate self check-in is currently refused whenever the phone's GPS/device timestamp is even slightly ahead of PostgreSQL, while a clock set backwards can silently backdate the same arrival. Attendance time and the outlet's current business date need one authoritative clock so device skew cannot block, relabel or falsify a phone check-in.

## What Changes

- Make the database receipt instant the authoritative arrival time for every Employee or Biller self check-in, including retries and position-free attempts.
- Derive the self check-in's explicit business date from that same database instant and the target outlet's cutover in Asia/Kolkata, instead of accepting the phone's date as authority.
- Make employee attendance surfaces obtain each outlet's current business date and reference time from the backend, so loading today, retry eligibility and lateness previews do not depend on the phone clock.
- Keep coordinates and reported accuracy as immutable device evidence, while treating the geolocation reading's device timestamp as non-authoritative and excluding it from attendance time, business-date and lateness decisions.
- Preserve idempotency: an exact replay returns the first server-stamped attempt, and a reused command id with changed client evidence is refused.
- Keep the deployed RPC request shape compatible long enough for already-loaded clients to check in safely across the database-first deployment.
- Leave manager-entered historical arrivals and manager time corrections client-specified and database-validated; those actions deliberately attest to a chosen past time and still refuse future or wrong-business-date values.

## Non-goals

- Making attendance offline-capable or adding an attendance outbox.
- Changing geofence selection, approval, denial, retry policy, payroll outcomes, arrival deadlines or manager authority.
- Trusting or automatically repairing a device clock, or applying a tolerated future-skew window.
- Changing counter-billing timestamp or business-date semantics.
- Retrofitting historical attendance times or preserving an untrusted phone timestamp as additional monitoring data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: Self check-in time, current business date, lateness and replay semantics become server-clock authoritative while manual attendance keeps its intentional supplied-time contract.

## Impact

- **Database:** a forward Supabase migration changes the attendance self-check-in command and adds a narrow current-attendance-context read without widening RLS or client table privileges.
- **Adapter seam:** the typed attendance adapter, Supabase adapter and demo adapter expose the backend-derived outlet date/reference time and preserve the existing screen/backend boundary.
- **Employee UI:** today's record lookup, check-in submission, retry eligibility and material-change preview consume backend time context rather than `new Date()` as authority.
- **Compatibility:** the migration accepts the currently deployed check-in payload while ignoring its timestamp and business date as authoritative facts; the updated client adopts the server context without requiring a synchronized release instant.
- **Verification:** database, RLS, REST adapter, mock, component and authenticated E2E coverage add forward-skew, backward-skew, cutover, deadline-boundary and idempotent-replay cases; generated database types are regenerated.
- **Durable docs before archive:** `docs/DATA_MODEL.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/TESTING.md` and `docs/LIMITATIONS.md` are updated to state the two distinct time contracts for self check-ins and manager-attested entries.
