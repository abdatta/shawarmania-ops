import { describe, expect, it, vi } from 'vitest'

import { createSupabaseChangeGatesAdapter } from './change-gates'

/**
 * The live nudge (a-release-can-be-switched-off, D6): a change to any gate, and
 * every join of the channel, asks each listener to re-read — the join because a
 * turn made before the channel was listening would otherwise wait for the
 * minute read.
 */

function fakeClient() {
  let onChange: (() => void) | undefined
  let onStatus: ((status: string) => void) | undefined
  const channel = {
    on: vi.fn((_event: string, _filter: unknown, handler: () => void) => {
      onChange = handler
      return channel
    }),
    subscribe: vi.fn((handler: (status: string) => void) => {
      onStatus = handler
      return channel
    }),
  }
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  }
  return {
    client,
    change: () => onChange?.(),
    status: (status: string) => onStatus?.(status),
  }
}

describe('the change-gates live nudge', () => {
  it('nudges every listener on a change and on every join, and on nothing else', () => {
    const fake = fakeClient()
    const adapter = createSupabaseChangeGatesAdapter(fake.client as never)
    const first = vi.fn()
    const second = vi.fn()
    adapter.subscribe(first)
    adapter.subscribe(second)
    expect(fake.client.channel).toHaveBeenCalledTimes(1)

    fake.status('SUBSCRIBED')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    fake.change()
    expect(first).toHaveBeenCalledTimes(2)

    fake.status('CHANNEL_ERROR')
    fake.status('TIMED_OUT')
    expect(first).toHaveBeenCalledTimes(2)

    // A rejoin after a dropped connection reads again.
    fake.status('SUBSCRIBED')
    expect(first).toHaveBeenCalledTimes(3)
  })

  it('leaves the channel when the last listener goes', () => {
    const fake = fakeClient()
    const adapter = createSupabaseChangeGatesAdapter(fake.client as never)
    const stopFirst = adapter.subscribe(vi.fn())
    const stopSecond = adapter.subscribe(vi.fn())
    stopFirst()
    expect(fake.client.removeChannel).not.toHaveBeenCalled()
    stopSecond()
    expect(fake.client.removeChannel).toHaveBeenCalledTimes(1)
  })
})
