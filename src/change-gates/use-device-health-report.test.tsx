import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BUILD_SHA } from '@/pwa/build-info'
import { ChangeGatesForTest } from '@/test/change-gates'

import { useDeviceHealthReport } from './use-device-health-report'

/**
 * A tablet reports its health as its page loads and then each minute
 * (a-release-can-be-switched-off, D13).
 */

function Reporter({ reportHealth }: { reportHealth: () => Promise<Record<string, boolean>> }) {
  useDeviceHealthReport({ reportHealthReadingGates: reportHealth, read: async () => ({}) })
  return null
}

afterEach(() => vi.useRealTimers())

describe('a tablet', () => {
  it('reports at once and every minute', () => {
    vi.useFakeTimers()
    const reportHealth = vi.fn().mockResolvedValue({})
    render(
      <ChangeGatesForTest on={{ probe: true }}>
        <Reporter reportHealth={reportHealth} />
      </ChangeGatesForTest>,
    )
    vi.advanceTimersByTime(60_000)
    expect(reportHealth).toHaveBeenCalledTimes(2)
    expect(reportHealth.mock.calls[0]![0]).toMatchObject({
      build: BUILD_SHA,
      bootedGates: ['probe'],
      windowSeconds: 60,
    })
  })
})

describe('a failed report', () => {
  it('is dropped without throwing', () => {
    const reportHealth = vi.fn().mockRejectedValue(new Error('offline'))
    expect(() =>
      render(
        <ChangeGatesForTest on={{}}>
          <Reporter reportHealth={reportHealth} />
        </ChangeGatesForTest>,
      ),
    ).not.toThrow()
    expect(reportHealth).toHaveBeenCalledTimes(1)
  })
})
