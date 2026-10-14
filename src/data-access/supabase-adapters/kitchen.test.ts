import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../database.types'
import {
  createSupabaseKitchenAdapter,
  parseDishKitchenBoard,
  parseDishKitchenMarks,
  parseKitchenBoard,
} from './kitchen'

/** One board order as `kitchen_board_v2()` returns it: a Done receipt on a later ticket. */
const receiptBoard = {
  outletId: 'outlet',
  shiftId: 'shift',
  readAt: 'now',
  businessDate: 'today',
  filterMode: 'exclude',
  orders: [
    {
      id: 'ready',
      sourceOrderId: 'order',
      readyId: 'ready',
      ticketNumber: 2,
      orderNumber: 42,
      status: 'open',
      label: 'Must not escape',
      customerPhone: 'Must not escape',
      lines: [{ id: 'line', menuItemId: 'item', itemName: 'Dish', quantity: 1, note: 'No sauce' }],
      otherItemCount: 0,
      acknowledged: true,
      latestAck: null,
    },
  ],
} as unknown as Json

const marksJson = {
  kitchens: [
    { id: 'k1', label: 'Kitchen 1' },
    { id: 'k2', label: 'Kitchen 2' },
  ],
  kitchenTablets: 2,
  orders: [
    {
      orderId: 'order',
      marks: ['seen', 'waiting'],
      dishStates: ['ready', 'sent'],
      readyQuantities: { line: 2 },
    },
  ],
}

function adapterWith(rpc: ReturnType<typeof vi.fn>) {
  return createSupabaseKitchenAdapter({ rpc } as unknown as SupabaseClient<Database>)
}

describe('live kitchen dish contract', () => {
  it('retains Done receipt identity, tickets and notes without broadening the kitchen view', () => {
    const board = parseDishKitchenBoard(receiptBoard)
    expect(board.orders[0]).toMatchObject({
      id: 'ready',
      sourceOrderId: 'order',
      readyId: 'ready',
      ticketNumber: 2,
      lines: [{ note: 'No sauce' }],
    })
    expect(board.orders[0]).not.toHaveProperty('label')
    expect(board.orders[0]).not.toHaveProperty('customerPhone')
  })

  it('defaults an order with no ticket number to ticket 1 and a line with no note to null', () => {
    const board = parseDishKitchenBoard({
      ...(receiptBoard as object),
      orders: [
        {
          id: 'plain',
          orderNumber: 7,
          status: 'open',
          lines: [{ id: 'line', menuItemId: null, itemName: 'Dish', quantity: 1 }],
          otherItemCount: 0,
          acknowledged: false,
          latestAck: null,
        },
      ],
    } as unknown as Json)
    expect(board.orders[0]).toMatchObject({ ticketNumber: 1, lines: [{ note: null }] })
    expect(board.orders[0]).not.toHaveProperty('sourceOrderId')
    expect(board.orders[0]).not.toHaveProperty('readyId')
  })

  it('reads the dish board and marks through the _v2 functions, and the old ones through the old', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name.startsWith('counter_kitchen_marks') ? marksJson : receiptBoard,
      error: null,
    }))
    const kitchen = adapterWith(rpc)

    await kitchen.readDishBoard()
    await kitchen.readDishMarks()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'kitchen_board_v2',
      'counter_kitchen_marks_v2',
    ])

    rpc.mockClear()
    await kitchen.readBoard()
    await kitchen.readCounterMarks()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['kitchen_board', 'counter_kitchen_marks'])
  })

  it('acknowledges through kitchen_acknowledge_v2 for the dish path and kitchen_acknowledge for the old', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'accepted' }, error: null })
    const kitchen = adapterWith(rpc)
    const input = { id: 'ack', orderId: 'order', kind: 'new' as const, orderVersion: 'v1' }
    await expect(kitchen.acknowledgeDish(input)).resolves.toBe('accepted')
    expect(rpc).toHaveBeenLastCalledWith('kitchen_acknowledge_v2', {
      p_id: 'ack',
      p_order_id: 'order',
      p_kind: 'new',
      p_order_version: 'v1',
    })
    await expect(kitchen.acknowledge(input)).resolves.toBe('accepted')
    expect(rpc).toHaveBeenLastCalledWith('kitchen_acknowledge', {
      p_id: 'ack',
      p_order_id: 'order',
      p_kind: 'new',
      p_order_version: 'v1',
    })
    rpc.mockResolvedValue({ data: { status: 'stale' }, error: null })
    await expect(kitchen.acknowledgeDish(input)).resolves.toBe('stale')
  })

  it('sends captured quantities and preserves the server refusal for Ready and Undo', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'accepted' }, error: null })
    const kitchen = adapterWith(rpc)
    await kitchen.ready({ id: 'ready', orderId: 'order', lines: [{ id: 'line', quantity: 2 }] })
    expect(rpc).toHaveBeenCalledWith('kitchen_ready_v2', {
      p_id: 'ready',
      p_order_id: 'order',
      p_lines: [{ id: 'line', quantity: 2 }],
    })
    await kitchen.undoReady('undo', 'ready')
    expect(rpc).toHaveBeenCalledWith('kitchen_ready_undo_v2', { p_id: 'undo', p_ready_id: 'ready' })
    rpc.mockResolvedValue({ data: { status: 'not_authorised' }, error: null })
    await expect(kitchen.undoReady('retry', 'ready')).rejects.toMatchObject({
      code: 'not_authorised',
    })
    await expect(kitchen.ready({ id: 'again', orderId: 'order', lines: [] })).rejects.toMatchObject(
      { code: 'not_authorised' },
    )
  })

  it('maps narrow counter Ready quantities and each kitchen independent state', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: marksJson, error: null })
    expect(await adapterWith(rpc).readDishMarks()).toMatchObject({
      readyQuantities: { order: { line: 2 } },
      dishStates: { order: ['ready', 'sent'] },
    })
    expect(parseDishKitchenMarks({ kitchens: null, orders: null, kitchenTablets: null })).toEqual({
      kitchens: [],
      orders: {},
      kitchenTablets: 0,
      readyQuantities: {},
      dishStates: {},
    })
  })
})

describe('live kitchen off path', () => {
  it('reads the board as it was: no notes, no tickets, no receipts', () => {
    const board = parseKitchenBoard(receiptBoard)
    expect(board.orders[0]).not.toHaveProperty('readyId')
    expect(board.orders[0]).not.toHaveProperty('sourceOrderId')
    expect(board.orders[0]).not.toHaveProperty('ticketNumber')
    expect(board.orders[0]!.lines[0]).not.toHaveProperty('note')
  })

  it('reads the counter marks as they were: no Ready quantities, no kitchen slots', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: marksJson, error: null })
    const marks = await adapterWith(rpc).readCounterMarks()
    expect(marks.orders).toEqual({ order: ['seen', 'waiting'] })
    expect(marks).not.toHaveProperty('readyQuantities')
    expect(marks).not.toHaveProperty('dishStates')
  })
})
