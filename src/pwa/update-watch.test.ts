import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startUpdateWatch, UPDATE_CHECK_INTERVAL_MS } from './update-watch'

/**
 * When the app goes looking for a new build.
 *
 * The absence of a cooldown is a requirement rather than an omission: closing
 * and reopening the app is the one manual override there is, and a cooldown is
 * exactly what would make it unreliable.
 */

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('watching for a new build', () => {
  let check: ReturnType<typeof vi.fn<() => void>>
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    check = vi.fn<() => void>()
    stop = startUpdateWatch(check)
  })

  afterEach(() => {
    stop()
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('checks on the interval', () => {
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('checks on returning to the foreground', () => {
    setVisibility('hidden')
    expect(check).not.toHaveBeenCalled()

    setVisibility('visible')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('checks on regaining connectivity', () => {
    // The common sequence at an outlet: the connection drops, a build is
    // published, the connection returns.
    window.dispatchEvent(new Event('online'))

    expect(check).toHaveBeenCalledTimes(1)
  })

  it('applies no cooldown between checks', () => {
    setVisibility('hidden')
    setVisibility('visible')
    setVisibility('hidden')
    setVisibility('visible')
    window.dispatchEvent(new Event('online'))

    expect(check).toHaveBeenCalledTimes(3)
  })

  it('issues no check after it is disposed', () => {
    stop()

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 3)
    setVisibility('hidden')
    setVisibility('visible')
    window.dispatchEvent(new Event('online'))

    expect(check).not.toHaveBeenCalled()
  })
})
