import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAnalyticsClock } from './use-analytics-clock'

afterEach(() => vi.useRealTimers())

it('ticks exactly at an hour boundary and responds to foreground without waiting', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T18:59:30+05:30'))
  const hook = renderHook(() => useAnalyticsClock('04:00:00'))
  act(() => vi.advanceTimersByTime(30_000))
  expect(hook.result.current).toBe(Date.parse('2026-10-10T19:00:00+05:30'))
  vi.setSystemTime(new Date('2026-10-11T02:45:00+05:30'))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(hook.result.current).toBe(Date.now())
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('ticks at a cutoff with seconds before the next minute', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T04:30:29+05:30'))
  const hook = renderHook(() => useAnalyticsClock('04:30:30'))
  act(() => vi.advanceTimersByTime(1000))
  expect(hook.result.current).toBe(Date.parse('2026-10-11T04:30:30+05:30'))
  hook.unmount()
})
