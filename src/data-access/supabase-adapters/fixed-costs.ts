import type { SupabaseClient } from '@supabase/supabase-js'

import { DataActionError } from '../adapters'
import type { Database } from '../database.types'
import type { FixedCostsAdapter } from '../fixed-costs'

/**
 * Not wired yet: the Fixed costs surface is `demo` until the owner approves its
 * screens (fixed-costs-are-spread-over-the-month, tasks §6–8). Reads answer with
 * nothing, so a gated screen that asks finds no fixed cost and reads as it does
 * without one; writes refuse.
 */
export function createSupabaseFixedCostsAdapter(
  _client: SupabaseClient<Database>,
): FixedCostsAdapter {
  const notYet = () =>
    Promise.reject(new DataActionError('not_available', 'Fixed costs are not available yet.'))
  return {
    list: async () => ({ today: new Date().toISOString().slice(0, 10), costs: [] }),
    add: notYet,
    update: notYet,
    changeAmount: notYet,
    stop: notYet,
    pay: notYet,
    undoPayment: notYet,
    settle: notYet,
    voidSettlement: notYet,
    unpaid: async () => ({ count: 0, months: [] }),
  }
}
