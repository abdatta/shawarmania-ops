import type { AttendanceStatus } from '../../adapters'
import {
  DEMO_BLOCKED_EMPLOYEE_ID,
  DEMO_GRILLER_EMPLOYEE_ID,
  DEMO_STAFF_EMPLOYEE_ID,
} from './employees'

/**
 * The demo attendance days, as intent rather than as rows.
 *
 * Coordinates are given; distances are not. The mock adapter computes them with
 * the same domain function the database's trigger mirrors, and applies the same
 * rule — an out-of-fence check-in with no override is not counted present. A
 * mock that hard-coded its distances could show a demo that the real system
 * could never produce, which is the one thing a demo must not do.
 *
 * Offsets are in business days back from today, so a walkthrough always shows a
 * plausible recent week rather than a date from whenever these were written.
 */

interface EventSeed {
  /** IST wall-clock time on the business day, `HH:MM`. */
  time: string
  latitude: number
  longitude: number
  accuracyMetres: number
}

export interface AttendanceSeed {
  employeeId: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** The claim. The mock adjudicates it exactly as the database would. */
  status: AttendanceStatus
  checkIn?: EventSeed
  checkOut?: EventSeed
  override?: { byName: string; reason: string; time: string }
}

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346, accuracyMetres: 14 }
const NEAR_COUNTER = { latitude: 22.97488, longitude: 88.43441, accuracyMetres: 22 }
/** Roughly 240 m out — the shape of a real GPS drift, not a different town. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362, accuracyMetres: 48 }
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
    employeeId: DEMO_STAFF_EMPLOYEE_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '09:02', ...AT_COUNTER },
    checkOut: { time: '18:11', ...NEAR_COUNTER },
  },
  // A day that started outside the fence and was cleared by the manager — the
  // employee sees the approver and the reason, exactly as the manager does.
  {
    employeeId: DEMO_STAFF_EMPLOYEE_ID,
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
    employeeId: DEMO_STAFF_EMPLOYEE_ID,
    daysAgo: 3,
    status: 'present',
    checkIn: { time: '08:58', ...AT_COUNTER },
    checkOut: { time: '17:40', ...AT_COUNTER },
  },
  { employeeId: DEMO_STAFF_EMPLOYEE_ID, daysAgo: 4, status: 'leave' },
  {
    employeeId: DEMO_STAFF_EMPLOYEE_ID,
    daysAgo: 5,
    status: 'present',
    checkIn: { time: '09:10', ...NEAR_COUNTER },
    // Checked out far away: recorded and flagged, never blocked (design D3).
    checkOut: { time: '18:30', ...DOWN_THE_ROAD },
  },

  // ── The manager's day: three colleagues, three different situations ──────
  {
    employeeId: DEMO_GRILLER_EMPLOYEE_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:47', ...AT_COUNTER },
  },
  // Awaiting a decision. Claimed present; the fence says otherwise and nobody
  // has blessed it, so it sits as absent until a manager acts.
  {
    employeeId: DEMO_BLOCKED_EMPLOYEE_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '09:33', ...OFF_THE_MAP },
  },
  {
    employeeId: DEMO_GRILLER_EMPLOYEE_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '08:52', ...AT_COUNTER },
    checkOut: { time: '18:20', ...AT_COUNTER },
  },
  { employeeId: DEMO_BLOCKED_EMPLOYEE_ID, daysAgo: 1, status: 'absent' },
]
