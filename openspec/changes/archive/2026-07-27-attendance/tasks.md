# Tasks: attendance

## 1. Database — geofence evaluation and position evidence

- [x] 1.1 Migration: add `location_accuracy_m` and `location_captured_at` to `public.outlets`, so a surveyed position is distinguishable from a placeholder (design D8).
- [x] 1.2 `public.app_distance_m(lat1, lng1, lat2, lng2)` — haversine in metres, immutable, null when any input is null. Granted to `authenticated`, revoked from `public`/`anon` like every other helper.
- [x] 1.3 `public.attendance_evaluate_geofence()` trigger function (`security definer`, `set search_path = ''`): recompute `check_in_distance_m` and `check_out_distance_m` from the submitted coordinates and the outlet's position, overwriting anything the client sent; force `status = 'absent'` when a check-in is beyond the radius with no override recorded. Never force `present` (design D2).
- [x] 1.4 Attach it `before insert or update on public.attendance`, named so it fires after `attendance_business_date_valid` and before `attendance_guarded`.
- [x] 1.5 Constrain `override_reason` to be non-empty when present, so an override cannot be recorded with a blank justification.
- [x] 1.6 pgTAP coverage in a new `supabase/tests/08_geofence.sql` (kept separate from 06 so the distance-pinning table has a home): a claimed distance contradicting its coordinates is overwritten; an employee cannot store `present` from outside the fence; an override flips the same row to `present`; a manager's `half_day`/`leave` on an in-fence row survives; a null outlet position stores a null distance and blocks nothing; an empty override reason is refused.
- [x] 1.7 pgTAP coverage that `outlets` position columns are Super Admin-only in practice — a Franchise Admin update of `latitude`/`longitude`/`geofence_radius_m` for their own outlet touches no rows (design D4). Also probed over REST, where a hand-crafted request would actually arrive.
- [x] 1.8 Extend `supabase/seed.sql` so the demo-relevant states exist locally: capture metadata on both outlets, and an attendance row awaiting an override (blocked, no approver) alongside the already-seeded approved one.
- [x] 1.9 Regenerate `src/data-access/database.types.ts` (`npm run db:types`) and update the outlet fixtures so the new columns are typed rather than drifting.

## 2. Distance, geolocation, and the domain layer

- [x] 2.1 `src/domain/geo.ts`: `distanceMetres()` (haversine, pure) and `evaluateFence()` returning the verdict plus the numbers the UI needs. No I/O.
- [x] 2.2 Unit tests for both, including the shared fixture table that pins the TypeScript formula to the SQL one (design D7), plus the null-position case.
- [x] 2.3 `src/lib/geolocation.ts`: the only module touching `navigator.geolocation`. `readPosition()` (single high-accuracy reading with a timeout, for check-in) and `watchBestPosition()` (best-by-accuracy over ~8s, for outlet capture), both resolving to a typed reading or a typed failure — `denied`, `unavailable`, `timeout`, `unsupported` (design D6, D10).
- [x] 2.4 Unit tests driving that module against a stubbed `navigator.geolocation`, covering each failure and proving `watchBestPosition` keeps the best sample rather than the last or the mean.

## 3. The adapter seam

- [x] 3.1 `AttendanceAdapter` in `src/data-access/adapters.ts`: today's own record, own history, an outlet's day, check in, check out, request an override, approve one. Plus the row shape the surfaces share, so employee and manager views cannot drift apart (design D9).
- [x] 3.2 `EmployeesAdapter`: list for an outlet, find the caller's own roster row, create, update.
- [x] 3.3 `OutletsAdapter.saveLocation()` — coordinates, accuracy, radius — added to the existing interface.
- [x] 3.4 Supabase implementations of all three, with explicit column selection and the business date resolved against the outlet's cutover rather than from a UTC timestamp.
- [x] 3.5 Mock implementations with the three states the proposal names (normal day, blocked awaiting override, approved override), holding state in the closure like the accounts mock so a demo shows things happening.
- [x] 3.6 Fixtures typed from the generated schema types, and extend `fixtures.test-d.ts` so a fixture the database could not serve fails to compile.

## 4. Employee surfaces

- [x] 4.1 `staff-home`: one large check-in/check-out action, today's status, and the outlet it is judged against — replacing the placeholder empty state.
- [x] 4.2 The blocked state as a designed surface: why it was refused, how far beyond the fence, the reading's accuracy, and the override request action (design D5, and the proposal's insistence that this not be a toast).
- [x] 4.3 The geolocation failure states — denied, unavailable, timeout, unsupported — each saying which happened and offering the same override path.
- [x] 4.4 `staff-attendance` ("My attendance"): own history showing times, status, distance, accuracy, source, and any override with approver and reason — the same facts the manager sees.
- [x] 4.5 Component tests: in-fence check-in, out-of-fence blocked state, abandoning a block writes nothing, override request writes the row, check-out completes the day, and a completed day offers no further action.

## 5. Manager surfaces

- [x] 5.1 `admin-attendance`: the outlet's chosen business day — who, when, from where, accuracy, source, flags — with rows awaiting an override distinguished, and a day picker.
- [x] 5.2 The override approval action, requiring a non-empty reason, recorded with approver and time.
- [x] 5.3 `admin-employees`: the roster with add, edit, and employment status.
- [x] 5.4 Component tests: the day renders every roster employee, a pending override is distinguishable and approvable, an empty reason is refused, and the roster's add/edit round-trips.

## 6. Owner outlet surface

- [x] 6.1 `owner-outlets`: the outlet list with each outlet's captured position, the accuracy it was captured at, and when — so an uncaptured outlet is visible as such (design D8).
- [x] 6.2 The capture screen: take a reading, watch it tighten, see accuracy before saving, set the geofence radius (default 150 m), and save. Refuse above 50 m, warn between 25 m and 50 m (design D5).
- [x] 6.3 Component tests: a poor fix cannot be saved, a middling fix saves with the warning shown, a good fix saves cleanly, and the radius is editable.

## 7. Demo fixtures and gates

- [x] 7.1 Gate registry: promote `staff-attendance`, `admin-attendance`, `admin-employees`, `owner-outlets` to `live`; leave `counter-attendance-kiosk` `hidden` (design D11). Update the registry test.
- [x] 7.2 Routes for the four promoted surfaces in `roleSurfaceRoutes`, shared by both trees as every other surface is.
- [x] 7.3 Verify the demo walk end to end for all four roles, including that the Employee persona's home and history are populated — the dependency #8 has on this change.

## 8. Docs and verification

- [x] 8.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` green.
- [x] 8.2 `npm run test:db` and `npm run test:rls` green against the local stack, including the new geofence cases.
- [x] 8.3 `npm run test:e2e` against the production build; `e2e/attendance.spec.ts` walks an Employee's day, a blocked check-in, a manager's override, and an outlet capture, using Playwright's geolocation emulation rather than any in-app test hook.
- [x] 8.4 Inspect every new surface on a phone and a tablet viewport, in light and dark, with zero console errors and no unexpected network traffic.
- [x] 8.5 `npm run contrast` green if any token or surface colour changed.
- [x] 8.6 Docs updated in this change, not after it: `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md` (the monitoring section, now that real capture exists), `docs/OPERATIONS.md` (production is real).

## 9. What the gate actually proved

Recorded at archive time, 2026-07-27, rather than left to be inferred from a
ticked box.

- [x] 9.1 **Real check-in and check-out on a phone, in production.** Walked by
      the owner against a real outlet they created and surveyed themselves:
      checked in at **5.1 m** from the captured fence, status `present`, source
      `phone`, then checked out. Reached through an account provisioned in the
      app and activated from a WhatsApp link. The synthetic data was deleted
      afterwards at the owner's request; the walk happened.
- [x] 9.2 🧍 The owner confirms the walk above.
- [ ] 9.3 🧍 **Not demonstrated in production: an out-of-fence block cleared by
      a manager override.** Proven by the pgTAP geofence suite, the REST suite
      and `e2e/attendance.spec.ts` under Playwright's geolocation emulation —
      but never walked on real hardware outside a fence. Archived with the owner's
      agreement rather than held open. See
      [`todos/attendance-gate-unwalked-clauses.md`](../../todos/attendance-gate-unwalked-clauses.md).
- [ ] 9.4 🧍 **Not demonstrated in production: an Employee seeing only their own
      records.** Enforced by Row-Level Security and proven by the isolation
      matrix; production only ever held one employee, so nothing there could
      have shown it either way.
