import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../database.types'
import { createSupabaseKitchenAdapter, parseKitchenBoard } from './kitchen'

describe('live kitchen dish contract', () => {
  it('retains Done receipt identity, tickets and notes without broadening the kitchen view', () => {
    const board = parseKitchenBoard({
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
          lines: [
            { id: 'line', menuItemId: 'item', itemName: 'Dish', quantity: 1, note: 'No sauce' },
          ],
          otherItemCount: 0,
          acknowledged: true,
          latestAck: null,
        },
      ],
    } as unknown as Json)
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

  it('sends captured quantities and preserves the server refusal for Ready and Undo', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'accepted' }, error: null })
    const kitchen = createSupabaseKitchenAdapter({ rpc } as unknown as SupabaseClient<Database>)
    await kitchen.ready!({ id: 'ready', orderId: 'order', lines: [{ id: 'line', quantity: 2 }] })
    expect(rpc).toHaveBeenCalledWith('kitchen_ready', {
      p_id: 'ready',
      p_order_id: 'order',
      p_lines: [{ id: 'line', quantity: 2 }],
    })
    await kitchen.undoReady!('undo', 'ready')
    expect(rpc).toHaveBeenCalledWith('kitchen_ready_undo', { p_id: 'undo', p_ready_id: 'ready' })
    rpc.mockResolvedValue({ data: { status: 'not_authorised' }, error: null })
    await expect(kitchen.undoReady!('retry', 'ready')).rejects.toMatchObject({
      code: 'not_authorised',
    })
  })

  it('maps narrow counter Ready quantities and each kitchen independent state', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
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
      },
      error: null,
    })
    const kitchen = createSupabaseKitchenAdapter({ rpc } as unknown as SupabaseClient<Database>)
    expect(await kitchen.readCounterMarks()).toMatchObject({
      readyQuantities: { order: { line: 2 } },
      dishStates: { order: ['ready', 'sent'] },
    })
  })
})
