import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BUILD_SHA } from '@/pwa/build-info'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { useDeviceHealthReport } from './use-device-health-report'

/**
 * A tablet reports its health only while Tablet health was on as its page
 * loaded, at once and then each minute (a-release-can-be-switched-off, D13).
 */

function Reporter({ reportHealth }: { reportHealth: () => Promise<void> }) {
  useDeviceHealthReport({ reportHealth })
  return null
}

afterEach(() => vi.useRealTimers())

describeChangeGate('tablet-health', (on) => {
  it(on ? 'reports at once and every minute' : 'reports nothing', () => {
    vi.useFakeTimers()
    const reportHealth = vi.fn().mockResolvedValue(undefined)
    render(
      <ChangeGatesForTest on={{ 'tablet-health': on, probe: true }}>
        <Reporter reportHealth={reportHealth} />
      </ChangeGatesForTest>,
    )
    vi.advanceTimersByTime(60_000)
    if (!on) {
      expect(reportHealth).not.toHaveBeenCalled()
      return
    }
    expect(reportHealth).toHaveBeenCalledTimes(2)
    expect(reportHealth.mock.calls[0]![0]).toMatchObject({
      build: BUILD_SHA,
      bootedGates: ['probe', 'tablet-health'],
      windowSeconds: 60,
    })
  })
})

describe('a failed report', () => {
  it('is dropped without throwing', () => {
    const reportHealth = vi.fn().mockRejectedValue(new Error('offline'))
    expect(() =>
      render(
        <ChangeGatesForTest on={{ 'tablet-health': true }}>
          <Reporter reportHealth={reportHealth} />
        </ChangeGatesForTest>,
      ),
    ).not.toThrow()
    expect(reportHealth).toHaveBeenCalledTimes(1)
  })
})
