import type { Tables } from '../../database.types'
import { employeeFixtures } from './employees'
import { outletFixtures } from './outlets'

/**
 * The compile-time drift proof, stated as code: a fixture the database could
 * not serve fails to compile. This file is type-checked (`npm run typecheck`
 * and the build) but never executed — if any `@ts-expect-error` below stops
 * erroring, the schema types have drifted loose of what fixtures assume, and
 * tsc fails the build with "unused @ts-expect-error".
 */

const validOutlet = outletFixtures[0] as Tables<'outlets'>

// A fixture must not carry a column the schema lacks.
export const columnTheSchemaLacks: Tables<'outlets'> = {
  ...validOutlet,
  // @ts-expect-error — `nickname` is not a column of outlets.
  nickname: 'shack',
}

// A fixture must not assign the wrong type to a real column.
export const wrongValueType: Pick<Tables<'outlets'>, 'geofence_radius_m'> = {
  // @ts-expect-error — geofence_radius_m is a number, not a string.
  geofence_radius_m: '150',
}

// A fixture must not omit a required column.
// @ts-expect-error — a bare object misses every required outlets column.
export const missingRequiredColumns: Tables<'outlets'> = {}

// A fixture must not invent enum members.
export const inventedRole: Pick<Tables<'profiles'>, 'role'> = {
  // @ts-expect-error — 'intern' is not an app_role.
  role: 'intern',
}

// The same proof for the roster fixtures attendance added.
const validEmployee = employeeFixtures[0] as Tables<'employees'>

export const employeeColumnTheSchemaLacks: Tables<'employees'> = {
  ...validEmployee,
  // @ts-expect-error — `nickname` is not a column of employees.
  nickname: 'chef',
}

export const inventedEmploymentStatus: Pick<Tables<'employees'>, 'employment_status'> = {
  // @ts-expect-error — 'on_leave' is not an employment_status.
  employment_status: 'on_leave',
}

// The evidence columns attendance relies on must exist with the types the
// adapters assume — a fixture or an adapter that drifted from the schema
// would fail here rather than at runtime in front of an employee.
export const attendanceEvidenceShape: Pick<
  Tables<'attendance'>,
  'check_in_distance_m' | 'check_in_accuracy_m' | 'check_in_source' | 'override_by_name'
> = {
  check_in_distance_m: 11.6,
  check_in_accuracy_m: 14,
  check_in_source: 'phone',
  override_by_name: 'Demo Manager',
}

export const inventedCheckInSource: Pick<Tables<'attendance'>, 'check_in_source'> = {
  // @ts-expect-error — 'smartwatch' is not a check_in_source.
  check_in_source: 'smartwatch',
}

// The outlet capture evidence added by this change.
export const outletCaptureShape: Pick<
  Tables<'outlets'>,
  'location_accuracy_m' | 'location_captured_at'
> = {
  location_accuracy_m: 9,
  location_captured_at: '2026-07-24T09:15:00+00:00',
}
