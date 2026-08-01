import { describe, expect, it } from 'vitest'

import type { AttendanceApproval, AttendanceRecord } from '@/data-access/adapters'

import {
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
  return {
    id: 'row-1',
    outletId: OUTLET.id,
    outletName: OUTLET.name,
    personId: 'person-1',
    personName: 'Demo Staff',
    businessDate: '2026-07-25',
    status: 'absent',
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
      { businessDate: '2026-07-22', reading: { kind: 'absent' }, late: false },
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
