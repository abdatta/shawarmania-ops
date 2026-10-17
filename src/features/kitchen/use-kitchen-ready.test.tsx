import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import type { KitchenOrder } from '@/data-access/adapters'
import type { KitchenCardView } from './use-dish-kitchen-board'
import {
  KITCHEN_READY_EXIT_MS,
  KITCHEN_READY_GAP_MS,
  retainReadySlots,
  useKitchenReady,
} from './use-kitchen-ready'

afterEach(() => vi.useRealTimers())
const view = (order: KitchenOrder): KitchenCardView => ({
  order,
  state: order.readyId ? 'quiet' : 'new',
  shake: 0,
  rings: { left: 0, sounding: false },
})
async function setup() {
  const { kitchen } = createMockAdapters('biller', createDemoData({ dishWalkthrough: true }))
  const card = view(
    (await kitchen.readDishBoard()).orders.find((order) => order.orderNumber === 105)!,
  )
  const write = vi.spyOn(kitchen, 'ready')
  const undo = vi.spyOn(kitchen, 'undoReady')
  const read = vi.fn(async () => {})
  vi.useFakeTimers()
  const hook = renderHook(({ cards }) => useKitchenReady(kitchen, read, cards), {
    initialProps: { cards: [card] },
  })
  const doneCard = async () =>
    view(
      (await kitchen.readDishBoard()).orders.find(
        (order) => order.sourceOrderId === card.order.id,
      )!,
    )
  return { ...hook, card, write, undo, read, kitchen, doneCard }
}
it('sends Ready immediately and keeps Done indefinitely, with an unlimited Undo', async () => {
  const { result, card, write, undo, read, rerender, doneCard } = await setup()
  await act(async () => result.current.toggle(card))
  expect(write).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledOnce()
  expect(result.current.pending.size).toBe(0)
  const done = await doneCard()
  rerender({ cards: [done] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000)
  })
  expect(result.current.pending.size).toBe(0)
  await act(async () => result.current.toggle(done))
  expect(undo).toHaveBeenCalledWith(expect.any(String), done.order.readyId)
  expect(result.current.pending.size).toBe(0)
})
it('holds a handed-over middle receipt in its original slot through exit and blank gap', async () => {
  const { result, card, rerender, doneCard } = await setup()
  await act(async () => result.current.toggle(card))
  const done = await doneCard()
  const before = { ...card, order: { ...card.order, id: 'before' } }
  const after = { ...card, order: { ...card.order, id: 'after' } }
  rerender({ cards: [before, done, after] })
  rerender({ cards: [before, after] })
  expect(result.current.pending.get(done.order.id)?.phase).toBe('leaving')
  expect(retainReadySlots([before, after], result.current.pending)).toEqual([before, done, after])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(KITCHEN_READY_EXIT_MS)
  })
  expect(result.current.pending.get(done.order.id)?.phase).toBe('gap')
  expect(retainReadySlots([before, after], result.current.pending)).toEqual([before, done, after])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(KITCHEN_READY_GAP_MS)
  })
  expect(retainReadySlots([before, after], result.current.pending)).toEqual([before, after])
})
it('restores prior state on rejected writes and prevents repeated clicks while saving', async () => {
  const { result, card, write, undo, doneCard } = await setup()
  write.mockRejectedValueOnce(new Error('Kitchen is offline'))
  await act(async () => result.current.toggle(card))
  expect(result.current.pending.size).toBe(0)
  expect(result.current.error).toBe('Kitchen is offline')
  await act(async () => {
    result.current.toggle(card)
    result.current.toggle(card)
  })
  expect(write).toHaveBeenCalledTimes(2)
  const done = await doneCard()
  undo.mockRejectedValueOnce(new Error('Cannot reach kitchen'))
  await act(async () => result.current.toggle(done))
  expect(result.current.pending.size).toBe(0)
  expect(result.current.error).toBe('Cannot reach kitchen')
})
it('does not animate removal caused by a local Undo and clears holds on station change', async () => {
  const { result, card, rerender, doneCard, undo } = await setup()
  await act(async () => result.current.toggle(card))
  const done = await doneCard()
  rerender({ cards: [done] })
  let complete!: () => void
  undo.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      complete = resolve
    }),
  )
  act(() => result.current.toggle(done))
  rerender({ cards: [card] })
  expect(result.current.pending.get(done.order.id)?.phase).toBe('saving')
  await act(async () => complete())
  expect(result.current.pending.size).toBe(0)
  rerender({ cards: [done] })
  act(() => result.current.reset())
  rerender({ cards: [] })
  expect(result.current.pending.size).toBe(0)
})

it('lets an undone receipt go without a handover exit when the board redraws after the Undo settles', async () => {
  const { result, card, rerender, doneCard } = await setup()
  await act(async () => result.current.toggle(card))
  const done = await doneCard()
  rerender({ cards: [done] })
  // Settled first, redrawn after: nothing is pending by the time the receipt goes.
  await act(async () => result.current.toggle(done))
  expect(result.current.pending.size).toBe(0)
  rerender({ cards: [card] })
  expect(result.current.pending.size).toBe(0)
  expect(retainReadySlots([card], result.current.pending)).toEqual([card])
})

it('cancels departure on an untick and cannot let an old timer retire a new hold', async () => {
  const { result, card, rerender, doneCard } = await setup()
  await act(async () => result.current.toggle(card))
  const done = await doneCard()
  rerender({ cards: [done] })
  rerender({ cards: [] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  rerender({ cards: [done] })
  expect(result.current.pending.size).toBe(0)
  rerender({ cards: [] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(result.current.pending.get(done.order.id)?.phase).toBe('leaving')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120)
  })
  expect(result.current.pending.get(done.order.id)?.phase).toBe('gap')
})
