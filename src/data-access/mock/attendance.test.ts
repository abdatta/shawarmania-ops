import { describe, expect, it } from 'vitest'

import { instantOnBusinessDay, resolveBusinessDate, shiftBusinessDate } from '@/domain'

import { AttendanceActionError } from '../adapters'
import { createMockAttendanceAdapter } from './attendance'
import { DEMO_HELPER_ACCOUNT_ID, DEMO_RUNNER_ACCOUNT_ID } from './fixtures/accounts'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

const managerReading = {
  latitude: 22.97505,
  longitude: 88.4346,
  accuracyMetres: 12,
  at: new Date().toISOString(),
}

function today() {
  const outlet = outletFixtures.find((candidate) => candidate.id === OUTLET_KALYANI_ID)!
  return resolveBusinessDate(new Date(), outlet.business_day_cutover)
}

describe('the demo attendance reference clock', () => {
  it('supplies one context instant across differing outlet cutovers and ignores device time', async () => {
    let now = new Date('2026-08-20T02:00:00.000Z') // 07:30 in Kolkata.
    const adapter = createMockAttendanceAdapter({
      now: () => now,
      businessDayCutovers: {
        [OUTLET_KALYANI_ID]: '04:00:00',
        [OUTLET_KANCHRAPARA_ID]: '12:00:00',
      },
    })
    const context = await adapter.getCurrentContext([OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID])

    expect(context).toEqual({
      serverAt: '2026-08-20T02:00:00.000Z',
      outlets: [
        { outletId: OUTLET_KALYANI_ID, businessDate: '2026-08-20' },
        { outletId: OUTLET_KANCHRAPARA_ID, businessDate: '2026-08-19' },
      ],
    })

    const input = {
      personId: personaFixtures.employee.profile.id,
      outletId: OUTLET_KALYANI_ID,
      // Both legacy clock fields are deliberately wrong.
      businessDate: '2099-01-01',
      reading: {
        latitude: 22.97505,
        longitude: 88.4346,
        accuracyMetres: 12,
        at: '2099-01-01T00:00:00.000Z',
      },
      attemptId: 'e1000000-0000-4000-a000-000000000099',
    } as const
    const first = await adapter.checkIn(input)

    expect(first.businessDate).toBe('2026-08-20')
    expect(first.checkIn?.at).toBe('2026-08-20T02:00:00.000Z')

    now = new Date('2026-08-21T02:00:00.000Z')
    const replay = await adapter.checkIn(input)
    expect(replay.attempts).toHaveLength(1)
    expect(replay.checkIn?.at).toBe('2026-08-20T02:00:00.000Z')

    await expect(
      adapter.checkIn({
        ...input,
        reading: { ...input.reading, at: '2099-01-01T00:00:01.000Z' },
      }),
    ).rejects.toMatchObject({ code: 'changed_request' } satisfies Partial<AttendanceActionError>)

    await expect(
      adapter.checkIn({ ...input, outletId: 'ffffffff-ffff-4fff-afff-ffffffffffff' }),
    ).rejects.toMatchObject({ code: 'changed_request' } satisfies Partial<AttendanceActionError>)
  })

  it('uses its reference instant for position-free self-check-in but preserves manager testimony', async () => {
    const adapter = createMockAttendanceAdapter({
      now: () => new Date('2026-08-20T06:00:00.000Z'),
    })
    const positionFree = await adapter.checkIn({
      personId: DEMO_HELPER_ACCOUNT_ID,
      outletId: OUTLET_KALYANI_ID,
      businessDate: '1900-01-01',
      reading: null,
    })
    expect(positionFree.checkIn).toMatchObject({
      at: '2026-08-20T06:00:00.000Z',
      latitude: null,
      longitude: null,
    })

    const manualAt = '2026-08-20T05:45:00.000Z'
    const manual = await adapter.recordManualEntry({
      personId: personaFixtures.biller.profile.id,
      outletId: OUTLET_KALYANI_ID,
      businessDate: '2026-08-20',
      at: manualAt,
      enteredBy: personaFixtures.franchise_admin.profile.id,
    })
    expect(manual.checkIn?.at).toBe(manualAt)
    expect(manual.checkIn?.source).toBe('manual')
  })

  it('accepts a historical manual arrival only inside the staff assignment and outlet business day', async () => {
    const adapter = createMockAttendanceAdapter({
      now: () => new Date('2026-08-20T06:00:00.000Z'),
    })
    const outlet = outletFixtures.find((candidate) => candidate.id === OUTLET_KALYANI_ID)!
    const input = {
      personId: DEMO_HELPER_ACCOUNT_ID,
      outletId: OUTLET_KALYANI_ID,
      businessDate: '2026-08-19',
      at: instantOnBusinessDay('2026-08-19', '09:00', outlet.business_day_cutover),
      enteredBy: personaFixtures.franchise_admin.profile.id,
    }

    const recorded = await adapter.recordManualEntry(input)
    expect(recorded).toMatchObject({
      businessDate: '2026-08-19',
      status: 'present',
      checkIn: {
        at: input.at,
        source: 'manual',
        enteredBy: personaFixtures.franchise_admin.profile.id,
        latitude: null,
        longitude: null,
      },
      approval: { by: personaFixtures.franchise_admin.profile.id },
    })
    expect(recorded.attempts).toHaveLength(1)
    expect(recorded.decisions).toHaveLength(1)

    await expect(
      createMockAttendanceAdapter({
        now: () => new Date('2026-08-20T06:00:00.000Z'),
      }).recordManualEntry({
        ...input,
        businessDate: '2026-08-21',
        at: instantOnBusinessDay('2026-08-21', '09:00', outlet.business_day_cutover),
      }),
    ).rejects.toMatchObject({ code: 'future_date' } satisfies Partial<AttendanceActionError>)

    await expect(
      createMockAttendanceAdapter({
        now: () => new Date('2026-08-20T06:00:00.000Z'),
      }).recordManualEntry({
        ...input,
        at: instantOnBusinessDay('2026-08-18', '09:00', outlet.business_day_cutover),
      }),
    ).rejects.toMatchObject({ code: 'wrong_day' } satisfies Partial<AttendanceActionError>)

    await expect(
      createMockAttendanceAdapter({
        now: () => new Date('2026-08-20T06:00:00.000Z'),
      }).recordManualEntry({
        ...input,
        businessDate: '2026-04-19',
        at: instantOnBusinessDay('2026-04-19', '09:00', outlet.business_day_cutover),
      }),
    ).rejects.toMatchObject({ code: 'manual_refused' } satisfies Partial<AttendanceActionError>)

    await expect(
      createMockAttendanceAdapter({
        now: () => new Date('2026-08-20T06:00:00.000Z'),
      }).recordManualEntry({
        ...input,
        outletId: OUTLET_KANCHRAPARA_ID,
      }),
    ).rejects.toMatchObject({ code: 'manual_refused' } satisfies Partial<AttendanceActionError>)

    await expect(
      createMockAttendanceAdapter({
        now: () => new Date('2026-08-20T06:00:00.000Z'),
      }).recordManualEntry({
        ...input,
        enteredBy: personaFixtures.employee.profile.id,
      }),
    ).rejects.toMatchObject({ code: 'manual_refused' } satisfies Partial<AttendanceActionError>)
  })
})

describe('mock attendance denial and retries', () => {
  it('denies without manager GPS, keeps retry open, and retains absence through weak retries', async () => {
    const adapter = createMockAttendanceAdapter()
    const [waiting] = await adapter.listPersonRange(DEMO_RUNNER_ACCOUNT_ID, today(), today())
    expect(waiting?.currentAttemptId).not.toBeNull()

    const items = [
      {
        attendanceId: waiting!.id,
        expectedAttemptId: waiting!.currentAttemptId!,
        expectedVersion: waiting!.stateVersion,
        decisionId: 'e2000000-0000-4000-a000-000000000001',
      },
    ]

    await expect(
      adapter.deny(items, {
        commandId: 'e4000000-0000-4000-a000-000000000001',
        reason: '   ',
        preventRetry: false,
      }),
    ).rejects.toMatchObject({ code: 'reason_required' } satisfies Partial<AttendanceActionError>)

    const [denied] = await adapter.deny(items, {
      commandId: 'e4000000-0000-4000-a000-000000000002',
      reason: 'Not at outlet',
      preventRetry: false,
    })

    expect(denied!.status).toBe('absent')
    expect(denied!.currentAttemptId).toBeNull()
    expect(denied!.retry).toEqual({ allowed: true, reason: 'open-denial' })
    expect(denied!.decisions.at(-1)).toMatchObject({
      kind: 'deny',
      reason: 'Not at outlet',
      preventsRetry: false,
      latitude: null,
      longitude: null,
    })

    const attemptId = 'e1000000-0000-4000-a000-000000000001'
    const retry = await adapter.checkIn({
      personId: DEMO_RUNNER_ACCOUNT_ID,
      outletId: OUTLET_KALYANI_ID,
      businessDate: today(),
      reading: { ...managerReading, latitude: 22.9894, longitude: 88.4481 },
      attemptId,
      expectedVersion: denied!.stateVersion,
    })

    expect(retry.status).toBe('absent')
    expect(retry.currentAttemptId).toBe(attemptId)
    expect(retry.attempts).toHaveLength(2)
    expect(retry.retry.reason).toBe('outside-current')

    const exactReplay = await adapter.checkIn({
      personId: DEMO_RUNNER_ACCOUNT_ID,
      outletId: OUTLET_KALYANI_ID,
      businessDate: today(),
      reading: { ...managerReading, latitude: 22.9894, longitude: 88.4481 },
      attemptId,
      expectedVersion: denied!.stateVersion,
    })
    expect(exactReplay.attempts).toHaveLength(2)

    await expect(
      adapter.checkIn({
        personId: DEMO_RUNNER_ACCOUNT_ID,
        outletId: OUTLET_KALYANI_ID,
        businessDate: today(),
        reading: { ...managerReading, latitude: 22.9894, longitude: 88.4481, accuracyMetres: 99 },
        attemptId,
        expectedVersion: retry.stateVersion,
      }),
    ).rejects.toMatchObject({ code: 'changed_request' } satisfies Partial<AttendanceActionError>)

    await expect(
      adapter.checkIn({
        personId: DEMO_RUNNER_ACCOUNT_ID,
        outletId: OUTLET_KALYANI_ID,
        businessDate: today(),
        reading: null,
        attemptId: 'e1000000-0000-4000-a000-000000000002',
        expectedVersion: denied!.stateVersion,
      }),
    ).rejects.toMatchObject({ code: 'stale_state' } satisfies Partial<AttendanceActionError>)
  })

  it('reopens a prevented denial with an audited, locationless correction', async () => {
    const adapter = createMockAttendanceAdapter()
    const history = await adapter.listPersonRange(
      DEMO_RUNNER_ACCOUNT_ID,
      '2000-01-01',
      '2100-01-01',
    )
    const prevented = history.find((record) => record.retryBlocked)
    expect(prevented).toBeDefined()

    const reopened = await adapter.correct({
      attendanceId: prevented!.id,
      expectedVersion: prevented!.stateVersion,
      action: 'allow_retry',
      reason: 'Employee was assigned to the other outlet',
      reading: managerReading,
      decisionId: 'e3000000-0000-4000-a000-000000000001',
    })

    expect(reopened.status).toBe('absent')
    expect(reopened.retryBlocked).toBe(false)
    expect(reopened.retry).toEqual({ allowed: true, reason: 'open-denial' })
    expect(reopened.decisions.at(-1)).toMatchObject({
      kind: 'allow_retry',
      reason: 'Employee was assigned to the other outlet',
      latitude: null,
      longitude: null,
      accuracyMetres: null,
      distanceMetres: null,
    })
  })

  it('changes a settled historical time without changing its attempt, approval, or retry state', async () => {
    const adapter = createMockAttendanceAdapter()
    const history = await adapter.listPersonRange(
      DEMO_RUNNER_ACCOUNT_ID,
      '2000-01-01',
      '2100-01-01',
    )
    const settled = history.find((record) => record.checkIn && record.outcomeAttemptId)
    expect(settled).toBeDefined()
    const outlet = outletFixtures.find((candidate) => candidate.id === settled!.outletId)!
    const originalAttempt = settled!.attempts.find(
      (attempt) => attempt.id === settled!.outcomeAttemptId,
    )!
    const originalApproval = settled!.approval
    const originalRetry = settled!.retry
    const correctedAt = instantOnBusinessDay(
      settled!.businessDate,
      settled!.checkIn!.at.includes('T04:30') ? '11:30' : '10:30',
      outlet.business_day_cutover,
    )

    const corrected = await adapter.correct({
      attendanceId: settled!.id,
      expectedVersion: settled!.stateVersion,
      action: 'time',
      reason: 'Paper register shows the earlier arrival',
      reading: null,
      correctedAt,
    })

    expect(corrected.checkIn?.at).toBe(correctedAt)
    expect(corrected.attempts.find((attempt) => attempt.id === originalAttempt.id)?.at).toBe(
      originalAttempt.at,
    )
    expect(corrected.approval).toEqual(originalApproval)
    expect(corrected.retry).toEqual(originalRetry)
    expect(corrected.decisions.at(-1)).toMatchObject({
      kind: 'correct_time',
      reason: 'Paper register shows the earlier arrival',
      previousCheckInAt: settled!.checkIn!.at,
      newCheckInAt: correctedAt,
      latitude: null,
      longitude: null,
    })

    const correctedAgainAt = instantOnBusinessDay(
      settled!.businessDate,
      '12:30',
      outlet.business_day_cutover,
    )
    const correctedAgain = await adapter.correct({
      attendanceId: corrected.id,
      expectedVersion: corrected.stateVersion,
      action: 'time',
      reason: 'Owner confirmed the final time',
      reading: null,
      correctedAt: correctedAgainAt,
    })
    expect(correctedAgain.decisions.slice(-2).map((decision) => decision.kind)).toEqual([
      'correct_time',
      'correct_time',
    ])
    expect(correctedAgain.decisions.at(-1)?.previousCheckInAt).toBe(correctedAt)
    expect(correctedAgain.checkIn?.at).toBe(correctedAgainAt)

    // The probe goes to the day BEFORE, and the direction is the assertion.
    // The settled record the fixtures offer is yesterday's, so the day after it
    // is today: `instantOnBusinessDay(today, '10:30', …)` is in the future
    // every morning before half past ten, and the adapter answers `time_future`
    // before it ever reaches the wrong-day check. The day before is in the past
    // at every hour of every day, so only the rule under test can refuse it.
    await expect(
      adapter.correct({
        attendanceId: correctedAgain.id,
        expectedVersion: correctedAgain.stateVersion,
        action: 'time',
        reason: 'Wrong business day probe',
        reading: null,
        correctedAt: instantOnBusinessDay(
          shiftBusinessDate(settled!.businessDate, -1),
          '10:30',
          outlet.business_day_cutover,
        ),
      }),
    ).rejects.toMatchObject({ code: 'time_wrong_day' } satisfies Partial<AttendanceActionError>)
  })
})

/**
 * What the demo can actually be shown to demonstrate, on any date.
 *
 * The seeds are offsets back from today and the by-staff axis reads one calendar
 * month, so a state seeded deep enough is simply absent from the default view
 * for the first days of every month. Lateness was: one seed eight days back, so
 * a demo opened on the 5th showed `0 Late` for everybody and read as a feature
 * that had never been built.
 *
 * Asserted against the roll-call rather than against the seed array, because
 * what matters is what a demonstrator can point at — a seed whose time falls
 * before its own outlet's deadline is not a late day however it was intended.
 * Kanchrapara's deadline is 20:00 and Kalyani's 13:00, which is exactly the
 * mistake reading the seeds alone would let through.
 */
describe('the demo attendance seeds', () => {
  it('puts a late arrival within reach of a month opened on its first days', async () => {
    const adapter = createMockAttendanceAdapter()
    const cutovers = new Map(outletFixtures.map((o) => [o.id, o.business_day_cutover]))
    const outletIds = [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID]

    // The last three business days, which is what the current calendar month
    // still reaches on the 4th. Nothing can cover the 1st, when the month holds
    // only today, and nothing here pretends to.
    const late: string[] = []
    for (let back = 0; back <= 3; back += 1) {
      const date = shiftBusinessDate(today(), -back)
      for (const record of await adapter.listOutletDay(outletIds, date)) {
        const cutover = cutovers.get(record.outletId)
        if (!record.checkIn || record.arrivalDeadline === null || !cutover) continue
        const deadline = instantOnBusinessDay(record.businessDate, record.arrivalDeadline, cutover)
        if (record.checkIn.at > deadline) late.push(`${record.businessDate} ${record.personName}`)
      }
    }

    expect(late).not.toHaveLength(0)
  })
})
