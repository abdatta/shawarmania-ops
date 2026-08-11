import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OCCUPANCY_POLL_MS, resetApplyState, SETTLE_MS, startApplyLoop } from './apply-update'
import { beginWrite, declareUnsavedWork, resetOccupancy, watchTypedWork } from './occupancy'
import { getUpdateState, recordUpdateReady, resetUpdateState } from './update-store'

/**
 * When a waiting build is taken.
 *
 * The reload is the whole risk of this feature, so what these pin is mostly
 * when it must *not* happen: while somebody is working, during the settle, more
 * than once, or offline.
 */

const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

/**
 * The loop polls on a timer and measures the settle against a clock, so a test
 * has to move both. `performance.now` is not advanced by fake timers, and
 * spying on `window.setInterval` recurses in jsdom, where it is the same
 * function as `globalThis.setInterval` — hence the injected clock instead.
 */
let clock = 0

function advance(ms: number) {
  // Stepped one poll at a time rather than jumped, so the clock moves *between*
  // ticks as it does in life. Jumping it forward first makes every tick in the
  // jump read the same instant, and a settle measured across them never
  // elapses.
  let remaining = ms
  while (remaining > 0) {
    const step = Math.min(OCCUPANCY_POLL_MS, remaining)
    clock += step
    vi.advanceTimersByTime(step)
    remaining -= step
  }
}

describe('applying a waiting build', () => {
  let stopLoop: () => void
  let stopWatching: () => void
  let reload: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0

    resetOccupancy()
    resetUpdateState()
    resetApplyState()
    setOnLine(true)
    stopWatching = watchTypedWork()
    reload = vi.fn<() => void>()
    stopLoop = startApplyLoop({ reload, now: () => clock })
  })

  afterEach(() => {
    stopLoop()
    stopWatching()
    resetOccupancy()
    resetUpdateState()
    resetApplyState()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (originalOnLine) Object.defineProperty(Navigator.prototype, 'onLine', originalOnLine)
  })

  it('does nothing at all until a build is waiting', () => {
    advance(SETTLE_MS * 4)

    expect(reload).not.toHaveBeenCalled()
  })

  it('takes a build on a free page, after the settle', () => {
    recordUpdateReady()

    // Not immediately: a reload the instant one order settles lands as the
    // next one begins.
    advance(OCCUPANCY_POLL_MS)
    expect(reload).not.toHaveBeenCalled()

    advance(SETTLE_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload an occupied page, and offers the action instead', () => {
    const release = declareUnsavedWork('billing-composer')
    recordUpdateReady()

    advance(SETTLE_MS * 3)

    expect(reload).not.toHaveBeenCalled()
    expect(getUpdateState().deferred).toBe(true)
    release()
  })

  it('takes the build by itself once the work clears', () => {
    const release = declareUnsavedWork('billing-composer')
    recordUpdateReady()
    advance(SETTLE_MS * 2)
    expect(reload).not.toHaveBeenCalled()

    release()
    advance(SETTLE_MS + OCCUPANCY_POLL_MS)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('abandons a settle in progress if the work resumes', () => {
    recordUpdateReady()
    advance(OCCUPANCY_POLL_MS)

    // Somebody starts the next order before the settle elapses.
    const release = declareUnsavedWork('billing-composer')
    advance(SETTLE_MS * 3)

    expect(reload).not.toHaveBeenCalled()

    // And the settle starts over rather than resuming where it stopped.
    release()
    advance(OCCUPANCY_POLL_MS)
    expect(reload).not.toHaveBeenCalled()
    advance(SETTLE_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads while a write is in flight', () => {
    const settle = beginWrite()
    recordUpdateReady()

    advance(SETTLE_MS * 3)
    expect(reload).not.toHaveBeenCalled()

    settle()
    advance(SETTLE_MS + OCCUPANCY_POLL_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads a disconnected device', () => {
    setOnLine(false)
    recordUpdateReady()

    advance(SETTLE_MS * 5)

    expect(reload).not.toHaveBeenCalled()
    expect(getUpdateState().deferred).toBe(true)
  })

  it('reloads at most once, whatever the loop does afterwards', () => {
    recordUpdateReady()
    advance(SETTLE_MS + OCCUPANCY_POLL_MS)
    expect(reload).toHaveBeenCalledTimes(1)

    // A second detection, or simply more ticks, must not reload an unattended
    // tablet again.
    recordUpdateReady()
    advance(SETTLE_MS * 5)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('issues no reload after the loop is disposed', () => {
    recordUpdateReady()
    stopLoop()

    advance(SETTLE_MS * 5)

    expect(reload).not.toHaveBeenCalled()
  })
})
