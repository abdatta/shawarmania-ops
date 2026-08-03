## 1. Database contract

- [x] 1.1 Add the append-only `correct_time` decision shape and extend the race-safe, idempotent attendance correction command with same-business-date, settled-only, future-time, and authority enforcement.
- [x] 1.2 Add database and REST tests for owner/admin scope, employee denial, immutable original evidence, repeated corrections, stale/idempotent commands, historical dates, cutover boundaries, future refusal, and lateness-effective timestamps.
- [x] 1.3 Reset the local schema, regenerate database types, and prove the generated snapshot is current.

## 2. Adapter and demo behavior

- [x] 2.1 Extend typed attendance decisions and correction input with audited previous/new times and map them through the Supabase adapter.
- [x] 2.2 Implement the same correction, validation, history, and effective-time semantics in the mock adapter and fixtures.
- [x] 2.3 Add adapter/mock tests covering successful and refused time corrections without regressing existing outcome and retry corrections.

## 3. User interface

- [x] 3.1 Add `Change check-in time` to settled records' correction dropdown with a mandatory conditional time field and existing mandatory reason.
- [x] 3.2 Render attributed old-to-new time corrections in shared manager/employee history and derive lateness/tallies from the corrected effective time.
- [x] 3.3 Add component and Playwright coverage for historical correction, required fields, late/on-time transitions, audit visibility, owner cross-outlet access, admin outlet scope, and waiting-row exclusion.
- [x] 3.4 Inspect the affected attendance sheet and history on phone and tablet viewports in light and dark themes; confirm no shimmer reshaping is required because the sheet is conditionally expanded rather than changing a loading layout.

## 4. Durable contract and verification

- [x] 4.1 Merge the approved requirement into `openspec/specs/attendance-and-location/spec.md` and update `docs/DATA_MODEL.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/SCREENS.md`, and `docs/TESTING.md`.
- [x] 4.2 Run formatting, lint, typecheck, unit tests, contrast, production build, and attendance Playwright coverage.
- [x] 4.3 Run the Docker-backed database reset, DB/RLS/REST attendance suites, auth E2E where available, and generated-type diff check.
- [x] 4.4 PHASE GATE — re-prove the ROADMAP `attendance-approved-on-site` checkpoint: real arrival evidence stays immutable, only authorised managers settle or correct a day, late readings use the stamped deadline, employee/outlet isolation holds, and the four-role demo attendance walk remains coherent.
