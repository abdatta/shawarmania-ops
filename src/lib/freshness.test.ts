import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeBursts, NOTICE_BURST_MS, olderThan } from './freshness'

describe('olderThan', () => {
  it('counts a read never made as stale', () => {
    expect(olderThan(null, 1_000, 5_000)).toBe(true)
  })

  it('is stale only once the age is past the limit', () => {
    expect(olderThan(1_000, 2_000, 3_000)).toBe(false)
    expect(olderThan(1_000, 2_000, 3_001)).toBe(true)
  })
})

describe('mergeBursts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('answers a burst of notices with one run, after the last of them', () => {
    const run = vi.fn()
    const merger = mergeBursts(run)
    merger.notice()
    vi.advanceTimersByTime(NOTICE_BURST_MS - 1)
    merger.notice()
    vi.advanceTimersByTime(NOTICE_BURST_MS - 1)
    merger.notice()
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(NOTICE_BURST_MS)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs again for a notice after the burst', () => {
    const run = vi.fn()
    const merger = mergeBursts(run, 100)
    merger.notice()
    vi.advanceTimersByTime(100)
    merger.notice()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('forgets a pending run when cancelled', () => {
    const run = vi.fn()
    const merger = mergeBursts(run, 100)
    merger.notice()
    merger.cancel()
    vi.advanceTimersByTime(1_000)
    expect(run).not.toHaveBeenCalled()
  })
})
