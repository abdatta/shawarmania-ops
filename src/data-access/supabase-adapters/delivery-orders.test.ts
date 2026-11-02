import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetBootSnapshotForTests, writeSavedAnswers } from '@/change-gates/snapshot'
import type { Database } from '@/data-access/database.types'
import { createSupabaseAnalyticsAdapter } from '@/data-access/supabase-adapters/analytics'
import { createSupabaseKitchenAdapter } from '@/data-access/supabase-adapters/kitchen'
import { createSupabaseOverviewAdapter } from '@/data-access/supabase-adapters/overview'
import { describeChangeGate } from '@/test/change-gates'

import { billingCommandRpc } from '../../../shared/billing-command'

/**
 * The adapters' toggle points for `delivery-orders`
 * (delivery-orders-are-made-not-billed, D6): off, every read is today's; on,
 * the `_v3`/`_v2` that knows a delivery order. The outbox's routing reads no
 * gate either way, so a command queued while on reaches its function after.
 */

const SNAPSHOT = { categories: [], days: [], items: [], delivery: [], hours: [] }

function client(data: unknown) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => ({ data, error: null }))
  return { rpc, client: { rpc } as unknown as SupabaseClient<Database> }
}

describeChangeGate('delivery-orders', (on) => {
  beforeEach(() => {
    writeSavedAnswers(localStorage, { 'delivery-orders': on })
    resetBootSnapshotForTests()
  })

  it(on ? 'reads the kitchen board through _v3' : 'reads the kitchen board as today', async () => {
    const { rpc, client: supabase } = client(null)
    await createSupabaseKitchenAdapter(supabase)
      .readDishBoard()
      .catch(() => undefined)
    expect(rpc).toHaveBeenCalledWith(on ? 'kitchen_board_v3' : 'kitchen_board_v2')
  })

  it(on ? 'reads Sales with a scope' : 'reads Sales as today', async () => {
    const { rpc, client: supabase } = client(SNAPSHOT)
    await createSupabaseAnalyticsAdapter(supabase).read('o', '2026-11-01', '2026-11-01', {
      view: 'sales',
      scope: 'delivery',
    })
    if (on) {
      expect(rpc).toHaveBeenCalledWith(
        'sales_analytics_v3',
        expect.objectContaining({ p_scope: 'delivery' }),
      )
    } else {
      expect(rpc).toHaveBeenCalledWith('sales_analytics_v2', expect.anything())
      expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_scope')
    }
  })

  it(
    on ? 'reads Overview’s open total without delivery orders' : 'reads Overview as today',
    async () => {
      const { rpc, client: supabase } = client({
        cashPaise: 0,
        upiPaise: 0,
        deliveryPaise: 0,
        openPaise: 0,
      })
      await createSupabaseOverviewAdapter(supabase).today('o')
      expect(rpc).toHaveBeenCalledWith(on ? 'overview_today_v3' : 'overview_today_v2', {
        p_outlet_id: 'o',
      })
    },
  )

  it('routes delivery commands whatever the gate says', () => {
    expect(billingCommandRpc({ type: 'create_order', variant: 'delivery' })).toBe(
      'create_billing_order_v3',
    )
    expect(billingCommandRpc({ type: 'revise_order', variant: 'delivery' })).toBe(
      'revise_billing_order_v3',
    )
    expect(billingCommandRpc({ type: 'prepare_order_lines', variant: 'delivery' })).toBe(
      'prepare_order_lines_v2',
    )
    expect(billingCommandRpc({ type: 'hand_over_delivery' })).toBe('hand_over_delivery_order')
    expect(billingCommandRpc({ type: 'take_back_delivery_handover' })).toBe(
      'take_back_delivery_handover',
    )
  })
})
