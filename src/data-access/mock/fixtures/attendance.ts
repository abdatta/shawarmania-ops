import type { AttendanceStatus } from '../../adapters'
import {
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  DEMO_SPLIT_SHIFT_ACCOUNT_ID,
} from './accounts'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { personaFixtures } from './personas'

/**
 * The demo attendance days, as intent rather than as rows.
 *
 * Rows key on the person's account — staff are accounts, and the ids here are
 * profile ids from the accounts fixture.
 *
 * Coordinates are given; distances are not. The mock adapter computes them with
 * the same domain function the database's trigger mirrors, and applies the same
 * rule — an out-of-fence check-in with no override is not counted present. A
 * mock that hard-coded its distances could show a demo that the real system
 * could never produce, which is the one thing a demo must not do.
 *
 * A `manual` event carries an enterer instead of coordinates, exactly as the
 * database stores one: the admin typed it in, and the row says so wherever it
 * is read.
 *
 * Offsets are in business days back from today, so a walkthrough always shows a
 * plausible recent week rather than a date from whenever these were written.
 */

interface EventSeed {
  /** IST wall-clock time on the business day, `HH:MM`. */
  time: string
  latitude?: number
  longitude?: number
  accuracyMetres?: number
  /** Present on a manually entered event; coordinates must then be absent. */
  manual?: { byId: string; byName: string }
}

export interface AttendanceSeed {
  personId: string
  /**
   * Which outlet the day was worked at. Explicit since multi-outlet-people:
   * a person may hold assignments at several, so "their outlet" stopped being
   * a thing a seed could look up. Absent means their only assigned outlet,
   * which is every seed but the split shift's.
   */
  outletId?: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** The claim. The mock adjudicates it exactly as the database would. */
  status: AttendanceStatus
  checkIn?: EventSeed
  checkOut?: EventSeed
  override?: { byName: string; reason: string; time: string }
}

const DEMO_STAFF_ID = personaFixtures.employee.profile.id
const DEMO_MANAGER = personaFixtures.franchise_admin.profile

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346, accuracyMetres: 14 }
const NEAR_COUNTER = { latitude: 22.97488, longitude: 88.43441, accuracyMetres: 22 }
/** Roughly 240 m out — the shape of a real GPS drift, not a different town. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362, accuracyMetres: 48 }
/** Kanchrapara's counter, from its own outlet fixture. */
const AT_KANCHRAPARA = { latitude: 22.94508, longitude: 88.43312, accuracyMetres: 19 }
/** Further still, and with a loose fix: the reading a manager has to judge. */
const OFF_THE_MAP = { latitude: 22.97382, longitude: 88.43254, accuracyMetres: 65 }

export const attendanceSeeds: AttendanceSeed[] = [
  // ── The Employee persona's own week ──────────────────────────────────────
  //
  // Today is deliberately absent. The Employee persona's whole demo is the one
  // big button, so a walkthrough should arrive able to press it — a day already
  // started would make the fourth role a read-only screen. The mid-shift and
  // blocked states are demonstrated by colleagues on the manager's day view.
  //
  // A normal completed day.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '09:02', ...AT_COUNTER },
    checkOut: { time: '18:11', ...NEAR_COUNTER },
  },
  // A day that started outside the fence and was cleared by the manager — the
  // employee sees the approver and the reason, exactly as the manager does.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 2,
    status: 'present',
    checkIn: { time: '09:20', ...DOWN_THE_ROAD },
    checkOut: { time: '18:05', ...AT_COUNTER },
    override: {
      byName: 'Demo Manager',
      reason: 'Signal drift by the main road; seen at the counter at 9:15.',
      time: '09:26',
    },
  },
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 3,
    status: 'present',
    checkIn: { time: '08:58', ...AT_COUNTER },
    checkOut: { time: '17:40', ...AT_COUNTER },
  },
  { personId: DEMO_STAFF_ID, outletId: OUTLET_KALYANI_ID, daysAgo: 4, status: 'leave' },
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 5,
    status: 'present',
    checkIn: { time: '09:10', ...NEAR_COUNTER },
    // Checked out far away: recorded and flagged, never blocked (design D3).
    checkOut: { time: '18:30', ...DOWN_THE_ROAD },
  },

  // ── The manager's day: colleagues in different situations ────────────────
  {
    personId: DEMO_GRILLER_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:47', ...AT_COUNTER },
  },
  // Access was cut at lunchtime — the panic button — but the morning was
  // worked and the day view still shows the person (deactivation is about
  // sign-in, not existence).
  {
    personId: DEMO_PREP_COOK_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:55', ...NEAR_COUNTER },
  },
  // Awaiting a decision. Claimed present; the fence says otherwise and nobody
  // has blessed it, so it sits as absent until a manager acts.
  {
    personId: DEMO_RUNNER_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '09:33', ...OFF_THE_MAP },
  },
  // Yesterday the griller's phone died mid-shift, so the manager typed the
  // check-out in: a manual entry, visibly not a self check-in, with the
  // enterer stamped where the GPS evidence would be.
  {
    personId: DEMO_GRILLER_ACCOUNT_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '08:52', ...AT_COUNTER },
    checkOut: {
      time: '18:20',
      manual: { byId: DEMO_MANAGER.id, byName: DEMO_MANAGER.full_name },
    },
  },
  { personId: DEMO_RUNNER_ACCOUNT_ID, daysAgo: 1, status: 'absent' },

  // ── The split shift: one person, one business day, two outlets ───────────
  //
  // The case that did not exist before multi-outlet-people, and the one a
  // demonstrator has to be able to walk: a morning at Kalyani, an evening at
  // Kanchrapara, both from the same phone and the same single action, with
  // nothing anywhere asking them which shop they were at.
  {
    personId: DEMO_SPLIT_SHIFT_ACCOUNT_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '08:55', ...AT_COUNTER },
    checkOut: { time: '13:05', ...NEAR_COUNTER },
  },
  {
    personId: DEMO_SPLIT_SHIFT_ACCOUNT_ID,
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '15:10', ...AT_KANCHRAPARA },
    checkOut: { time: '21:20', ...AT_KANCHRAPARA },
  },
  // The Employee PERSONA's own split day — the one a demonstrator walks. Their
  // Kalyani morning is already in their week above; this is the evening at the
  // other shop, on the same business date, from the same phone.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '19:05', ...AT_KANCHRAPARA },
    checkOut: { time: '22:30', ...AT_KANCHRAPARA },
  },
  // And today, a morning at Kalyani already finished — so their big button
  // still offers a check-in, which the fence will resolve to wherever they
  // actually are next.
  {
    personId: DEMO_SPLIT_SHIFT_ACCOUNT_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:50', ...AT_COUNTER },
    checkOut: { time: '12:40', ...NEAR_COUNTER },
  },
]
