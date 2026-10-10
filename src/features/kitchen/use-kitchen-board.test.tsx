import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { KitchenBoard } from '@/data-access/adapters'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { kitchenCardState } from '@/domain'
import { useKitchenBoard } from './use-kitchen-board'

const previous = '2026-10-10T10:00:00.000Z'
const filter = '2026-10-10T10:00:01.000Z'
const nextRead = '2026-10-10T10:00:02.000Z'

async function setup() {
  const adapters = createMockAdapters('biller', createDemoData())
  const source = await adapters.kitchen.readBoard()
  const old = {
    ...source.orders.find((order) => order.status === 'open')!,
    version: previous,
    acknowledged: false,
    latestAck: null,
  }
  let next: KitchenBoard = { ...source, readAt: previous, filterChangedAt: null, orders: [] }
  adapters.kitchen.readBoard = vi.fn(async () => next)
  adapters.kitchen.subscribe = (_outlet, _nudge, status) => {
    status?.(true)
    return () => {}
  }
  const player = { play: vi.fn(() => 1000), stop: vi.fn() }
  const hook = renderHook(() => useKitchenBoard({ outletId: source.outletId, player }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AdaptersContext.Provider value={adapters}>{children}</AdaptersContext.Provider>
    ),
  })
  await waitFor(() => expect(hook.result.current.board).not.toBeNull())
  const read = async (board: KitchenBoard) => {
    next = board
    await act(async () => {
      await hook.result.current.read()
    })
  }
  return { ...hook, source, old, player, read }
}

describe('filter saves in the live board', () => {
  it('brings unseen orders in silently with an alert and ACK, without shakes or rings', async () => {
    const { source, old, player, read, result } = await setup()
    await read({ ...source, readAt: nextRead, filterChangedAt: filter, orders: [old] })
    expect(result.current.cards[0]!.state).toBe('new')
    expect(kitchenCardState(result.current.cards[0]!.order)).toBe('new')
    expect(result.current.cards[0]!.shake).toBe(0)
    expect(result.current.cards[0]!.rings).toEqual({ left: 0, sounding: false })
    expect(player.play).not.toHaveBeenCalled()
  })

  it('rings for a counter write newer than the filter in the same read', async () => {
    const { source, old, player, read, result } = await setup()
    const arrived = { ...old, id: 'arrived', version: nextRead }
    await read({ ...source, readAt: nextRead, filterChangedAt: filter, orders: [old, arrived] })
    expect(player.play).toHaveBeenCalledWith('new')
    expect(result.current.cards[0]!.shake).toBe(0)
    expect(result.current.cards[1]!.shake).toBe(1)
    expect(result.current.cards[1]!.rings.sounding).toBe(true)
  })

  it('rings for food brought into view by a category move without a filter save', async () => {
    const { source, old, player, read, result } = await setup()
    await read({ ...source, readAt: nextRead, filterChangedAt: null, orders: [old] })
    expect(player.play).toHaveBeenCalledWith('new')
    expect(result.current.cards[0]!.shake).toBe(1)
  })

  it('does not replay an old shake when a previously ringing card is hidden and shown', async () => {
    const { source, old, player, read, result } = await setup()
    await read({ ...source, readAt: filter, filterChangedAt: null, orders: [old] })
    expect(result.current.cards[0]!.shake).toBe(1)
    await read({ ...source, readAt: nextRead, filterChangedAt: filter, orders: [] })
    player.play.mockClear()
    await read({
      ...source,
      readAt: '2026-10-10T10:00:04Z',
      filterChangedAt: '2026-10-10T10:00:03Z',
      orders: [old],
    })
    expect(result.current.cards[0]!.state).toBe('new')
    expect(result.current.cards[0]!.shake).toBe(0)
    expect(result.current.cards[0]!.rings).toEqual({ left: 0, sounding: false })
    expect(player.play).not.toHaveBeenCalled()
  })
})
