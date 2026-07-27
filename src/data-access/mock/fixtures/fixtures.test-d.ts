import type { Tables } from '../../database.types'
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
