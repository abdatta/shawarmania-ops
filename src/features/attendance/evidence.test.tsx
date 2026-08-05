import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AttendanceRecord } from '@/data-access/adapters'

import { DayVerdict } from './evidence'

/**
 * The shared verdict, tested where it is written rather than through the three
 * surfaces that render it.
 *
 * `DayVerdict` is imported by the roll-call, the person's month and the
 * employee's own history, deliberately — asymmetric visibility in a monitoring
 * feature is how it becomes something staff resent. So the order its parts read
 * in is one fact with one place to assert it.
 */

/**
 * A settled present day, carrying only what the verdict actually reads.
 *
 * `currentAttemptId` is null on purpose: an attempt still current is an arrival
 * nobody has decided on, and the verdict would read "Waiting for a manager to
 * approve" rather than "Present".
 */
function presentDay(): AttendanceRecord {
  return {
    id: 'a1',
    outletId: 'o1',
    outletName: 'Shawarmania Kalyani',
    personId: 'p1',
    personName: 'Ariful Biswas',
    businessDate: '2026-08-03',
    status: 'present',
    stateVersion: 2,
    currentAttemptId: null,
    outcomeAttemptId: 't1',
    latestDecisionId: 'd1',
    retryBlocked: false,
    attempts: [],
    decisions: [],
    retry: { allowed: false, reason: 'settled' },
    checkIn: {
      at: '2026-08-03T05:10:00.000Z',
      latitude: null,
      longitude: null,
      accuracyMetres: null,
      distanceMetres: null,
      source: 'phone',
      enteredBy: null,
      enteredByName: null,
    },
    approval: null,
    arrivalDeadline: '10:00:00',
  }
}

describe('the day verdict', () => {
  it('reads the late tag before the verdict it qualifies', () => {
    render(<DayVerdict record={presentDay()} late />)

    // "late Present", not "Present late". The tag qualifies the verdict, and a
    // reader scanning a column of days meets the qualifier first. Asserted on
    // document order rather than on the text of either part, because that is
    // the whole of what this pins.
    const tag = screen.getByTestId('late-tag')
    const verdict = screen.getByText('Present')
    expect(tag.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('still reads the verdict alone when the day was not late', () => {
    render(<DayVerdict record={presentDay()} />)

    expect(screen.getByText('Present')).toBeInTheDocument()
    expect(screen.queryByTestId('late-tag')).not.toBeInTheDocument()
  })
})
