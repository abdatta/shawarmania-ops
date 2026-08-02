import { describe, expect, it } from 'vitest'

import { resolveBusinessDate } from '@/domain'

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
})
