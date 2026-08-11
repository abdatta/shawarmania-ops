import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isOccupied, resetOccupancy } from '@/pwa/occupancy'

import type { DataAdapters } from './adapters'
import { trackAdapterWrites } from './track-adapter-writes'

/**
 * Writes counted at the seam.
 *
 * The point of counting here rather than per surface is that a surface added
 * later is covered without knowing this exists, so these tests use invented
 * adapters rather than real ones: what is asserted is the rule, not the
 * inventory of today's methods.
 */

function adaptersWith(domain: Record<string, unknown>): DataAdapters {
  return { invented: domain } as unknown as DataAdapters
}

function trackedDomain(domain: Record<string, unknown>): Record<string, never> {
  return (trackAdapterWrites(adaptersWith(domain)) as unknown as Record<string, never>)[
    'invented'
  ] as unknown as Record<string, never>
}

describe('tracking adapter writes', () => {
  beforeEach(() => {
    resetOccupancy()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    resetOccupancy()
  })

  it('counts a write while it is in flight and releases it after', async () => {
    let settle: (value: unknown) => void = () => {}
    const domain = trackedDomain({
      settleBill: () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    }) as unknown as { settleBill: () => Promise<unknown> }

    const inFlight = domain.settleBill()
    expect(isOccupied()).toBe(true)

    settle(undefined)
    await inFlight
    expect(isOccupied()).toBe(false)
  })

  it('releases a write that fails', async () => {
    const domain = trackedDomain({
      settleBill: () => Promise.reject(new Error('refused')),
    }) as unknown as { settleBill: () => Promise<unknown> }

    await expect(domain.settleBill()).rejects.toThrow('refused')
    expect(isOccupied()).toBe(false)
  })

  it('does not count reads, which never stop', () => {
    // Reads happen constantly and would leave the page permanently occupied.
    const domain = trackedDomain({
      listBills: () => new Promise(() => {}),
      getOutlet: () => new Promise(() => {}),
      searchCustomers: () => new Promise(() => {}),
    }) as unknown as Record<string, () => Promise<unknown>>

    void domain['listBills']?.()
    void domain['getOutlet']?.()
    void domain['searchCustomers']?.()

    expect(isOccupied()).toBe(false)
  })

  it('treats an unrecognised method name as a write', () => {
    // The safe direction: an unknown verb delays a reload rather than risking
    // one during a save.
    const domain = trackedDomain({
      promoteEverything: () => new Promise(() => {}),
    }) as unknown as Record<string, () => Promise<unknown>>

    void domain['promoteEverything']?.()

    expect(isOccupied()).toBe(true)
  })

  it('leaves non-promise members alone', () => {
    const unsubscribe = vi.fn()
    const domain = trackedDomain({
      subscribeCounter: () => unsubscribe,
      notAFunction: 42,
    }) as unknown as { subscribeCounter: () => () => void; notAFunction: number }

    expect(domain.subscribeCounter()).toBe(unsubscribe)
    expect(domain.notAFunction).toBe(42)
    expect(isOccupied()).toBe(false)
  })

  it('hands the caller the original promise, untouched', async () => {
    const original = Promise.resolve('settled')
    const domain = trackedDomain({
      settleBill: () => original,
    }) as unknown as { settleBill: () => Promise<string> }

    expect(domain.settleBill()).toBe(original)
    await expect(original).resolves.toBe('settled')
  })
})
