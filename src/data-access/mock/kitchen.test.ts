import { describe, expect, it } from 'vitest'

import { createDemoData, createMockAdapters } from '.'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_LABEL } from './kitchen'

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
