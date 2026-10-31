import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { monthOf } from '@/domain/fixed-costs'

import { DataActionError } from '../adapters'
import type { Database } from '../database.types'
import type { FixedCostsAdapter, FixedCostsReading, FixedCostsUnpaid } from '../fixed-costs'

/**
 * Fixed costs, live (fixed-costs-are-spread-over-the-month, §8). One read,
 * `fixed_costs_list`, carries every fixed cost of an outlet with its amounts,
 * settlements and effective payments; the screens fold it with
 * `src/domain/fixed-costs.ts`, as the demo does. Each write is one function, so
 * the outlet always comes from the fixed cost and a payment is one transaction.
 */
export function createSupabaseFixedCostsAdapter(
  client: SupabaseClient<Database>,
): FixedCostsAdapter {
  return {
    async list(outletId) {
      const { data, error } = await client.rpc('fixed_costs_list', { p_outlet_id: outletId })
      if (error) throw toFixedCostError(error)
      return data as unknown as FixedCostsReading
    },

    async add(cost) {
      const args = {
        p_outlet_id: cost.outletId,
        p_name: cost.name,
        p_category: cost.category,
        p_monthly_paise: cost.monthlyPaise,
        p_starts_on: cost.startsOn,
        p_note: cost.note ?? '',
      }
      // The on path's mid-month start says what that month comes to.
      const { data, error } =
        cost.firstMonthPaise === undefined
          ? await client.rpc('create_fixed_cost', args)
          : await client.rpc('create_fixed_cost_v2', {
              ...args,
              p_first_month_paise: cost.firstMonthPaise,
            })
      if (error) throw toFixedCostError(error)
      const createdAt = new Date().toISOString()
      return {
        id: data,
        name: cost.name.trim(),
        category: cost.category,
        note: cost.note?.trim() || null,
        startsOn: cost.startsOn,
        stopsOn: null,
        amounts: [{ fromMonth: monthOf(cost.startsOn), amountPaise: cost.monthlyPaise, createdAt }],
        settlements: [],
        payments: [],
      }
    },

    async update(fixedCostId, details) {
      const args = {
        p_fixed_cost_id: fixedCostId,
        p_name: details.name,
        p_category: details.category,
        p_starts_on: details.startsOn,
        p_note: details.note ?? '',
      }
      const { error } =
        details.firstMonthPaise === undefined
          ? await client.rpc('update_fixed_cost', args)
          : await client.rpc('update_fixed_cost_v2', {
              ...args,
              p_first_month_paise: details.firstMonthPaise,
            })
      if (error) throw toFixedCostError(error)
    },

    async changeAmount(fixedCostId, fromMonth, amountPaise) {
      const { error } = await client.rpc('change_fixed_cost_amount', {
        p_fixed_cost_id: fixedCostId,
        p_from_month: fromMonth,
        p_amount_paise: amountPaise,
      })
      if (error) throw toFixedCostError(error)
    },

    async stop(fixedCostId, stopsOn, clearAhead) {
      const { error } = await client.rpc('stop_fixed_cost', {
        p_fixed_cost_id: fixedCostId,
        p_stops_on: stopsOn,
        p_clear_ahead: clearAhead,
      })
      if (error) throw toFixedCostError(error)
    },

    async close(closing) {
      const { error } = await client.rpc('stop_fixed_cost_v2', {
        p_fixed_cost_id: closing.fixedCostId,
        p_stops_on: closing.stopsOn,
        p_final_paise: closing.finalPaise,
        ...(closing.payment
          ? { p_payment_id: closing.payment.id, p_is_cash: closing.payment.isCash }
          : {}),
      })
      if (error) throw toFixedCostError(error)
    },

    async pay(payment) {
      const { error } = await client.rpc('record_fixed_cost_payment', {
        p_id: payment.id,
        p_fixed_cost_id: payment.fixedCostId,
        p_amount_paise: payment.amountPaise,
        p_paid_on: payment.paidOn,
        p_counts_in: payment.countsIn,
        p_is_cash: payment.isCash,
        ...(payment.note ? { p_note: payment.note } : {}),
        ...(payment.choice ? { p_choice: payment.choice } : {}),
      })
      if (error) throw toFixedCostError(error)
    },

    async undoPayment(fixedCostId, paymentId) {
      const { error } = await client.rpc('undo_fixed_cost_payment', {
        p_fixed_cost_id: fixedCostId,
        p_payment_id: paymentId,
      })
      if (error) throw toFixedCostError(error)
    },

    async settle(fixedCostId, month, amountPaise) {
      const { error } = await client.rpc('settle_fixed_cost_month', {
        p_fixed_cost_id: fixedCostId,
        p_month: month,
        p_amount_paise: amountPaise,
      })
      if (error) throw toFixedCostError(error)
    },

    async voidSettlement(settlementId) {
      // The guard stamps who voided it; the policy admits only its outlet's readers.
      const { error } = await client
        .from('fixed_cost_settlements')
        .update({ voided_at: new Date().toISOString() })
        .eq('id', settlementId)
        .is('voided_at', null)
      if (error) throw toFixedCostError(error)
    },

    async unpaid() {
      const { data, error } = await client.rpc('fixed_costs_unpaid')
      if (error) throw toFixedCostError(error)
      const read = data as unknown as Partial<FixedCostsUnpaid>
      return {
        count: read.count ?? 0,
        months: read.months ?? [],
        paise: read.paise ?? 0,
        categories: read.categories ?? {},
        today: read.today ?? null,
      }
    },
  }
}

/** The server's refusals, in the words the sheets already show. */
function toFixedCostError(error: PostgrestError): Error {
  switch (error.code) {
    case '42501':
      return new DataActionError('not_permitted', 'Fixed costs are for the owner and the manager.')
    case 'P0002':
      return new DataActionError('not_found', error.message)
    case '22023':
      return new DataActionError('refused', error.message)
    case '23514':
      return new DataActionError('refused', 'That figure is not possible. Look at it again.')
    default:
      return error
  }
}
