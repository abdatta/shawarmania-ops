import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { BillingOrder, KitchenMarks } from '@/data-access/adapters'
import { describeChangeGate } from '@/test/change-gates'

import { BURST_S, SWING_S, type HandbellPlayer } from './handbell'
import { useReadyRinger } from './use-ready-ringer'

function order(prepared: number): BillingOrder {
  return {
    id: 'o1',
    lines: [
      {
        menuItemId: 'm1',
        orderLineId: 'l1',
        itemName: 'Shawarma',
        unitPricePaise: 10000,
        quantity: 1,
        preparedQuantity: prepared,
      },
    ],
  } as unknown as BillingOrder
}

const marks = (ready: number) =>
  ({ readyQuantities: { o1: { l1: ready } } }) as unknown as KitchenMarks

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describeChangeGate('kitchen-ready', (on) => {
  function setup() {
    const player: HandbellPlayer = { play: vi.fn(() => BURST_S * 1000), stop: vi.fn() }
    const hook = renderHook(
      ({ orders, read }: { orders: BillingOrder[]; read: KitchenMarks }) =>
        useReadyRinger(orders, read, on, player),
      { initialProps: { orders: [order(0)], read: marks(0) } },
    )
    return { player, hook }
  }

  it(on ? 'rings when the kitchen marks food Ready' : 'never rings', () => {
    const { player, hook } = setup()
    hook.rerender({ orders: [order(0)], read: marks(1) })
    expect(player.play).toHaveBeenCalledTimes(on ? 1 : 0)
    expect([...hook.result.current]).toEqual(on ? ['o1'] : [])
    act(() => void vi.advanceTimersByTime(SWING_S * 1000))
    expect(hook.result.current.size).toBe(0)
  })

  it('stops the ring when the biller ticks the Ready food', () => {
    const { player, hook } = setup()
    hook.rerender({ orders: [order(0)], read: marks(1) })
    hook.rerender({ orders: [order(1)], read: marks(1) })
    expect(hook.result.current.size).toBe(0)
    if (on) expect(player.stop).toHaveBeenCalled()
  })

  it('rings nothing when the biller unticks food the kitchen had marked Ready', () => {
    const { player, hook } = setup()
    hook.rerender({ orders: [order(1)], read: marks(1) })
    hook.rerender({ orders: [order(0)], read: marks(1) })
    expect(player.play).not.toHaveBeenCalled()
    expect(hook.result.current.size).toBe(0)
  })
})
