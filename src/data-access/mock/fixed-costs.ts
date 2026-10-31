import {
  addMonths,
  alreadyPaidIn,
  balance,
  lastDayOf,
  monthCost,
  monthOf,
  payEffect,
  payPrompt,
  settlementFor,
  shortBefore,
  unpaidEndedMonths,
  type FixedCostCategory,
  type FixedCostFacts,
} from '@/domain/fixed-costs'
import { DataActionError, type AppRole } from '../adapters'
import type { Tables } from '../database.types'
import type { FixedCostsAdapter } from '../fixed-costs'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'
import { DEMO_OUTLET_ID } from './store'

const CATEGORY_WORD: Record<FixedCostCategory, string> = {
  salary: 'Salary',
  rent: 'Rent',
  utility: 'Utility',
  other: 'Other',
}

/** The demo's facts for one fixed cost, its payments at their expenses' current amounts. */
export function demoFixedCostFacts(store: DemoStore, row: Tables<'fixed_costs'>): FixedCostFacts {
  const expenses = new Map(store.expenses.map((expense) => [expense.id, expense]))
  return {
    id: row.id,
    name: row.name,
    category: row.category as FixedCostCategory,
    note: row.note,
    startsOn: row.starts_on,
    stopsOn: row.stops_on,
    amounts: store.fixedCostAmounts
      .filter((a) => a.fixed_cost_id === row.id)
      .map((a) => ({
        id: a.id,
        fromMonth: a.from_month,
        amountPaise: a.amount_paise,
        createdAt: a.created_at,
        voidedAt: a.voided_at,
        paymentId: a.fixed_cost_payment_id,
      })),
    settlements: store.fixedCostSettlements
      .filter((s) => s.fixed_cost_id === row.id)
      .map((s) => ({
        id: s.id,
        month: s.month,
        amountPaise: s.amount_paise,
        createdAt: s.created_at,
        voidedAt: s.voided_at,
        paymentId: s.fixed_cost_payment_id,
      })),
    payments: store.fixedCostPayments
      .filter((p) => p.fixed_cost_id === row.id)
      .flatMap((p) => {
        const expense = expenses.get(p.expense_id)
        // Withdrawn on the Expenses page: no longer a payment of anything.
        if (!expense || expense.voided_at !== null) return []
        return [
          {
            id: p.id,
            expenseId: p.expense_id,
            amountPaise: expense.amount_paise,
            countsIn: expense.business_date,
            paidOn: p.paid_on,
            isCash: expense.is_cash,
            note: noteOf(expense.description, row.name),
            createdAt: p.created_at,
          },
        ]
      }),
  }
}

function noteOf(description: string | null, name: string): string | null {
  if (!description) return null
  const rest = description.startsWith(name) ? description.slice(name.length) : description
  const trimmed = rest.replace(/^\s*·\s*/, '').trim()
  return trimmed || null
}

/** Every fixed cost of an outlet, as facts, ongoing first. */
export function demoOutletFixedCosts(store: DemoStore, outletId: string): FixedCostFacts[] {
  return store.fixedCosts
    .filter((row) => row.outlet_id === outletId)
    .sort((a, b) =>
      (a.stops_on === null) === (b.stops_on === null)
        ? a.created_at.localeCompare(b.created_at)
        : a.stops_on === null
          ? -1
          : 1,
    )
    .map((row) => demoFixedCostFacts(store, row))
}

export function createMockFixedCostsAdapter(
  store: DemoStore,
  role: AppRole,
  userId: string,
  reach: readonly string[] | null,
): FixedCostsAdapter {
  let serial = store.fixedCosts.length + store.fixedCostPayments.length + 1
  const nextId = (prefix: string) =>
    `${prefix}-0000-4000-a000-${String(serial++).padStart(12, '0')}`
  const now = () => new Date().toISOString()

  function refuse(outletId: string): void {
    const mayReach =
      role === 'super_admin' || (role === 'franchise_admin' && (reach ?? []).includes(outletId))
    if (!mayReach)
      throw new DataActionError('not_permitted', 'Fixed costs are for the owner and the manager.')
  }

  function find(id: string): Tables<'fixed_costs'> {
    const row = store.fixedCosts.find((cost) => cost.id === id)
    if (!row) throw new DataActionError('not_found', 'That fixed cost is no longer there.')
    refuse(row.outlet_id)
    return row
  }

  function settle(
    row: Tables<'fixed_costs'>,
    month: string,
    amountPaise: number,
    paymentId: string | null = null,
  ) {
    store.fixedCostSettlements.push({
      id: nextId('fc500000'),
      fixed_cost_id: row.id,
      outlet_id: row.outlet_id,
      month,
      amount_paise: amountPaise,
      fixed_cost_payment_id: paymentId,
      created_by: userId,
      created_at: now(),
      voided_at: null,
      voided_by: null,
    })
  }

  function addAmount(
    row: Tables<'fixed_costs'>,
    fromMonth: string,
    amountPaise: number,
    paymentId: string | null = null,
  ) {
    store.fixedCostAmounts.push({
      id: nextId('fc200000'),
      fixed_cost_id: row.id,
      outlet_id: row.outlet_id,
      from_month: fromMonth,
      amount_paise: amountPaise,
      fixed_cost_payment_id: paymentId,
      created_by: userId,
      created_at: now(),
      voided_at: null,
      voided_by: null,
    })
  }

  const adapter: FixedCostsAdapter = {
    async list(outletId) {
      refuse(outletId)
      return { today: store.today, costs: demoOutletFixedCosts(store, outletId) }
    },

    async add(cost) {
      refuse(cost.outletId)
      if (!cost.name.trim())
        throw new DataActionError('name_required', 'Give it a name: a person or what it pays for.')
      if (!Number.isInteger(cost.monthlyPaise) || cost.monthlyPaise < 0)
        throw new DataActionError('bad_amount', 'The monthly amount is a number of rupees.')
      const row: Tables<'fixed_costs'> = {
        id: nextId('fc100000'),
        outlet_id: cost.outletId,
        name: cost.name.trim(),
        category: cost.category,
        note: cost.note?.trim() || null,
        starts_on: cost.startsOn,
        stops_on: null,
        created_by: userId,
        created_at: now(),
        updated_at: now(),
      }
      if (
        cost.firstMonthPaise !== undefined &&
        (!Number.isInteger(cost.firstMonthPaise) || cost.firstMonthPaise < 0)
      )
        throw new DataActionError('bad_amount', 'Say what the first month comes to, in rupees.')
      store.fixedCosts.push(row)
      addAmount(row, monthOf(cost.startsOn), cost.monthlyPaise)
      if (cost.firstMonthPaise !== undefined && !cost.startsOn.endsWith('-01'))
        settle(row, monthOf(cost.startsOn), cost.firstMonthPaise)
      return demoFixedCostFacts(store, row)
    },

    async update(fixedCostId, details) {
      const row = find(fixedCostId)
      if (!details.name.trim())
        throw new DataActionError('name_required', 'Give it a name: a person or what it pays for.')
      if (row.stops_on && details.startsOn > row.stops_on)
        throw new DataActionError('refused', 'It cannot start after it stopped.')
      // A start moved earlier than the first monthly amount carries that amount
      // back to it, so the months it gains cost what the first one did.
      const first = store.fixedCostAmounts
        .filter((a) => a.fixed_cost_id === row.id)
        .sort((a, b) => a.from_month.localeCompare(b.from_month))[0]
      if (first && first.from_month > monthOf(details.startsOn))
        addAmount(row, monthOf(details.startsOn), first.amount_paise)
      row.name = details.name.trim()
      row.category = details.category
      row.starts_on = details.startsOn
      row.note = details.note?.trim() || null
      row.updated_at = now()
      if (details.firstMonthPaise !== undefined)
        settle(row, monthOf(details.startsOn), details.firstMonthPaise)
    },

    async changeAmount(fixedCostId, fromMonth, amountPaise) {
      addAmount(find(fixedCostId), fromMonth, amountPaise)
    },

    async stop(fixedCostId, stopsOn, clearAhead) {
      const row = find(fixedCostId)
      if (stopsOn < row.starts_on)
        throw new DataActionError('refused', 'It cannot stop before it started.')
      row.stops_on = stopsOn
      row.updated_at = now()
      if (clearAhead) {
        const facts = demoFixedCostFacts(store, row)
        const last = monthOf(stopsOn)
        const ahead = -balance(facts, last)
        if (ahead > 0) settle(row, last, monthCost(facts, last) + ahead)
      }
    },

    async close(closing) {
      const row = find(closing.fixedCostId)
      // A retried tap finds its payment and settles nothing twice (design D2).
      if (
        closing.payment &&
        store.fixedCostPayments.some((p) => p.expense_id === closing.payment!.id)
      )
        return
      if (closing.stopsOn < row.starts_on)
        throw new DataActionError('refused', 'It cannot stop before it started.')
      if (closing.stopsOn > store.today)
        throw new DataActionError('refused', 'It stops today or on a day already gone.')
      if (!Number.isInteger(closing.finalPaise) || closing.finalPaise < 0)
        throw new DataActionError(
          'bad_amount',
          'The final payment is a number of rupees, 0 for none.',
        )
      const before = demoFixedCostFacts(store, row)
      if (before.stopsOn && settlementFor(before, monthOf(before.stopsOn)))
        throw new DataActionError('refused', 'It is already stopped.')
      row.stops_on = closing.stopsOn
      row.updated_at = now()
      // Stopping closes it: every month through the stop month settled, as
      // `stop_fixed_cost_v3` does (owner, 2026-10-31).
      const month = monthOf(closing.stopsOn)
      const facts = demoFixedCostFacts(store, row)
      for (const short of shortBefore(facts, month, store.today))
        settle(row, short.month, short.coveredPaise)
      settle(
        row,
        month,
        alreadyPaidIn(demoFixedCostFacts(store, row), month, store.today) + closing.finalPaise,
      )
      if (closing.payment && closing.finalPaise > 0)
        await adapter.pay({
          id: closing.payment.id,
          fixedCostId: row.id,
          amountPaise: closing.finalPaise,
          paidOn: closing.stopsOn,
          countsIn: closing.stopsOn,
          isCash: closing.payment.isCash,
          note: 'Final payment',
          choice: null,
        })
    },

    async pay(payment) {
      const row = find(payment.fixedCostId)
      if (store.fixedCostPayments.some((p) => p.expense_id === payment.id)) return
      if (!Number.isInteger(payment.amountPaise) || payment.amountPaise <= 0)
        throw new DataActionError('bad_amount', 'A payment needs an amount above zero.')
      if (payment.paidOn > store.today || payment.countsIn > store.today)
        throw new DataActionError('refused', 'A payment cannot be dated after today.')
      const countsIn = payment.isCash ? payment.paidOn : payment.countsIn
      const facts = demoFixedCostFacts(store, row)
      // The server's recomputation (design D5): what is owed is reckoned at today,
      // whatever month the payment shows in, and a choice it would not offer is refused.
      const prompt = payPrompt(facts, payment.amountPaise, store.today)
      if (prompt.kind === 'over' && payment.choice === null)
        throw new DataActionError(
          'refused',
          'Say what the extra is: an advance, a one-time extra or a new monthly amount.',
        )
      let effect
      try {
        effect = payEffect(facts, prompt, payment.choice, payment.amountPaise, store.today)
      } catch {
        throw new DataActionError(
          'refused',
          'That choice does not fit this payment. Look at it again.',
        )
      }
      const at = now()
      store.expenses.push({
        id: payment.id,
        outlet_id: row.outlet_id,
        business_date: countsIn,
        category: CATEGORY_WORD[row.category as FixedCostCategory],
        description: payment.note?.trim() ? `${row.name} · ${payment.note.trim()}` : row.name,
        amount_paise: payment.amountPaise,
        is_cash: payment.isCash,
        occurred_at: payment.isCash ? at : null,
        recorded_by: userId,
        recorded_away: false,
        shared_cost: false,
        source_system: null,
        source_ref: null,
        created_at: at,
        updated_at: at,
        updated_by: null,
        voided_at: null,
        voided_by: null,
        voided_reason: null,
      })
      const linkId = nextId('fc400000')
      store.fixedCostPayments.push({
        id: linkId,
        fixed_cost_id: row.id,
        outlet_id: row.outlet_id,
        expense_id: payment.id,
        paid_on: payment.paidOn,
        created_by: userId,
        created_at: at,
      })
      // What the answer recorded names the payment, so undoing it takes them back.
      if (effect.settlement)
        settle(row, effect.settlement.month, effect.settlement.amountPaise, linkId)
      if (effect.amount) addAmount(row, effect.amount.fromMonth, effect.amount.amountPaise, linkId)
    },

    async undoPayment(fixedCostId, paymentId) {
      const row = find(fixedCostId)
      const link = store.fixedCostPayments.find(
        (p) => p.id === paymentId && p.fixed_cost_id === row.id,
      )
      if (!link) throw new DataActionError('not_found', 'That payment is no longer there.')
      const at = now()
      const expense = store.expenses.find((e) => e.id === link.expense_id)
      if (expense && expense.voided_at === null) {
        expense.voided_at = at
        expense.voided_by = userId
        expense.voided_reason = 'Undone on the fixed cost'
        expense.updated_at = at
        expense.updated_by = userId
      }
      for (const s of store.fixedCostSettlements)
        if (s.fixed_cost_payment_id === link.id && !s.voided_at) {
          s.voided_at = at
          s.voided_by = userId
        }
      for (const a of store.fixedCostAmounts)
        if (a.fixed_cost_payment_id === link.id && !a.voided_at) {
          a.voided_at = at
          a.voided_by = userId
        }
    },

    async settle(fixedCostId, month, amountPaise) {
      settle(find(fixedCostId), month, amountPaise)
    },

    async voidSettlement(settlementId) {
      const settlement = store.fixedCostSettlements.find((s) => s.id === settlementId)
      if (!settlement) throw new DataActionError('not_found', 'That settlement is no longer there.')
      find(settlement.fixed_cost_id)
      if (settlement.voided_at) return
      settlement.voided_at = now()
      settlement.voided_by = userId
    },

    async unpaid() {
      if (role !== 'super_admin' && role !== 'franchise_admin')
        return { count: 0, months: [], paise: 0, categories: {}, today: null }
      const months = new Set<string>()
      const categories: Partial<Record<FixedCostCategory, number>> = {}
      let count = 0
      let paise = 0
      for (const row of store.fixedCosts) {
        if (role === 'franchise_admin' && !(reach ?? []).includes(row.outlet_id)) continue
        const unpaid = unpaidEndedMonths(demoFixedCostFacts(store, row), store.today)
        if (unpaid.length === 0) continue
        count += 1
        const category = row.category as FixedCostCategory
        categories[category] = (categories[category] ?? 0) + 1
        for (const month of unpaid) {
          months.add(month.month)
          paise += month.costPaise - month.coveredPaise
        }
      }
      return { count, months: [...months].sort(), paise, categories, today: store.today }
    },
  }
  return adapter
}

// ── The demo's fixed costs (design: Demo) ─────────────────────────────────

const OWNER = personaFixtures.super_admin.profile.id

/**
 * Six fixed costs at the demo outlet, each showing one rule: rent paid on time;
 * a salary paid last month on the 2nd and counted in it, with an advance this
 * month; a salary paid a month ahead; one who joined on last month's 20th and is
 * still unpaid for it, which is what Needs attention names; electricity settled
 * higher last month; and garbage.
 *
 * Every date is relative to the store's today, so the walkthrough reads the same
 * on any day. No payment is cash: the drawer's fixtures are their own story.
 */
export function seedDemoFixedCosts(store: DemoStore): void {
  const today = store.today
  const month = monthOf(today)
  const previous = addMonths(month, -1)
  const previousEnd = lastDayOf(previous)
  const day = (n: number) => {
    const date = `${month.slice(0, 8)}${String(n).padStart(2, '0')}`
    return date > today ? today : date
  }
  let serial = 1
  const id = (prefix: string) => `${prefix}-0000-4000-b000-${String(serial++).padStart(12, '0')}`
  const at = (date: string, time = '11:00') => `${date}T${time}:00+05:30`

  function cost(
    name: string,
    category: FixedCostCategory,
    monthlyPaise: number,
    startsOn: string,
  ): Tables<'fixed_costs'> {
    // A minute apart, in the order added, so the list can keep that order.
    const added = at(previous, `09:${String(store.fixedCosts.length).padStart(2, '0')}`)
    const row: Tables<'fixed_costs'> = {
      id: id('fc100000'),
      outlet_id: DEMO_OUTLET_ID,
      name,
      category,
      note: null,
      starts_on: startsOn,
      stops_on: null,
      created_by: OWNER,
      created_at: added,
      updated_at: added,
    }
    store.fixedCosts.push(row)
    store.fixedCostAmounts.push({
      id: id('fc200000'),
      fixed_cost_id: row.id,
      outlet_id: DEMO_OUTLET_ID,
      from_month: monthOf(startsOn),
      amount_paise: monthlyPaise,
      fixed_cost_payment_id: null,
      created_by: OWNER,
      created_at: added,
      voided_at: null,
      voided_by: null,
    })
    return row
  }

  function pay(
    row: Tables<'fixed_costs'>,
    amountPaise: number,
    countsIn: string,
    paidOn = countsIn,
  ) {
    const expenseId = id('fc300000')
    store.expenses.push({
      id: expenseId,
      outlet_id: DEMO_OUTLET_ID,
      business_date: countsIn,
      category: CATEGORY_WORD[row.category as FixedCostCategory],
      description: row.name,
      amount_paise: amountPaise,
      is_cash: false,
      occurred_at: null,
      recorded_by: OWNER,
      recorded_away: false,
      shared_cost: false,
      source_system: null,
      source_ref: null,
      created_at: at(paidOn, '12:00'),
      updated_at: at(paidOn, '12:00'),
      updated_by: null,
      voided_at: null,
      voided_by: null,
      voided_reason: null,
    })
    store.fixedCostPayments.push({
      id: id('fc400000'),
      fixed_cost_id: row.id,
      outlet_id: DEMO_OUTLET_ID,
      expense_id: expenseId,
      paid_on: paidOn,
      created_by: OWNER,
      created_at: at(paidOn, '12:00'),
    })
  }

  const rent = cost('Shop rent', 'rent', 2_500_000, previous)
  pay(rent, 2_500_000, previousEnd)

  const nayan = cost('Nayan', 'salary', 1_200_000, previous)
  pay(nayan, 1_200_000, previousEnd, day(2))
  pay(nayan, 400_000, day(10))

  const santu = cost('Santu', 'salary', 1_000_000, previous)
  pay(santu, 2_000_000, `${previous.slice(0, 8)}25`)

  cost('Priyanka', 'salary', 900_000, `${previous.slice(0, 8)}20`)

  const electricity = cost('Electricity', 'utility', 400_000, previous)
  pay(electricity, 485_000, previousEnd)
  store.fixedCostSettlements.push({
    id: id('fc500000'),
    fixed_cost_id: electricity.id,
    outlet_id: DEMO_OUTLET_ID,
    month: previous,
    amount_paise: 485_000,
    fixed_cost_payment_id: null,
    created_by: OWNER,
    created_at: at(previousEnd, '12:01'),
    voided_at: null,
    voided_by: null,
  })

  const garbage = cost('Garbage', 'other', 60_000, previous)
  pay(garbage, 60_000, previousEnd)
}
