import { describe, expect, it } from 'vitest'
import { createDemoData } from './index'
import { createMockKitchenAdapter } from './kitchen'
import { kitchenCardState } from '@/domain'

describe('demo kitchen dish tickets', () => {
  it('Ready is idempotent; extra food becomes ticket 2; Undo restores the acknowledgement', async () => {
    const data = createDemoData({ dishWalkthrough: true })
    const kitchen = createMockKitchenAdapter(data.store, data.kitchen)
    const card = (await kitchen.readDishBoard()).orders.find((order) => order.orderNumber === 105)!
    expect(card).not.toHaveProperty('label')
    expect(card.lines[0]?.note).toBe('No sauce')
    await kitchen.acknowledgeDish({
      id: crypto.randomUUID(),
      orderId: card.id,
      kind: 'new',
      orderVersion: card.version,
    })
    const ready = {
      id: crypto.randomUUID(),
      orderId: card.id,
      lines: card.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
    }
    await kitchen.ready!(ready)
    await kitchen.ready!(ready)
    expect(data.store.dishWorkflow!.readies.filter((row) => row.id === ready.id)).toHaveLength(1)
    expect((await kitchen.readDishBoard()).orders.some((order) => order.id === card.id)).toBe(false)
    const receipt = (await kitchen.readDishBoard()).orders.find(
      (order) => order.readyId === ready.id,
    )!
    expect(receipt.sourceOrderId).toBe(card.id)
    expect(kitchenCardState(receipt)).toBe('quiet')
    expect((await kitchen.readDishMarks()).readyQuantities?.[card.id]?.[card.lines[0]!.id]).toBe(
      card.lines[0]!.quantity,
    )
    const line = data.store.orderItems.find((item) => item.id === card.lines[0]!.id)!
    line.quantity += 1
    const next = (await kitchen.readDishBoard()).orders.find((order) => order.id === card.id)!
    expect(next.ticketNumber).toBe(2)
    expect(next.lines[0]?.quantity).toBe(1)
    expect(kitchenCardState(next)).toBe('new')
    line.quantity -= 1
    expect((await kitchen.readDishBoard()).orders.some((order) => order.id === card.id)).toBe(false)
    await kitchen.undoReady!(crypto.randomUUID(), ready.id)
    const restored = (await kitchen.readDishBoard()).orders.find((order) => order.id === card.id)!
    expect(restored.ticketNumber).toBe(1)
    expect(kitchenCardState(restored)).toBe('quiet')
  })

  it('hides Done after handover, restores it on untick, and permits later Undo without erasing handover', async () => {
    const data = createDemoData({ dishWalkthrough: true })
    const kitchen = createMockKitchenAdapter(data.store, data.kitchen)
    const card = (await kitchen.readDishBoard()).orders.find((order) => order.orderNumber === 105)!
    const ready = {
      id: crypto.randomUUID(),
      orderId: card.id,
      lines: card.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
    }
    await kitchen.ready!(ready)
    data.store.dishWorkflow!.preparations[card.lines[0]!.id] = card.lines[0]!.quantity
    expect((await kitchen.readDishBoard()).orders.some((order) => order.readyId === ready.id)).toBe(
      false,
    )
    data.store.dishWorkflow!.preparations[card.lines[0]!.id] = 0
    expect(
      (await kitchen.readDishBoard()).orders.find((order) => order.readyId === ready.id)?.lines[0]
        ?.quantity,
    ).toBe(card.lines[0]!.quantity)
    data.store.dishWorkflow!.preparations[card.lines[0]!.id] = 1
    await kitchen.undoReady!(crypto.randomUUID(), ready.id)
    expect(data.store.dishWorkflow!.preparations[card.lines[0]!.id]).toBe(1)
    expect(
      (await kitchen.readDishBoard()).orders.find((order) => order.id === card.id)?.lines[0]
        ?.quantity,
    ).toBe(card.lines[0]!.quantity - 1)
    const order = data.store.orders.find((order) => order.id === card.id)!
    order.status = 'cancelled'
    expect(
      (await kitchen.readDishBoard()).orders.some((order) => order.sourceOrderId === card.id),
    ).toBe(false)
  })

  it('two stations owe only their own dishes', async () => {
    const data = createDemoData({ dishWalkthrough: true })
    const kitchen = createMockKitchenAdapter(data.store, data.kitchen)
    const mixed = data.store.orders.find((order) => order.order_number === 97)!
    expect((await kitchen.readDishBoard()).orders.some((order) => order.id === mixed.id)).toBe(
      false,
    )
    expect(
      (await kitchen.readDishBoard()).orders.some((order) => order.sourceOrderId === mixed.id),
    ).toBe(true)
    kitchen.setDemoStation!(2)
    const card = (await kitchen.readDishBoard()).orders.find((order) => order.id === mixed.id)!
    expect(card.lines.every((line) => /rice/i.test(line.itemName))).toBe(true)
    expect(card).not.toHaveProperty('label')
  })

  it('keeps each kitchen indicator independent through ACK, Ready, handover and Undo', async () => {
    const data = createDemoData({ dishWalkthrough: true })
    const kitchen = createMockKitchenAdapter(data.store, data.kitchen)
    const mixed = data.store.orders.find((order) => order.order_number === 97)!
    const states = async () => (await kitchen.readDishMarks()).dishStates?.[mixed.id]
    expect(await states()).toEqual(['ready', 'sent'])
    kitchen.setDemoStation!(2)
    const card = (await kitchen.readDishBoard()).orders.find((order) => order.id === mixed.id)!
    await kitchen.acknowledgeDish({
      id: crypto.randomUUID(),
      orderId: card.id,
      kind: 'new',
      orderVersion: card.version,
    })
    expect(await states()).toEqual(['ready', 'acknowledged'])
    const ready = crypto.randomUUID()
    await kitchen.ready!({
      id: ready,
      orderId: card.id,
      lines: card.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
    })
    expect(await states()).toEqual(['ready', 'ready'])
    const firstLine = data.store.orderItems.find(
      (line) => line.order_id === mixed.id && !card.lines.some((item) => item.id === line.id),
    )!
    data.store.dishWorkflow!.preparations[firstLine.id] = firstLine.quantity
    expect(await states()).toEqual(['handed_over', 'ready'])
    data.store.dishWorkflow!.preparations[card.lines[0]!.id] = card.lines[0]!.quantity
    expect(await states()).toEqual(['handed_over', 'handed_over'])
    data.store.dishWorkflow!.preparations[card.lines[0]!.id] = 0
    expect(await states()).toEqual(['handed_over', 'ready'])
    await kitchen.undoReady!(crypto.randomUUID(), ready)
    expect(await states()).toEqual(['handed_over', 'acknowledged'])
  })
})

it('allocates handover to earlier Done receipts before newer tickets', async () => {
  const data = createDemoData({ dishWalkthrough: true })
  const kitchen = createMockKitchenAdapter(data.store, data.kitchen)
  const card = (await kitchen.readDishBoard()).orders.find((order) => order.orderNumber === 105)!
  const line = data.store.orderItems.find((item) => item.id === card.lines[0]!.id)!
  const first = crypto.randomUUID()
  await kitchen.ready!({ id: first, orderId: card.id, lines: [{ id: line.id, quantity: 2 }] })
  line.quantity = 3
  const second = crypto.randomUUID()
  await kitchen.ready!({ id: second, orderId: card.id, lines: [{ id: line.id, quantity: 1 }] })
  data.store.dishWorkflow!.preparations[line.id] = 1
  let receipts = (await kitchen.readDishBoard()).orders.filter(
    (order) => order.sourceOrderId === card.id,
  )
  expect(receipts.map((order) => [order.readyId, order.lines[0]!.quantity])).toEqual([
    [first, 1],
    [second, 1],
  ])
  data.store.dishWorkflow!.preparations[line.id] = 2
  receipts = (await kitchen.readDishBoard()).orders.filter(
    (order) => order.sourceOrderId === card.id,
  )
  expect(receipts.map((order) => order.readyId)).toEqual([second])
})
