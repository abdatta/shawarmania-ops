import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  ManualLedgerActionError,
  type ManualLedgerAdapter,
  type ManualLedgerDay,
  type ManualLedgerDayInput,
  type ManualLedgerExpense,
  type ManualLedgerExpensePatch,
  type ManualLedgerMonth,
  type NewManualLedgerExpense,
} from '../adapters'
import type { Database, Tables } from '../database.types'

/**
 * The real manual-ledger adapter (#36) — **temporary, and the whole file goes
 * when the capability does.**
 *
 * Two things it deliberately does not do. It computes nothing: expected cash,
 * the difference, net aggregator revenue and the monthly profit all live in
 * `src/features/manual-ledger/ledger.ts`, so there is exactly one implementation
 * of the rounding rule (design D3). And it never supplies `recorded_by` — the
 * column defaults to `auth.uid()` and the guard freezes it, so attribution is
 * the database's answer rather than a screen's claim.
 */

/**
 * `*` rather than a column list, which is a departure from every other adapter
 * here and worth the sentence.
 *
 * A column list long enough to need wrapping has to be written as concatenated
 * string fragments, and supabase-js infers row types from the *literal* — so a
 * concatenated list silently degrades every mapper's argument to
 * `GenericStringError` and forces an `as unknown as` cast on each read. These two
 * tables are narrow, owner-only and read a handful of times a day, so the four
 * extra columns cost nothing measurable and buy a fully inferred row type: a
 * column renamed by a later migration fails to compile here instead of at
 * runtime.
 */
const ALL = '*'

function toDay(row: Tables<'manual_ledger_days'>): ManualLedgerDay {
  return {
    outletId: row.outlet_id,
    businessDate: row.business_date,
    openingCashPaise: row.opening_cash_paise,
    cashRevenuePaise: row.cash_revenue_paise,
    upiRevenuePaise: row.upi_revenue_paise,
    zomatoRevenuePaise: row.zomato_revenue_paise,
    swiggyRevenuePaise: row.swiggy_revenue_paise,
    cashAddedPaise: row.cash_added_paise,
    cashAddedReason: row.cash_added_reason,
    cashRemovedPaise: row.cash_removed_paise,
    cashRemovedReason: row.cash_removed_reason,
    countedCashPaise: row.counted_cash_paise,
    zomatoCommissionBp: row.zomato_commission_bp,
    swiggyCommissionBp: row.swiggy_commission_bp,
    note: row.note,
  }
}

function toExpense(row: Tables<'manual_ledger_expenses'>): ManualLedgerExpense {
  return {
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    isCash: row.is_cash,
    amountPaise: row.amount_paise,
    description: row.description,
    createdAt: row.created_at,
  }
}

/** Blank text is `null` where the column is nullable, never `''` (#19). */
function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/**
 * The first day of the month after this one, as an **exclusive** upper bound.
 *
 * Exclusive rather than `${month}-31`, because that is not a date in February and
 * PostgreSQL would refuse the literal rather than return an empty month. This
 * also gets a leap year right without a table of month lengths.
 */
function firstOfNextMonth(month: string): string {
  const parsed = /^(\d{4})-(\d{2})$/.exec(month)
  const year = Number(parsed?.[1])
  const monthNumber = Number(parsed?.[2])
  if (!parsed || monthNumber < 1 || monthNumber > 12) {
    throw new ManualLedgerActionError('bad_month', `That is not a month this ledger can read.`)
  }
  return monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`
}

export function createSupabaseManualLedgerAdapter(
  client: SupabaseClient<Database>,
): ManualLedgerAdapter {
  return {
    async getDay(outletId, businessDate) {
      const { data, error } = await client
        .from('manual_ledger_days')
        .select(ALL)
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
        .maybeSingle()
      if (error) throw toLedgerError(error)
      return data ? toDay(data) : null
    },

    async getPreviousDay(outletId, businessDate) {
      // The most recent row BEFORE this date, not literally yesterday: a gap in
      // the notebook is normal and the chain runs between the rows that exist.
      const { data, error } = await client
        .from('manual_ledger_days')
        .select(ALL)
        .eq('outlet_id', outletId)
        .lt('business_date', businessDate)
        .order('business_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw toLedgerError(error)
      return data ? toDay(data) : null
    },

    async upsertDay(day: ManualLedgerDayInput) {
      const { data, error } = await client
        .from('manual_ledger_days')
        // The upsert is the edit: one row per outlet per date, corrected in
        // place, with no correction history (design D6).
        .upsert(
          {
            outlet_id: day.outletId,
            business_date: day.businessDate,
            opening_cash_paise: day.openingCashPaise,
            cash_revenue_paise: day.cashRevenuePaise,
            upi_revenue_paise: day.upiRevenuePaise,
            zomato_revenue_paise: day.zomatoRevenuePaise,
            swiggy_revenue_paise: day.swiggyRevenuePaise,
            cash_added_paise: day.cashAddedPaise,
            cash_added_reason: trimmed(day.cashAddedReason),
            cash_removed_paise: day.cashRemovedPaise,
            cash_removed_reason: trimmed(day.cashRemovedReason),
            counted_cash_paise: day.countedCashPaise,
            zomato_commission_bp: day.zomatoCommissionBp,
            swiggy_commission_bp: day.swiggyCommissionBp,
            note: trimmed(day.note),
          },
          { onConflict: 'outlet_id,business_date' },
        )
        .select(ALL)
        .single()
      if (error) throw toLedgerError(error)
      return toDay(data)
    },

    async deleteDay(outletId, businessDate) {
      const { error } = await client
        .from('manual_ledger_days')
        .delete()
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
      if (error) throw toLedgerError(error)
    },

    async listExpenses(outletId, businessDate) {
      const { data, error } = await client
        .from('manual_ledger_expenses')
        .select(ALL)
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
        .order('created_at', { ascending: false })
      if (error) throw toLedgerError(error)
      return (data ?? []).map(toExpense)
    },

    async createExpense(expense: NewManualLedgerExpense) {
      const { data, error } = await client
        .from('manual_ledger_expenses')
        .insert({
          outlet_id: expense.outletId,
          business_date: expense.businessDate,
          category: expense.category,
          is_cash: expense.isCash,
          amount_paise: expense.amountPaise,
          // Not `trimmed()`: this column is `not null` and refuses blank, so the
          // honest move is to send what was typed and let the database refuse it
          // rather than turn a blank into a null the column cannot hold either.
          description: expense.description.trim(),
        })
        .select(ALL)
        .single()
      if (error) throw toLedgerError(error)
      return toExpense(data)
    },

    async updateExpense(id, patch: ManualLedgerExpensePatch) {
      const { data, error } = await client
        .from('manual_ledger_expenses')
        .update({
          ...(patch.category === undefined ? {} : { category: patch.category }),
          ...(patch.isCash === undefined ? {} : { is_cash: patch.isCash }),
          ...(patch.amountPaise === undefined ? {} : { amount_paise: patch.amountPaise }),
          ...(patch.description === undefined ? {} : { description: patch.description.trim() }),
        })
        .eq('id', id)
        .select(ALL)
        .single()
      if (error) throw toLedgerError(error)
      return toExpense(data)
    },

    async deleteExpense(id) {
      const { error } = await client.from('manual_ledger_expenses').delete().eq('id', id)
      if (error) throw toLedgerError(error)
    },

    async getMonth(outletId, month) {
      const from = `${month}-01`
      const to = firstOfNextMonth(month)

      const [days, expenses] = await Promise.all([
        client
          .from('manual_ledger_days')
          .select(ALL)
          .eq('outlet_id', outletId)
          .gte('business_date', from)
          .lt('business_date', to)
          .order('business_date', { ascending: true }),
        client
          .from('manual_ledger_expenses')
          .select(ALL)
          .eq('outlet_id', outletId)
          .gte('business_date', from)
          .lt('business_date', to)
          .order('business_date', { ascending: true }),
      ])

      if (days.error) throw toLedgerError(days.error)
      if (expenses.error) throw toLedgerError(expenses.error)

      return {
        days: (days.data ?? []).map(toDay),
        expenses: (expenses.data ?? []).map(toExpense),
      } satisfies ManualLedgerMonth
    },
  }
}

/**
 * The refusals this ledger's constraints actually produce, said in words the
 * owner can act on. Matched on SQLSTATE rather than message text: the codes are
 * the contract the migration wrote down.
 */
function toLedgerError(error: PostgrestError): ManualLedgerActionError {
  switch (error.code) {
    case '23505':
      return new ManualLedgerActionError(
        'day_exists',
        'This day is already recorded for this outlet. Open it and correct the figures instead.',
      )
    case '23514':
      return new ManualLedgerActionError(
        'impossible_figure',
        'One of those figures cannot be right — a drawer cannot hold less than nothing, ' +
          'a cash movement needs a reason, and an expense needs an amount above zero.',
      )
    case '23502':
      return new ManualLedgerActionError(
        'missing_field',
        'Something required was left empty. An expense needs a description of what it was for.',
      )
    case '42501':
      return new ManualLedgerActionError(
        'not_permitted',
        'Only an owner can use the manual ledger.',
      )
    case 'P0001':
      return new ManualLedgerActionError(
        'refused',
        // The two the trigger raises: a future date, and moving a recorded day.
        'That is not a day this ledger can record. A day cannot be dated ahead of ' +
          'the outlet’s own trading day, and a recorded day cannot be moved to another date.',
      )
    default:
      return new ManualLedgerActionError('failed', 'That did not save. Try again in a moment.')
  }
}
