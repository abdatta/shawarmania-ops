import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/data-access/database.types'
import { createSupabaseAnalyticsAdapter } from '@/data-access/supabase-adapters/analytics'
import { createSupabaseKitchenAdapter } from '@/data-access/supabase-adapters/kitchen'
import { createSupabaseOverviewAdapter } from '@/data-access/supabase-adapters/overview'

import { billingCommandRpc } from '../../../shared/billing-command'

/**
 * The adapters read through the `_v3`/`_v2` that knows a delivery order
 * (delivery-orders-are-made-not-billed, D6), and the outbox routes a delivery
 * command to its function however long it waited.
 */

const SNAPSHOT = { categories: [], days: [], items: [], delivery: [], hours: [] }

function client(data: unknown) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => ({ data, error: null }))
  return { rpc, client: { rpc } as unknown as SupabaseClient<Database> }
}

describe('delivery orders in the reads', () => {
  it('reads the kitchen board through _v3', async () => {
    const { rpc, client: supabase } = client(null)
    await createSupabaseKitchenAdapter(supabase)
      .readDishBoard()
      .catch(() => undefined)
    expect(rpc).toHaveBeenCalledWith('kitchen_board_v3')
  })

  it('reads Sales with a scope', async () => {
    const { rpc, client: supabase } = client(SNAPSHOT)
    await createSupabaseAnalyticsAdapter(supabase).read('o', '2026-11-01', '2026-11-01', {
      view: 'sales',
      scope: 'delivery',
    })
    expect(rpc).toHaveBeenCalledWith(
      'sales_analytics_v3',
      expect.objectContaining({ p_scope: 'delivery' }),
    )
  })

  it('reads Overview’s open total without delivery orders', async () => {
    const { rpc, client: supabase } = client({
      cashPaise: 0,
      upiPaise: 0,
      deliveryPaise: 0,
      openPaise: 0,
    })
    await createSupabaseOverviewAdapter(supabase).today('o')
    expect(rpc).toHaveBeenCalledWith('overview_today_v3', { p_outlet_id: 'o' })
  })

  it('routes delivery commands, and still routes a command queued before', () => {
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
    expect(billingCommandRpc({ type: 'create_order', variant: 'dishes' })).toBe(
      'create_billing_order_v2',
    )
  })
})
