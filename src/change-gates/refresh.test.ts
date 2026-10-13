import { describe, expect, it, vi } from 'vitest'

import { GATE_READ_INTERVAL_MS, startChangeGateRefresh } from './refresh'
import { ALL_OFF } from './snapshot'

/**
 * How a device keeps its gate answers current (a-release-can-be-switched-off,
 * D6): every trigger reads, one read at a time with one trailing read, a fresh
 * answer is saved, and an answer that differs from what the page booted with
 * raises the update signal once. Every failure keeps what the device has.
 */

interface Harness {
  read: ReturnType<typeof vi.fn>
  subscribers: (() => void)[]
  saved: Record<string, boolean>[]
  applied: number
  timers: { interval?: () => void; first?: () => void }
  visibility: { state: DocumentVisibilityState; listeners: (() => void)[] }
  online: (() => void)[]
  stop: () => void
}

function harness(
  answers: () => Promise<Record<string, boolean>>,
  options: { subscribeThrows?: boolean } = {},
): Harness {
  const h = {
    read: vi.fn(answers),
    subscribers: [] as (() => void)[],
    saved: [] as Record<string, boolean>[],
    applied: 0,
    timers: {} as Harness['timers'],
    visibility: { state: 'visible' as DocumentVisibilityState, listeners: [] as (() => void)[] },
    online: [] as (() => void)[],
    stop: () => {},
  }
  h.stop = startChangeGateRefresh(
    {
      read: h.read,
      subscribe: (onChange) => {
        if (options.subscribeThrows) throw new Error('no channel')
        h.subscribers.push(onChange)
        return () => {
          h.subscribers = h.subscribers.filter((listener) => listener !== onChange)
        }
      },
    },
    {
      booted: ALL_OFF,
      save: (saved) => void h.saved.push(saved as Record<string, boolean>),
      apply: () => void (h.applied += 1),
      setInterval: (callback) => {
        h.timers.interval = callback
        return 1
      },
      clearInterval: () => {},
      setTimeout: (callback) => {
        h.timers.first = callback
        return 2
      },
      clearTimeout: () => {},
      document: {
        get visibilityState() {
          return h.visibility.state
        },
        addEventListener: (_: string, listener: () => void) =>
          void h.visibility.listeners.push(listener),
        removeEventListener: () => {},
      } as never,
      window: {
        addEventListener: (_: string, listener: () => void) => void h.online.push(listener),
        removeEventListener: () => {},
      } as never,
    },
  )
  return h
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the change-gate refresh', () => {
  it('reads once just after it starts, and saves what it read', async () => {
    const h = harness(async () => ({ probe: false }))
    expect(h.read).not.toHaveBeenCalled()
    h.timers.first!()
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.saved).toEqual([{ probe: false }])
    expect(h.applied).toBe(0)
  })

  it('reads on a live change, on return to the foreground, on reconnecting and every minute', async () => {
    const h = harness(async () => ({}))
    h.subscribers[0]!()
    await settle()
    h.visibility.listeners[0]!()
    await settle()
    h.online[0]!()
    await settle()
    h.timers.interval!()
    await settle()
    expect(h.read).toHaveBeenCalledTimes(4)
    expect(GATE_READ_INTERVAL_MS).toBe(60_000)
  })

  it('skips the minute read while the page is hidden', async () => {
    const h = harness(async () => ({}))
    h.visibility.state = 'hidden'
    h.timers.interval!()
    h.visibility.listeners[0]!()
    await settle()
    expect(h.read).not.toHaveBeenCalled()
  })

  it('reads one at a time, keeping one trailing read however many triggers arrive', async () => {
    let release!: (answers: Record<string, boolean>) => void
    const h = harness(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          release = resolve
        }),
    )
    h.timers.first!()
    h.subscribers[0]!()
    h.subscribers[0]!()
    h.online[0]!()
    expect(h.read).toHaveBeenCalledTimes(1)
    release({})
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    release({})
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('raises the update signal once when an answer differs from what the page booted with', async () => {
    const h = harness(async () => ({ probe: true }))
    h.timers.first!()
    await settle()
    h.subscribers[0]!()
    await settle()
    expect(h.applied).toBe(1)
    expect(h.saved).toHaveLength(2)
  })

  it('ignores answers for gates this build does not declare', async () => {
    const h = harness(async () => ({ 'a-newer-gate': true }))
    h.timers.first!()
    await settle()
    expect(h.applied).toBe(0)
  })

  it('keeps what the device has when a read fails, and tries again on the next trigger', async () => {
    let fail = true
    const h = harness(async () => {
      if (fail) throw new Error('offline')
      return { probe: true }
    })
    h.timers.first!()
    await settle()
    expect(h.saved).toEqual([])
    expect(h.applied).toBe(0)
    fail = false
    h.online[0]!()
    await settle()
    expect(h.applied).toBe(1)
  })

  it('still reads every minute when the live channel cannot open', async () => {
    const h = harness(async () => ({}), { subscribeThrows: true })
    h.timers.interval!()
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('stops reading and leaves the channel once disposed', async () => {
    const h = harness(async () => ({ probe: true }))
    h.stop()
    expect(h.subscribers).toHaveLength(0)
    h.timers.interval!()
    h.timers.first!()
    await settle()
    expect(h.read).not.toHaveBeenCalled()
    expect(h.applied).toBe(0)
  })
})
