/**
 * Geofence geometry. Pure, no I/O.
 *
 * This is the client half of a formula that also exists in SQL
 * (`public.app_distance_m`). The database's answer is the authoritative one —
 * it recomputes every stored distance from the stored coordinates — and this
 * one exists so a screen can tell someone what will happen *before* it writes.
 * The two must not drift, so `geo.test.ts` and the pgTAP suite assert the same
 * fixture table against the same expected metres.
 */

/** Mean earth radius, in metres. Must match `app_distance_m` exactly. */
const EARTH_RADIUS_M = 6371000.0

export interface Coordinates {
  latitude: number
  longitude: number
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Great-circle distance in metres, on a spherical earth. At geofence scale the
 * difference from an ellipsoidal model is centimetres — far below the accuracy
 * of any phone fix, and not worth the dependency.
 */
export function distanceMetres(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude)
  const dLng = toRadians(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2
  // Guard the case where floating point nudges the argument above 1 for two
  // effectively identical points, exactly as the SQL does.
  return EARTH_RADIUS_M * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * The reference point a check-in is judged against. Coordinates are nullable
 * because an outlet whose position has never been captured genuinely has none
 * — and that is a state the app reports rather than guesses at.
 */
export interface FenceReference {
  latitude: number | null
  longitude: number | null
  radiusMetres: number
}

export type FenceVerdict =
  /** Inside the radius: a check-in may proceed. */
  | { kind: 'inside'; distanceMetres: number }
  /** Outside: refused, and by how much. */
  | { kind: 'outside'; distanceMetres: number; beyondMetres: number }
  /** The outlet has no captured position, so there is nothing to judge against. */
  | { kind: 'unreferenced' }

/**
 * Judge a reading against an outlet's fence.
 *
 * Strictly on distance: a reading is not forgiven for being imprecise. Widening
 * the fence by the reported accuracy would turn a bad fix into a licence, and
 * the honest answer to an uncertain reading is a recorded human decision, not a
 * silently looser rule. The accuracy is stored and displayed beside the
 * distance so that decision can be an informed one.
 */
export function evaluateFence(reference: FenceReference, reading: Coordinates): FenceVerdict {
  if (reference.latitude === null || reference.longitude === null) {
    return { kind: 'unreferenced' }
  }

  const distance = distanceMetres(
    { latitude: reference.latitude, longitude: reference.longitude },
    reading,
  )

  return distance > reference.radiusMetres
    ? { kind: 'outside', distanceMetres: distance, beyondMetres: distance - reference.radiusMetres }
    : { kind: 'inside', distanceMetres: distance }
}

/**
 * How good a fix must be before it can become an outlet's permanent position.
 *
 * Stricter than anything applied at check-in, and deliberately so: this reading
 * is judged once and then judges every future check-in, whereas a poor fix at
 * check-in costs one override. Judged against a 150 m fence.
 */
export const CAPTURE_ACCURACY_GOOD_M = 25
export const CAPTURE_ACCURACY_MAX_M = 50

export type CaptureQuality = 'good' | 'imprecise' | 'unusable'

export function captureQuality(accuracyMetres: number): CaptureQuality {
  if (accuracyMetres <= CAPTURE_ACCURACY_GOOD_M) return 'good'
  if (accuracyMetres <= CAPTURE_ACCURACY_MAX_M) return 'imprecise'
  return 'unusable'
}

/** Metres, rendered the way every attendance surface renders them. */
export function formatMetres(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`
}
