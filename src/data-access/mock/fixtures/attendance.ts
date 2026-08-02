import type { AttendanceStatus } from '../../adapters'
import {
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  DEMO_TWO_OUTLETS_ACCOUNT_ID,
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
 * rule — a check-in nobody has approved is not counted present, however close to
 * the counter it was taken. A mock that hard-coded its distances could show a
 * demo the real system could never produce, which is the one thing a demo must
 * not do.
 *
 * The Employee persona's month is deliberately a *pattern* rather than a run of
 * identical good days, because the person view exists to show a pattern: it
 * holds an approved-on-site day, a day approved from elsewhere with the reason
 * that cost, a day still waiting for a manager, a late arrival, and days with
 * nothing recorded at all that the surfaces derive as absent.
 *
 * A `manual` event carries an enterer instead of coordinates, exactly as the
 * database stores one: the admin typed it in, the recording settled the day, and
 * the row says so wherever it is read.
 *
 * Offsets are in business days back from today, so a walkthrough always shows a
 * plausible recent month rather than dates from whenever these were written.
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

/**
 * The decision that settles a day. `reason` is absent on the honest path —
 * inside the fence, on the row's own business day — and required by the mock
 * (as by the database) whenever the approver's position was elsewhere or
 * missing.
 */
interface ApprovalSeed {
  byName: string
  /** IST wall-clock time on the business day, `HH:MM`. */
  time: string
  reason?: string
  latitude?: number
  longitude?: number
  accuracyMetres?: number
}

export interface AttendanceSeed {
  personId: string
  /**
   * Which outlet the day was worked at. Explicit since multi-outlet-people:
   * a person may hold assignments at several, so "their outlet" stopped being
   * a thing a seed could look up. Absent means their only assigned outlet,
   * which is every seed but the two-outlet people's.
   */
  outletId?: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** The claim. The mock adjudicates it exactly as the database would. */
  status: AttendanceStatus
  checkIn?: EventSeed
  approval?: ApprovalSeed
  /** A manager denial, retained even when a newer retry is pending. */
  denial?: {
    byName: string
    time: string
    reason: string
    preventRetry: boolean
  }
  /** A later immutable claim, potentially at the correct other outlet. */
  retryCheckIn?: EventSeed & { outletId: string }
  /** An audited correction after the original settlement. */
  correction?: {
    byName: string
    time: string
    reason: string
    kind: 'correct_present' | 'correct_absent'
  }
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
/** The manager's own reading, taken standing at Kalyani's counter. */
const APPROVED_AT_COUNTER = { latitude: 22.97501, longitude: 88.43452, accuracyMetres: 12 }
/** The manager's own reading, taken at home. Visible, and it costs a sentence. */
const APPROVED_FROM_HOME = { latitude: 22.9894, longitude: 88.4481, accuracyMetres: 28 }
/** As above, at Kanchrapara. */
const APPROVED_AT_KANCHRAPARA = { latitude: 22.94503, longitude: 88.43305, accuracyMetres: 16 }

export const attendanceSeeds: AttendanceSeed[] = [
  // ── The Employee persona's own month ─────────────────────────────────────
  //
  // Today is deliberately absent. The Employee persona's whole demo is the one
  // big button, so a walkthrough should arrive able to press it — a day already
  // recorded would make the fourth role a read-only screen. The waiting state is
  // demonstrated by colleagues on the manager's day view, and by this person's
  // own day five days back.
  //
  // A normal day: in the fence, approved by the manager standing at the counter
  // the same morning. One tap, no reason, and that is the point of the rule.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '09:02', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:18', ...APPROVED_AT_COUNTER },
  },
  // A day that started outside the fence and was settled by a manager who was
  // not there either — so the row carries their reason, and the employee sees
  // both facts exactly as the manager does.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 2,
    status: 'present',
    checkIn: { time: '09:20', ...DOWN_THE_ROAD },
    approval: {
      byName: DEMO_MANAGER.full_name,
      time: '09:26',
      reason: 'Signal drift by the main road; seen at the counter at 9:15 before I left.',
      ...APPROVED_FROM_HOME,
    },
    correction: {
      byName: DEMO_MANAGER.full_name,
      time: '10:05',
      reason: 'Confirmed the original present outcome after reviewing the shift log.',
      kind: 'correct_present',
    },
  },
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 3,
    status: 'present',
    checkIn: { time: '08:58', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:11', ...APPROVED_AT_COUNTER },
  },
  { personId: DEMO_STAFF_ID, outletId: OUTLET_KALYANI_ID, daysAgo: 4, status: 'leave' },
  // Recorded and still waiting. Nobody approved it, so it counts as nothing —
  // the state the whole change exists to make visible.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 5,
    status: 'present',
    checkIn: { time: '09:10', ...NEAR_COUNTER },
  },
  // Late: 14:20 against Kalyani's 13:00. Approved, so it is present AND late —
  // lateness is a tag, never a status.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 8,
    status: 'present',
    checkIn: { time: '14:20', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '14:35', ...APPROVED_AT_COUNTER },
  },
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 9,
    status: 'present',
    checkIn: { time: '09:05', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:20', ...APPROVED_AT_COUNTER },
  },
  // Days 7 and 10 hold nothing at all, so the month view derives them as
  // absent rather than skipping them. That is the reading no row can carry.
  // (Day 6 was worked at the other outlet — see the two-outlet seeds below.)
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 11,
    status: 'present',
    checkIn: { time: '08:51', ...NEAR_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:05', ...APPROVED_AT_COUNTER },
  },

  // ── The manager's day: colleagues in different situations ────────────────
  {
    personId: DEMO_GRILLER_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:47', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:02', ...APPROVED_AT_COUNTER },
  },
  // Access was cut at lunchtime — the panic button — but the morning was worked
  // and the day view still shows the person (deactivation is about sign-in, not
  // existence). Nobody has approved it, so it is still waiting.
  {
    personId: DEMO_PREP_COOK_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:55' },
  },
  // Waiting, and the reading is a poor one taken well outside the fence: the
  // row a manager actually has to think about before settling it.
  {
    personId: DEMO_RUNNER_ACCOUNT_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '09:33', ...OFF_THE_MAP },
  },
  // Yesterday the griller's phone died before their shift, so the manager typed
  // the arrival in: a manual entry, visibly not a self check-in, settled by the
  // act of recording it, with the enterer stamped where GPS evidence would be.
  {
    personId: DEMO_GRILLER_ACCOUNT_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: {
      time: '08:52',
      manual: { byId: DEMO_MANAGER.id, byName: DEMO_MANAGER.full_name },
    },
  },
  {
    personId: DEMO_RUNNER_ACCOUNT_ID,
    daysAgo: 1,
    status: 'absent',
    checkIn: { time: '09:24', ...DOWN_THE_ROAD },
    denial: {
      byName: DEMO_MANAGER.full_name,
      time: '09:32',
      reason: 'Not at outlet',
      preventRetry: true,
    },
  },

  // ── Two outlets, one day each ────────────────────────────────────────────
  //
  // The case a demonstrator has to be able to walk: somebody staffed at both
  // shops works at ONE of them on any given day, and their month is a mix. Both
  // check-ins came from the same phone and the same single action, with nothing
  // anywhere asking which shop they were at — the fence resolved it.
  //
  // The pair is deliberately on consecutive days rather than the same one, and
  // that is the whole demo: on D-1 Kanchrapara's manager must read this person
  // as working at another outlet rather than absent, and on D-2 Kalyani's
  // manager must read the mirror. A same-day pair is what the database now
  // refuses (attendance-one-day-per-person).
  {
    personId: DEMO_TWO_OUTLETS_ACCOUNT_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 1,
    status: 'present',
    checkIn: { time: '08:55', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:14', ...APPROVED_AT_COUNTER },
  },
  {
    personId: DEMO_TWO_OUTLETS_ACCOUNT_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 3,
    status: 'absent',
    checkIn: { time: '09:05', ...DOWN_THE_ROAD },
    denial: {
      byName: DEMO_MANAGER.full_name,
      time: '09:12',
      reason: 'Checked in to the wrong outlet',
      preventRetry: false,
    },
    retryCheckIn: { outletId: OUTLET_KANCHRAPARA_ID, time: '09:20' },
  },
  {
    personId: DEMO_TWO_OUTLETS_ACCOUNT_ID,
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 2,
    status: 'present',
    // Kanchrapara's 20:00 deadline is why a 15:10 arrival there is not late,
    // and why a combined roll-call must read each row's own outlet's clock.
    checkIn: { time: '15:10', ...AT_KANCHRAPARA },
    approval: { byName: DEMO_MANAGER.full_name, time: '15:28', ...APPROVED_AT_KANCHRAPARA },
  },
  // The Employee PERSONA works at both shops too, so their own month has to mix
  // them. Day 6 was otherwise empty, which makes this the one day in their
  // history that names the other outlet — and the proof that their combined
  // view lists each date once.
  {
    personId: DEMO_STAFF_ID,
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 6,
    status: 'present',
    checkIn: { time: '19:05', ...AT_KANCHRAPARA },
    approval: { byName: DEMO_MANAGER.full_name, time: '19:22', ...APPROVED_AT_KANCHRAPARA },
  },
  // And today, a morning at Kalyani already recorded and approved — so their big
  // button still offers a check-in, which the fence will resolve to wherever
  // they actually are next.
  {
    personId: DEMO_TWO_OUTLETS_ACCOUNT_ID,
    outletId: OUTLET_KALYANI_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '08:50', ...AT_COUNTER },
    approval: { byName: DEMO_MANAGER.full_name, time: '09:06', ...APPROVED_AT_COUNTER },
  },
  // Kanchrapara, today, waiting for somebody — and the owner holds no assignment
  // there (owner-reaches-every-outlet). This is the row that makes the owner's
  // reach walkable rather than asserted: they open the other shop's day, see an
  // arrival nobody has settled, and settle it. Left unapproved on purpose, so a
  // reset always returns the demo to a shop with work outstanding in it.
  {
    personId: DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    status: 'present',
    checkIn: { time: '10:40', ...AT_KANCHRAPARA },
  },
]
