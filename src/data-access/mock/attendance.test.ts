import { describe, expect, it } from 'vitest'

import { instantOnBusinessDay, resolveBusinessDate, shiftBusinessDate } from '@/domain'

import { AttendanceActionError } from '../adapters'
import { createMockAttendanceAdapter } from './attendance'
import { DEMO_RUNNER_ACCOUNT_ID } from './fixtures/accounts'
import { OUTLET_KALYANI_ID, outletFixtures } from './fixtures/outlets'

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

describe('mock attendance denial and retries', () => {
  it('denies without manager GPS, keeps retry open, and retains absence through weak retries', async () => {
    const adapter = createMockAttendanceAdapter()
    const [waiting] = await adapter.listPersonRange(DEMO_RUNNER_ACCOUNT_ID, today(), today())
    expect(waiting?.currentAttemptId).not.toBeNull()

    await expect(
      adapter.deny({
        attendanceId: waiting!.id,
        expectedAttemptId: waiting!.currentAttemptId!,
        expectedVersion: waiting!.stateVersion,
        reason: '   ',
        preventRetry: false,
      }),
    ).rejects.toMatchObject({ code: 'reason_required' } satisfies Partial<AttendanceActionError>)

    const denied = await adapter.deny({
      attendanceId: waiting!.id,
      expectedAttemptId: waiting!.currentAttemptId!,
      expectedVersion: waiting!.stateVersion,
      reason: 'Not at outlet',
      preventRetry: false,
      decisionId: 'e2000000-0000-4000-a000-000000000001',
    })

    expect(denied.status).toBe('absent')
    expect(denied.currentAttemptId).toBeNull()
    expect(denied.retry).toEqual({ allowed: true, reason: 'open-denial' })
    expect(denied.decisions.at(-1)).toMatchObject({
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
      expectedVersion: denied.stateVersion,
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
      expectedVersion: denied.stateVersion,
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
        expectedVersion: denied.stateVersion,
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

    await expect(
      adapter.correct({
        attendanceId: correctedAgain.id,
        expectedVersion: correctedAgain.stateVersion,
        action: 'time',
        reason: 'Wrong business day probe',
        reading: null,
        correctedAt: instantOnBusinessDay(
          shiftBusinessDate(settled!.businessDate, 1),
          '10:30',
          outlet.business_day_cutover,
        ),
      }),
    ).rejects.toMatchObject({ code: 'time_wrong_day' } satisfies Partial<AttendanceActionError>)
  })
})
