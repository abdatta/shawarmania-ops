import { describe, expect, it } from 'vitest'

import type {
  AttendanceApproval,
  AttendanceDecision,
  AttendanceRecord,
} from '@/data-access/adapters'

import {
  explainAbsence,
  isLate,
  isWaitingForApproval,
  readDay,
  tallyDays,
  wasApprovedOnSite,
  type DayReading,
} from './attendance-record'
import { assembleRange, monthRange, shiftMonthRange } from './attendance-range'

/**
 * The three readings that are not columns.
 *
 * "Waiting for a manager", "late" and "absent because nobody came" are derived
 * from the stored evidence and the outlet's clock, and every surface asks this
 * module rather than working them out again. So this is where they are proved:
 * getting one of them wrong in one place would be a bug on one screen, and
 * getting it wrong here is a bug everywhere at once, which is the trade.
 */

const OUTLET = {
  id: 'outlet-1',
  name: 'Shawarmania Kalyani',
  arrival_deadline: '13:00:00',
  business_day_cutover: '04:00:00',
}

/**
 * The other shop, with a deliberately different deadline. Nothing here may
 * assume two outlets share a clock, even though production's currently do
 * (design D7).
 */
const LATE_OUTLET = {
  id: 'outlet-2',
  name: 'Shawarmania Kanchrapara',
  arrival_deadline: '20:00:00',
  business_day_cutover: '04:00:00',
}

/** 09:02 IST on 25 Jul 2026. */
const ON_TIME = '2026-07-25T03:32:00.000Z'
/** 14:20 IST the same day — after the 13:00 deadline. */
const LATE_ARRIVAL = '2026-07-25T08:50:00.000Z'

function record(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  const value: AttendanceRecord = {
    id: 'row-1',
    outletId: OUTLET.id,
    outletName: OUTLET.name,
    personId: 'person-1',
    personName: 'Demo Staff',
    businessDate: '2026-07-25',
    status: 'absent',
    stateVersion: 1,
    currentAttemptId: 'attempt-1',
    outcomeAttemptId: null,
    latestDecisionId: null,
    retryBlocked: false,
    attempts: [],
    decisions: [],
    retry: { allowed: false, reason: 'inside-current' },
    arrivalDeadline: '13:00:00',
    checkIn: {
      at: ON_TIME,
      latitude: 22.97505,
      longitude: 88.4346,
      accuracyMetres: 14,
      distanceMetres: 12,
      source: 'phone',
      enteredBy: null,
      enteredByName: null,
    },
    approval: null,
    ...overrides,
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'currentAttemptId')) {
    value.currentAttemptId =
      value.checkIn && !value.approval && value.status === 'absent' ? 'attempt-1' : null
  }
  return value
}

function approval(overrides: Partial<AttendanceApproval> = {}): AttendanceApproval {
  return {
    by: 'manager-1',
    byName: 'Demo Manager',
    at: '2026-07-25T03:48:00.000Z',
    reason: null,
    latitude: 22.97501,
    longitude: 88.43452,
    accuracyMetres: 12,
    distanceMetres: 6,
    ...overrides,
  }
}

describe('isWaitingForApproval', () => {
  it('is true for an arrival nobody has settled', () => {
    expect(isWaitingForApproval(record())).toBe(true)
  })

  it('is false once an approval is recorded', () => {
    expect(isWaitingForApproval(record({ status: 'present', approval: approval() }))).toBe(false)
  })

  it('is false for a day with no arrival at all', () => {
    // A manager-marked absence is not waiting on anybody.
    expect(isWaitingForApproval(record({ checkIn: null }))).toBe(false)
  })

  it('is false for a day recorded before approval was required', () => {
    // The one case design D10 turns on: a historic row carries an arrival, no
    // approval, and status `present`, because the old rule counted it. Reading
    // it as pending would show weeks of phantom waiting the moment this shipped.
    expect(isWaitingForApproval(record({ status: 'present', arrivalDeadline: null }))).toBe(false)
  })

  it('is false for a leave day', () => {
    expect(isWaitingForApproval(record({ status: 'leave', checkIn: null }))).toBe(false)
  })
})

describe('wasApprovedOnSite', () => {
  it('is true when the approver was inside the radius', () => {
    expect(wasApprovedOnSite(record({ approval: approval() }), 150)).toBe(true)
  })

  it('is false when they were beyond it', () => {
    expect(wasApprovedOnSite(record({ approval: approval({ distanceMetres: 1531 }) }), 150)).toBe(
      false,
    )
  })

  it('is false when no position was read at all', () => {
    // Not "unknown, so probably fine". An approval that cannot be placed reads
    // the same as one taken elsewhere, which is what the reason rule assumes.
    expect(wasApprovedOnSite(record({ approval: approval({ distanceMetres: null }) }), 150)).toBe(
      false,
    )
  })

  it('is false at an unsurveyed outlet, which can vouch for nobody', () => {
    expect(wasApprovedOnSite(record({ approval: approval({ distanceMetres: null }) }), 150)).toBe(
      false,
    )
  })
})

describe('isLate', () => {
  it('is false for an arrival before the stamped deadline', () => {
    expect(isLate(record(), OUTLET.business_day_cutover)).toBe(false)
  })

  it('is true for one after it', () => {
    expect(
      isLate(record({ checkIn: { ...record().checkIn!, at: LATE_ARRIVAL } }), '04:00:00'),
    ).toBe(true)
  })

  it('judges against the deadline stamped on the row, not the outlet’s current one', () => {
    // The row was recorded under a 15:00 rule. Whatever the outlet says today, a
    // 14:20 arrival was on time when it happened and stays on time.
    const row = record({
      arrivalDeadline: '15:00:00',
      checkIn: { ...record().checkIn!, at: LATE_ARRIVAL },
    })
    expect(isLate(row, '04:00:00')).toBe(false)
  })

  it('never calls a day late when no deadline was stamped', () => {
    const row = record({
      arrivalDeadline: null,
      checkIn: { ...record().checkIn!, at: LATE_ARRIVAL },
    })
    expect(isLate(row, '04:00:00')).toBe(false)
  })

  it('is false for a day with no arrival', () => {
    expect(isLate(record({ checkIn: null }), '04:00:00')).toBe(false)
  })
})

describe('readDay', () => {
  it('reads a stored row as recorded, whatever the clock says', () => {
    const reading = readDay(record({ status: 'leave', checkIn: null }), [OUTLET], '2026-07-25', {
      now: new Date('2026-07-30T00:00:00Z'),
    })
    expect(reading.kind).toBe('recorded')
  })

  it('reads an unsettled arrival as waiting', () => {
    expect(
      readDay(record(), [OUTLET], '2026-07-25', { now: new Date('2026-07-25T09:00:00Z') }).kind,
    ).toBe('waiting')
  })

  it('reads no row before the deadline as not yet arrived', () => {
    // 11:00 IST on the day, against a 13:00 deadline.
    const now = new Date('2026-07-25T05:30:00.000Z')
    expect(readDay(null, [OUTLET], '2026-07-25', { now }).kind).toBe('not-yet-arrived')
  })

  it('reads no row after the deadline as absent', () => {
    // 13:01 IST on the day.
    const now = new Date('2026-07-25T07:31:00.000Z')
    expect(readDay(null, [OUTLET], '2026-07-25', { now }).kind).toBe('absent')
  })

  it('reads every past day with no row as absent', () => {
    const now = new Date('2026-08-05T00:00:00.000Z')
    expect(readDay(null, [OUTLET], '2026-07-25', { now }).kind).toBe('absent')
  })

  // ── One day per person, whatever outlet it was worked at ──────────────────

  it('is not absent at one outlet on a day worked at another', () => {
    // The bug this change exists to remove: no row HERE, the deadline long
    // past, and the person was at work the whole time.
    const now = new Date('2026-08-05T00:00:00.000Z')
    expect(readDay(null, [OUTLET], '2026-07-25', { now, accountedForElsewhere: true }).kind).toBe(
      'elsewhere',
    )
  })

  it('says so before the deadline too, rather than "not yet arrived"', () => {
    // They have arrived. Just not here. Saying otherwise would be a false
    // statement about a day somebody is paid for.
    const now = new Date('2026-07-25T05:30:00.000Z')
    expect(readDay(null, [OUTLET], '2026-07-25', { now, accountedForElsewhere: true }).kind).toBe(
      'elsewhere',
    )
  })

  it('is absent once when nobody recorded them anywhere', () => {
    const now = new Date('2026-08-05T00:00:00.000Z')
    expect(
      readDay(null, [OUTLET, LATE_OUTLET], '2026-07-25', { now, accountedForElsewhere: false })
        .kind,
    ).toBe('absent')
  })

  it('waits for the latest deadline that could still see them', () => {
    // 13:01 IST: Kalyani has given up, the other shop has until 20:00. Somebody
    // staffed at both has not failed to turn up yet.
    const now = new Date('2026-07-25T07:31:00.000Z')
    expect(readDay(null, [OUTLET, LATE_OUTLET], '2026-07-25', { now }).kind).toBe('not-yet-arrived')
    // …and once even that has passed, they are absent.
    const later = new Date('2026-07-25T14:31:00.000Z')
    expect(readDay(null, [OUTLET, LATE_OUTLET], '2026-07-25', { now: later }).kind).toBe('absent')
  })

  it('lets a recorded leave day win over the elsewhere fact', () => {
    const reading = readDay(record({ status: 'leave', checkIn: null }), [OUTLET], '2026-07-25', {
      now: new Date('2026-07-30T00:00:00Z'),
      accountedForElsewhere: true,
    })
    expect(reading.kind).toBe('recorded')
  })
})

describe('tallyDays', () => {
  it('counts each reading once, and lateness alongside rather than instead', () => {
    const rows: { businessDate: string; reading: DayReading; late: boolean }[] = [
      {
        businessDate: '2026-07-25',
        reading: { kind: 'recorded', record: record({ status: 'present' }) },
        late: false,
      },
      {
        businessDate: '2026-07-24',
        reading: { kind: 'recorded', record: record({ status: 'present' }) },
        late: true,
      },
      { businessDate: '2026-07-23', reading: { kind: 'waiting', record: record() }, late: false },
      {
        businessDate: '2026-07-22',
        reading: { kind: 'absent', deadline: '2026-07-22T07:30:00.000Z' },
        late: false,
      },
      { businessDate: '2026-07-21', reading: { kind: 'not-yet-arrived' }, late: false },
    ]

    // The late day is present AND late: a tag, never a status, so it is counted
    // in both columns rather than taken out of the present one.
    expect(tallyDays(rows)).toEqual({ present: 2, late: 1, absent: 1, waiting: 1 })
  })

  it('counts one business date once, however many rows reach it', () => {
    // The summary is read to work out pay by hand, so it has to be a day count
    // rather than a row count.
    const twice: { businessDate: string; reading: DayReading; late: boolean }[] = [
      {
        businessDate: '2026-07-25',
        reading: { kind: 'recorded', record: record({ status: 'present' }) },
        late: false,
      },
      {
        businessDate: '2026-07-25',
        reading: { kind: 'recorded', record: record({ status: 'present' }) },
        late: false,
      },
    ]

    expect(tallyDays(twice)).toEqual({ present: 1, late: 0, absent: 0, waiting: 0 })
  })

  it('counts a day worked elsewhere as neither present nor absent', () => {
    expect(
      tallyDays([{ businessDate: '2026-07-25', reading: { kind: 'elsewhere' }, late: false }]),
    ).toEqual({ present: 0, late: 0, absent: 0, waiting: 0 })
  })
})

/**
 * The wordings the surfaces cannot reach.
 *
 * The component suites cover the two shapes the demo holds — a denial and a
 * deadline — and the fixtures hold no correction to absent and no reopened
 * retry, both of which a real manager can produce in two taps. They are proved
 * here rather than by inventing fixtures, because this is the module that
 * decides them.
 */
describe('explainAbsence', () => {
  function decision(overrides: Partial<AttendanceDecision> = {}): AttendanceDecision {
    return {
      id: 'decision-1',
      attemptId: 'attempt-1',
      outletId: OUTLET.id,
      outletName: OUTLET.name,
      kind: 'deny',
      by: 'manager-1',
      byName: 'Demo Manager',
      at: '2026-07-25T04:00:00.000Z',
      reason: 'Not at outlet',
      preventsRetry: true,
      previousStatus: 'absent',
      newStatus: 'absent',
      latitude: null,
      longitude: null,
      accuracyMetres: null,
      distanceMetres: null,
      previousCheckInAt: null,
      newCheckInAt: null,
      ...overrides,
    }
  }

  /** A settled absent row carrying exactly these decisions. */
  function settled(decisions: AttendanceDecision[]): DayReading {
    return {
      kind: 'recorded',
      record: record({
        status: 'absent',
        currentAttemptId: null,
        latestDecisionId: decisions.at(-1)?.id ?? null,
        decisions,
      }),
    }
  }

  /** A manager reading somebody else's day: neither id matches theirs. */
  const asManager = { viewerId: 'manager-2', subjectId: 'person-1' }
  /** The person the day belongs to, reading their own history. */
  const asSubject = { viewerId: 'person-1', subjectId: 'person-1' }
  /** The manager who made the decision, reading their own back. */
  const asActor = { viewerId: 'manager-1', subjectId: 'person-1' }

  it('says what a corrected day counted as before, which is what a denial cannot say', () => {
    const corrected = settled([
      decision({
        kind: 'correct_absent',
        previousStatus: 'present',
        reason: 'Shift log shows he left before opening',
      }),
    ])

    expect(explainAbsence(corrected, asManager)).toEqual({
      text: 'Demo Manager changed this from present to absent.',
      note: 'Shift log shows he left before opening',
    })
  })

  /**
   * A decision that adjusts an absence must not displace the one that caused it.
   *
   * Both kinds below record `absent` as their new status while deciding nothing
   * about the outcome — one opens the door to another check-in, the other closes
   * it. Showing the newest of them answers "why am I absent" with "a manager kept
   * it absent", which answers nothing, and buries the denial that is the actual
   * reason. The retry change is still in the history beneath.
   */
  describe('names the decision that caused the absence, not the last one to touch it', () => {
    /** The denial, then a manager reopening the retry as a favour. */
    const reopened = settled([
      decision({ id: 'decision-1', at: '2026-07-25T04:00:00.000Z' }),
      decision({
        id: 'decision-2',
        kind: 'allow_retry',
        at: '2026-07-25T06:00:00.000Z',
        reason: 'Phone had no signal at the counter',
      }),
    ])

    /** The denial, then `Keep absent and prevent another check-in`. */
    const locked = settled([
      decision({ id: 'decision-1', at: '2026-07-25T04:00:00.000Z' }),
      decision({
        id: 'decision-2',
        kind: 'correct_absent',
        at: '2026-07-25T06:00:00.000Z',
        reason: 'Spoke to him, he was not at the shop',
      }),
    ])

    it('survives the retry being reopened', () => {
      expect(explainAbsence(reopened, asManager)).toEqual({
        text: 'Demo Manager denied the check-in.',
        note: 'Not at outlet',
      })
    })

    it('survives the retry being closed', () => {
      // `correct_absent` on a day that was already absent moved nothing: its
      // previous and new status are both absent. Only the retry lock changed.
      expect(explainAbsence(locked, asManager)).toEqual({
        text: 'Demo Manager denied the check-in.',
        note: 'Not at outlet',
      })
    })
  })

  it('claims no actor for an absence no decision accounts for', () => {
    // The pre-migration absent rows 20260802000001's backfill skipped. There is
    // nobody to name, so it names nobody — and one sentence serves both readers,
    // because with the day unnamed there is nothing left to make possessive.
    expect(explainAbsence(settled([]), asManager)).toEqual({
      text: 'Recorded absent, with no manager decision explaining it.',
      note: null,
    })
    expect(explainAbsence(settled([]), asSubject)?.text).toBe(
      'Recorded absent, with no manager decision explaining it.',
    )
  })

  it('stays silent about a row still waiting for its first decision', () => {
    // Stored `absent` because every unapproved check-in is. It is a claim nobody
    // has settled, not an absence, and the verdict above it says so.
    expect(explainAbsence({ kind: 'waiting', record: record() }, asManager)).toBeNull()
  })

  it('stays silent about the readings that have nothing to explain', () => {
    expect(explainAbsence({ kind: 'not-yet-arrived' }, asManager)).toBeNull()
    expect(explainAbsence({ kind: 'elsewhere' }, asManager)).toBeNull()
    expect(
      explainAbsence({ kind: 'recorded', record: record({ status: 'leave' }) }, asManager),
    ).toBeNull()
  })

  /**
   * Who the sentence is addressed to.
   *
   * Two substitutions, from two ids, and the failure they exist to prevent is
   * specific: "you did not check in" shown to a manager reading somebody else's
   * row is a false statement about that person's pay.
   */
  describe('addresses the reader it actually has', () => {
    /** 13:00 in Asia/Kolkata — Kalyani's arrival deadline. */
    const missed: DayReading = { kind: 'absent', deadline: '2026-07-25T07:30:00.000Z' }

    it('speaks to the person whose day it is', () => {
      expect(explainAbsence(settled([decision()]), asSubject)).toEqual({
        text: 'Demo Manager denied your check-in.',
        note: 'Not at outlet',
      })
      expect(explainAbsence(missed, asSubject)?.text).toBe('You did not check in by 01:00 pm.')
    })

    it('speaks to the manager who made the decision', () => {
      expect(explainAbsence(settled([decision()]), asActor)?.text).toBe('You denied the check-in.')
      // The verb does not change with the person, which is what keeps this to one
      // template rather than one per voice.
      expect(
        explainAbsence(settled([decision({ kind: 'correct_absent', previousStatus: 'leave' })]), {
          ...asActor,
        })?.text,
      ).toBe('You changed this from leave to absent.')
    })

    it('tells a manager reading somebody else’s day nothing about themselves', () => {
      // The whole point. A manager scanning a roll-call must never be told they
      // failed to check in, or that somebody else's day is theirs.
      expect(explainAbsence(missed, asManager)?.text).toBe('No check-in by 01:00 pm.')
      expect(explainAbsence(settled([decision()]), asManager)?.text).toBe(
        'Demo Manager denied the check-in.',
      )
    })

    it('does not read two unknowns as a match', () => {
      // A caller with nothing to say passes nulls. Treating null === null as
      // "this is your day" would address every reader as the subject.
      expect(explainAbsence(missed, { viewerId: null, subjectId: null })?.text).toBe(
        'No check-in by 01:00 pm.',
      )
    })
  })
})

describe('monthRange', () => {
  it('spans a whole calendar month', () => {
    expect(monthRange('2026-07-25')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('handles a short month without knowing about leap years', () => {
    expect(monthRange('2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('walks back and forward across a year boundary', () => {
    expect(shiftMonthRange(monthRange('2026-01-15'), -1)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(shiftMonthRange(monthRange('2025-12-15'), 1)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
  })
})

describe('assembleRange', () => {
  const windows = [{ outletId: OUTLET.id, startedOn: '2026-07-20', endedOn: null }]
  /** 26 Jul 2026, 20:00 IST — so 26 Jul is today and its deadline has passed. */
  const now = new Date('2026-07-26T14:30:00.000Z')

  it('paints a day for every date in range, row or no row', () => {
    const rows = assembleRange({
      records: [record({ businessDate: '2026-07-24', status: 'present', approval: approval() })],
      outlets: [OUTLET],
      range: { from: '2026-07-22', to: '2026-07-26' },
      windows,
      now,
    })

    expect(rows.map((row) => row.businessDate)).toEqual([
      '2026-07-26',
      '2026-07-25',
      '2026-07-24',
      '2026-07-23',
      '2026-07-22',
    ])
    expect(rows.find((row) => row.businessDate === '2026-07-24')?.reading.kind).toBe('recorded')
    // Nothing recorded, and past their deadlines.
    expect(rows.find((row) => row.businessDate === '2026-07-23')?.reading.kind).toBe('absent')
  })

  it('paints nothing before the person was assigned', () => {
    const rows = assembleRange({
      records: [],
      outlets: [OUTLET],
      range: { from: '2026-07-15', to: '2026-07-26' },
      windows,
      now,
    })

    // Hired on the 20th: the five days before that are not absences of theirs.
    expect(rows.every((row) => row.businessDate >= '2026-07-20')).toBe(true)
  })

  it('paints nothing after the assignment ended', () => {
    const rows = assembleRange({
      records: [],
      outlets: [OUTLET],
      range: { from: '2026-07-20', to: '2026-07-26' },
      windows: [{ outletId: OUTLET.id, startedOn: '2026-07-20', endedOn: '2026-07-22' }],
      now,
    })

    expect(rows.map((row) => row.businessDate)).toEqual(['2026-07-22', '2026-07-21', '2026-07-20'])
  })

  it('never paints a day that has not happened', () => {
    const rows = assembleRange({
      records: [],
      outlets: [OUTLET],
      range: { from: '2026-07-24', to: '2026-08-31' },
      windows,
      now,
    })

    // A day in the future is not an absence.
    expect(rows[0]?.businessDate).toBe('2026-07-26')
  })

  it('marks a late arrival late, from the deadline the row carries', () => {
    const rows = assembleRange({
      records: [
        record({
          businessDate: '2026-07-24',
          status: 'present',
          approval: approval(),
          checkIn: { ...record().checkIn!, at: '2026-07-24T08:50:00.000Z' },
        }),
      ],
      outlets: [OUTLET],
      range: { from: '2026-07-24', to: '2026-07-24' },
      windows,
      now,
    })

    expect(rows[0]?.late).toBe(true)
  })

  // ── A month that mixes two outlets ────────────────────────────────────────

  const bothWindows = [
    { outletId: OUTLET.id, startedOn: '2026-07-20', endedOn: null },
    { outletId: LATE_OUTLET.id, startedOn: '2026-07-20', endedOn: null },
  ]
  /** 26 Jul, 20:30 IST — past the later of the two deadlines as well as the earlier. */
  const nowLate = new Date('2026-07-26T15:00:00.000Z')

  it('lists each business date once, naming the outlet it was worked at', () => {
    const rows = assembleRange({
      records: [
        record({
          businessDate: '2026-07-24',
          status: 'present',
          approval: approval(),
          // 09:02 IST on its own date, so the row is on time at Kalyani.
          checkIn: { ...record().checkIn!, at: '2026-07-24T03:32:00.000Z' },
        }),
        record({
          businessDate: '2026-07-23',
          outletId: LATE_OUTLET.id,
          outletName: LATE_OUTLET.name,
          status: 'present',
          arrivalDeadline: '20:00:00',
          approval: approval(),
          // 15:10 IST: late at Kalyani, on time at the shop it was worked at.
          checkIn: { ...record().checkIn!, at: '2026-07-23T09:40:00.000Z' },
        }),
      ],
      outlets: [OUTLET, LATE_OUTLET],
      range: { from: '2026-07-22', to: '2026-07-26' },
      windows: bothWindows,
      now: nowLate,
    })

    // Five dates, five rows. Assembled per outlet this would have been ten, half
    // of them absences on days the person was at work.
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((row) => row.businessDate)).size).toBe(5)
    expect(rows.find((row) => row.businessDate === '2026-07-24')?.outletName).toBe(OUTLET.name)
    expect(rows.find((row) => row.businessDate === '2026-07-23')?.outletName).toBe(LATE_OUTLET.name)
    // …and the summary over them is a day count.
    expect(tallyDays(rows)).toEqual({ present: 2, late: 0, absent: 3, waiting: 0 })
  })

  it('names no outlet on a day nobody recorded', () => {
    const rows = assembleRange({
      records: [],
      outlets: [OUTLET, LATE_OUTLET],
      range: { from: '2026-07-25', to: '2026-07-25' },
      windows: bothWindows,
      now: nowLate,
    })

    // A day nobody recorded was worked nowhere. Naming a shop beside it is how
    // the old code produced two contradictory verdicts for one date.
    expect(rows[0]?.outletId).toBeNull()
    expect(rows[0]?.outletName).toBeNull()
  })

  it('judges lateness by the row’s own outlet, not the other one', () => {
    // 15:10 IST: past Kalyani's 13:00, well inside Kanchrapara's 20:00.
    const rows = assembleRange({
      records: [
        record({
          businessDate: '2026-07-24',
          outletId: LATE_OUTLET.id,
          outletName: LATE_OUTLET.name,
          status: 'present',
          arrivalDeadline: '20:00:00',
          approval: approval(),
          checkIn: { ...record().checkIn!, at: '2026-07-24T09:40:00.000Z' },
        }),
      ],
      outlets: [OUTLET, LATE_OUTLET],
      range: { from: '2026-07-24', to: '2026-07-24' },
      windows: bothWindows,
      now: nowLate,
    })

    expect(rows[0]?.late).toBe(false)
  })
})
