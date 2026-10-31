import { render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { gateAnswers } from '@/data-access/supabase-adapters/change-gates'
import { ChangeGatesForTest } from '@/test/change-gates'

import { GATE_READ_INTERVAL_MS, startChangeGateRefresh } from './refresh'
import { ALL_OFF } from './snapshot'
import { useDeviceHealthReport } from './use-device-health-report'
import { useGatesOnHealthReport } from './use-gates-on-report'

/**
 * A tablet's minute health report brings back the gate
 * answers, and the tablet stops reading them separately each minute
 * (the-app-asks-the-server-less, D8). A failed report falls back to a read, so
 * a turn still reaches the tablet within the minute.
 */

afterEach(() => vi.useRealTimers())

function refreshWith(minuteRead: boolean) {
  const read = vi.fn(async () => ({}))
  const saved: unknown[] = []
  let applied = 0
  let intervals = 0
  const stop = startChangeGateRefresh(
    { read, subscribe: () => () => {} },
    {
      booted: ALL_OFF,
      minuteRead,
      save: (answers) => void saved.push(answers),
      apply: () => void (applied += 1),
      setInterval: () => {
        intervals += 1
        return 1
      },
      clearInterval: () => {},
      setTimeout: () => 2,
      clearTimeout: () => {},
      document: null,
      window: null,
    },
  )
  return { read, saved, applied: () => applied, intervals: () => intervals, stop }
}

describe('a refresh whose answers ride on the health report', () => {
  it('sets no minute read of its own', () => {
    const refresh = refreshWith(false)
    expect(refresh.intervals()).toBe(0)
    refresh.stop()
  })

  it('keeps its minute read by default, as before', () => {
    const refresh = refreshWith(true)
    expect(refresh.intervals()).toBe(1)
    refresh.stop()
  })
})

describe('answers handed in by the health report', () => {
  type ReportAdapter = NonNullable<Parameters<typeof useDeviceHealthReport>[0]>

  function Reporter({ adapter }: { adapter: ReportAdapter }) {
    useDeviceHealthReport(adapter)
    return null
  }

  function renderReporter(adapter: ReportAdapter) {
    return render(
      <ChangeGatesForTest on={{ 'tablet-health': true }}>
        <Reporter adapter={adapter} />
      </ChangeGatesForTest>,
    )
  }

  it('are saved, and raise the update once when they differ from the boot', async () => {
    const refresh = refreshWith(false)
    const answers = { probe: true }
    const reportHealthReadingGates = vi.fn(async () => answers)
    renderReporter({ reportHealthReadingGates, read: vi.fn() })

    await vi.waitFor(() => expect(refresh.saved).toContainEqual(answers))
    expect(refresh.applied()).toBe(1)
    expect(refresh.read).not.toHaveBeenCalled()
    refresh.stop()
  })

  it('come from a plain read when the report fails', async () => {
    const refresh = refreshWith(false)
    const answers = { probe: true }
    const read = vi.fn(async () => answers)
    renderReporter({
      reportHealthReadingGates: vi.fn(async () => {
        throw new Error('offline')
      }),
      read,
    })

    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(refresh.saved).toContainEqual(answers))
    refresh.stop()
  })

  it('report again every minute, each time with the answers', async () => {
    vi.useFakeTimers()
    const refresh = refreshWith(false)
    const reportHealthReadingGates = vi.fn(async () => ({}))
    renderReporter({ reportHealthReadingGates, read: vi.fn() })
    vi.advanceTimersByTime(GATE_READ_INTERVAL_MS)
    expect(reportHealthReadingGates).toHaveBeenCalledTimes(2)
    refresh.stop()
  })

  it('reach no refresh that has stopped', async () => {
    const refresh = refreshWith(false)
    refresh.stop()
    const reportHealthReadingGates = vi.fn(async () => ({ probe: true }))
    renderReporter({ reportHealthReadingGates, read: vi.fn() })
    await vi.waitFor(() => expect(reportHealthReadingGates).toHaveBeenCalled())
    await Promise.resolve()
    expect(refresh.saved).toEqual([])
  })
})

describe('the v2 report’s answer', () => {
  it('keeps the boolean answers and refuses anything that is not an object', () => {
    expect(gateAnswers({ probe: true, 'tablet-health': false, odd: 'yes' })).toEqual({
      probe: true,
      'tablet-health': false,
    })
    expect(() => gateAnswers(null)).toThrow()
    expect(() => gateAnswers([true])).toThrow()
  })
})

describe('where a tablet takes its minute answers from', () => {
  for (const tabletHealth of [true, false]) {
    it(`${tabletHealth ? 'is the report' : 'is its own read'} with Tablet health ${tabletHealth ? 'on' : 'off'}`, () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ChangeGatesForTest on={{ 'tablet-health': tabletHealth }}>{children}</ChangeGatesForTest>
      )
      const { result } = renderHook(() => useGatesOnHealthReport(), { wrapper })
      expect(result.current).toBe(tabletHealth)
    })
  }
})
