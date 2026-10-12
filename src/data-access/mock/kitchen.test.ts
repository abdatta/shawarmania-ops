import { describe, expect, it } from 'vitest'

import { createDemoData, createMockAdapters } from '.'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_LABEL } from './kitchen'
import { kitchenCardState } from '@/domain'

/**
 * The demo's answer to the counter's kitchen read (#72), by the rules
 * `counter_kitchen_marks()` follows: the demo kitchen is on shift, carries what
 * its board carries, and has answered an order when its card is quiet — or when
 * the counter ticked it Prepared.
 */
function setup() {
  const data = createDemoData()
  const adapters = createMockAdapters('biller', data)
  const byNumber = (n: number) => data.store.orders.find((order) => order.order_number === n)!
  return { data, kitchen: adapters.kitchen, byNumber }
}

describe('the demo counter reads its kitchen', () => {
  it('names the demo kitchen as the one kitchen on shift', async () => {
    const { kitchen } = setup()
    expect((await kitchen.readCounterMarks()).kitchens).toEqual([
      { id: DEMO_KITCHEN_DEVICE_ID, label: DEMO_KITCHEN_LABEL },
    ])
  })

  it('waits on an order the kitchen has not acknowledged, and is answered once it has', async () => {
    const { kitchen, byNumber } = setup()
    const open = byNumber(105)
    expect((await kitchen.readCounterMarks()).orders[open.id]).toEqual(['waiting'])

    const card = (await kitchen.readBoard()).orders.find((order) => order.id === open.id)!
    await kitchen.acknowledge({
      id: crypto.randomUUID(),
      orderId: open.id,
      kind: 'new',
      orderVersion: card.version,
    })
    expect((await kitchen.readCounterMarks()).orders[open.id]).toEqual(['seen'])
  })

  it('waits again after an edit changes what the kitchen shows', async () => {
    const { data, kitchen, byNumber } = setup()
    const open = byNumber(105)
    const card = (await kitchen.readBoard()).orders.find((order) => order.id === open.id)!
    await kitchen.acknowledge({
      id: crypto.randomUUID(),
      orderId: open.id,
      kind: 'new',
      orderVersion: card.version,
    })
    const line = data.store.orderItems.find((item) => item.order_id === open.id)!
    line.quantity += 1
    open.changed_at = new Date(Date.now() + 1000).toISOString()
    expect((await kitchen.readCounterMarks()).orders[open.id]).toEqual(['waiting'])
  })

  it('counts a prepared order as answered: the food is made', async () => {
    const { kitchen, byNumber } = setup()
    const prepared = byNumber(104)
    expect(prepared.prepared_at).not.toBeNull()
    expect((await kitchen.readCounterMarks()).orders[prepared.id]).toEqual(['seen'])
  })

  it('has no answer for an order the kitchen does not carry', async () => {
    const { kitchen, byNumber } = setup()
    const open = byNumber(105)
    await kitchen.setFilter('include', [], 'oldest_first')
    expect((await kitchen.readCounterMarks()).orders[open.id]).toBeUndefined()
  })
})

describe('a demo kitchen filter is a view', () => {
  function view() {
    const state = setup()
    const { data, kitchen, byNumber } = state
    const open = byNumber(105)
    const shawarma = data.store.menuItems.find((item) => item.name === 'Classic Chicken Shawarma')!
    const burger = data.store.menuItems.find(
      (item) => /burger/i.test(item.name) && item.outlet_id === open.outlet_id,
    )!
    const line = data.store.orderItems.find(
      (item) => item.order_id === open.id && item.kind === 'item',
    )!
    line.menu_item_id = shawarma.id
    line.item_name = shawarma.name
    const burgerLine = {
      ...line,
      id: crypto.randomUUID(),
      menu_item_id: burger.id,
      item_name: burger.name,
    }
    data.store.orderItems.push(burgerLine)
    const card = async () =>
      (await kitchen.readBoard()).orders.find((order) => order.id === open.id)
    const ack = async (kind: 'new' | 'edit' | 'cancel' = 'new') =>
      kitchen.acknowledge({
        id: crypto.randomUUID(),
        orderId: open.id,
        kind,
        orderVersion: open.changed_at ?? open.created_at,
      })
    return { ...state, open, shawarma, burger, line, burgerLine, card, ack }
  }

  it('hides all answered food without cancellation and returns it quiet', async () => {
    const { kitchen, shawarma, burger, card, ack, open } = view()
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    await ack()
    await kitchen.setFilter('include', [burger.category_id], 'oldest_first')
    // The burger is unacknowledged, so choose an empty view to hide the whole order.
    await kitchen.setFilter('include', [], 'oldest_first')
    expect(await card()).toBeUndefined()
    expect((await kitchen.readCounterMarks()).orders[open.id]).toBeUndefined()
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    expect(kitchenCardState((await card())!)).toBe('quiet')
    expect((await kitchen.readCounterMarks()).orders[open.id]).toEqual(['seen'])
    expect((await kitchen.readBoard()).filterChangedAt).not.toBeNull()
  })

  it('narrows both sides after acknowledging everything, without changing the snapshot', async () => {
    const { data, kitchen, shawarma, card, ack } = view()
    await ack()
    const stored = structuredClone(data.kitchen.acks[0]!.lines)
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    expect(kitchenCardState((await card())!)).toBe('quiet')
    expect((await card())!.latestAck!.lines).toEqual((await card())!.lines)
    expect(data.kitchen.acks[0]!.lines).toEqual(stored)
  })

  it('widens onto unseen dishes as Edited, and an unseen order as New', async () => {
    const { data, kitchen, shawarma, burger, card, ack, open } = view()
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    await ack()
    const burgerOrder = { ...open, id: crypto.randomUUID(), order_number: 900 }
    data.store.orders.push(burgerOrder)
    const burgerLine = data.store.orderItems.find((item) => item.menu_item_id === burger.id)!
    data.store.orderItems.push({ ...burgerLine, id: crypto.randomUUID(), order_id: burgerOrder.id })
    await kitchen.setFilter('exclude', [], 'oldest_first')
    expect(kitchenCardState((await card())!)).toBe('edited')
    expect((await card())!.latestAck!.lines).toHaveLength(1)
    expect((await card())!.lines).toHaveLength(2)
    const unseen = (await kitchen.readBoard()).orders.find((order) => order.id === burgerOrder.id)!
    expect(unseen.acknowledged).toBe(false)
    expect(kitchenCardState(unseen)).toBe('new')
    expect((await kitchen.readCounterMarks()).orders[open.id]).toEqual(['waiting'])
  })

  it('hides a cancelled order when neither side shows any food', async () => {
    const { kitchen, card, ack, open } = view()
    await ack()
    await kitchen.setFilter('include', [], 'oldest_first')
    open.status = 'cancelled'
    open.cancelled_at = new Date().toISOString()
    expect(await card()).toBeUndefined()
  })

  it('keeps food removed by the counter as Cancelled until its cancel ACK', async () => {
    const { data, kitchen, shawarma, line, card, ack } = view()
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    await ack()
    data.store.orderItems.splice(data.store.orderItems.indexOf(line), 1)
    expect(kitchenCardState((await card())!)).toBe('cancelled')
    await ack('cancel')
    expect(await card()).toBeUndefined()
  })

  it('brings back an open order after a legacy filter-change cancel ACK', async () => {
    const { kitchen, shawarma, card, ack } = view()
    await ack()
    await kitchen.setFilter('include', [], 'oldest_first')
    await ack('cancel')
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    expect(kitchenCardState((await card())!)).toBe('edited')
    expect((await card())!.latestAck!.lines).toEqual([])
  })

  it('judges acknowledged food by its current category, including lines without a menu item', async () => {
    const { kitchen, shawarma, line, card, ack } = view()
    line.menu_item_id = null
    await ack()
    await kitchen.setFilter('include', [shawarma.category_id], 'oldest_first')
    expect(await card()).toBeUndefined()
    await kitchen.setFilter('exclude', [], 'oldest_first')
    expect(kitchenCardState((await card())!)).toBe('quiet')
  })
})
