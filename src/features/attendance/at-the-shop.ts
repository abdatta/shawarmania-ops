import type { Tables } from '@/data-access/database.types'
import { distanceMetres, type Coordinates } from '@/domain'

/**
 * What a check-in's reading earns at an outlet under its attendance rules
 * (a-check-in-at-the-shop-approves-itself, design D1–D3).
 *
 * The database is the authority live: `attendance_submit_attempt_v3` decides
 * this from the coordinates it stores, with the same distance formula. This is
 * the demo's copy of that rule and the screen's way of saying what will happen
 * before anything is written, so the two read alike.
 *
 * - `approve`: inside the outlet's own radius, the outlet does not ask a manager
 *   for every check-in, and the reading is inside no other fence the person
 *   could be checking in at. Accuracy is not asked (owner, 2026-10-25): a rough
 *   reading inside the fence approves like a sharp one.
 * - `refuse`: the outlet blocks check-ins away from the shop, and this one is
 *   outside the fence or carries no position, or the outlet was never surveyed.
 * - `wait`: everything else, for a manager to settle, as every check-in did
 *   before this change.
 */
export type ShopVerdict = 'approve' | 'wait' | 'refuse'

/**
 * What a refused check-in says, live and in the demo alike (design D5): what
 * happened and what to do, in as few words as do it.
 */
export const BLOCKED_AWAY_MESSAGE = 'Not recorded: you’re not at the shop. Ask your manager.'

export type ShopFence = Pick<
  Tables<'outlets'>,
  | 'latitude'
  | 'longitude'
  | 'geofence_radius_m'
  | 'attendance_needs_manager'
  | 'attendance_blocks_away'
>

/** Metres from the outlet, or null when either side has no position. */
export function distanceFromShop(
  outlet: Pick<Tables<'outlets'>, 'latitude' | 'longitude'>,
  reading: Coordinates | null,
): number | null {
  if (reading === null || outlet.latitude === null || outlet.longitude === null) return null
  return distanceMetres({ latitude: outlet.latitude, longitude: outlet.longitude }, reading)
}

function inside(
  outlet: Pick<Tables<'outlets'>, 'latitude' | 'longitude' | 'geofence_radius_m'>,
  reading: Coordinates | null,
): boolean {
  const distance = distanceFromShop(outlet, reading)
  return distance !== null && distance <= outlet.geofence_radius_m
}

/**
 * @param others every other active outlet the person holds a live staff
 *   assignment at. A reading inside one of those fences too is ambiguous, and
 *   waits rather than approving a day at the wrong shop.
 */
export function shopVerdict(
  reading: Coordinates | null,
  outlet: ShopFence,
  others: readonly Pick<Tables<'outlets'>, 'latitude' | 'longitude' | 'geofence_radius_m'>[],
): ShopVerdict {
  const atTheShop = inside(outlet, reading)
  if (!atTheShop) return outlet.attendance_blocks_away ? 'refuse' : 'wait'
  if (outlet.attendance_needs_manager) return 'wait'
  if (others.some((other) => inside(other, reading))) return 'wait'
  return 'approve'
}
