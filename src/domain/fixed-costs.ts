/**
 * Fixed costs: what each month of one costs, what is still owed, and the share
 * of this month's that Pro-rata P&L charges (fixed-costs-are-spread-over-the-month,
 * design D3–D6).
 *
 * **Pure, and the one TypeScript copy of the rules.** The mock adapter folds
 * with it and the pay sheet previews with it; the database derives the same
 * figures in `fixed_cost_month_cost` and its readers. `fixed-cost-cases.json`
 * holds the two to each other, as the bill-identity cases do for billing.
 *
 * Three decisions carry the file, each one somebody could make the other way:
 *
 * - **No month is stored.** A month's cost is derived from the fixed cost, its
 *   monthly amounts and its settlements every time, so "carried over" needs no
 *   job on the 1st.
 * - **No payment names a month.** Payments fill the oldest month's cost first,
 *   in the order they count in. An advance simply runs on into months not yet
 *   owed; nothing is split or reallocated when a month is settled later.
 * - **Pro-rata charges only what is unpaid.** A payment is in P&L the moment it
 *   is recorded, so for each fixed cost the charge is the month's share to date
 *   less what has covered this month, never below zero (owner, 2026-10-19).
 */

import { NotPaiseError } from './money'

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

export type FixedCostCategory = 'salary' | 'rent' | 'utility' | 'other'

export const FIXED_COST_CATEGORIES: readonly FixedCostCategory[] = [
  'salary',
  'rent',
  'utility',
  'other',
]

export const FIXED_COST_CATEGORY_LABEL: Record<FixedCostCategory, string> = {
  salary: 'Salary',
  rent: 'Rent',
  utility: 'Utility',
  other: 'Other',
}

/** A monthly amount from a month on. For one `fromMonth`, the latest unvoided row wins. */
export interface FixedCostAmount {
  id?: string
  fromMonth: string
  amountPaise: number
  createdAt: string
  /** Withdrawn, with the payment that set it; it no longer applies. */
  voidedAt?: string | null
  /** The payment whose Permanent pay raise or cut set it, if one did. */
  paymentId?: string | null
}

/** One month settled at a figure. The latest unvoided one is that month's cost. */
export interface FixedCostSettlement {
  id: string
  month: string
  amountPaise: number
  createdAt: string
  voidedAt: string | null
  /** The payment whose answer settled the month, if one did. */
  paymentId?: string | null
}

/** A payment whose expense is effective, at the expense's current amount. */
export interface FixedCostPayment {
  id: string
  expenseId: string
  amountPaise: number
  /** The expense's business date: the day and month the payment counts in. */
  countsIn: string
  paidOn: string
  isCash: boolean
  note: string | null
  createdAt: string
}

export interface FixedCostFacts {
  id: string
  name: string
  category: FixedCostCategory
  note: string | null
  startsOn: string
  stopsOn: string | null
  amounts: readonly FixedCostAmount[]
  settlements: readonly FixedCostSettlement[]
  payments: readonly FixedCostPayment[]
}

// ── Calendar ──────────────────────────────────────────────────────────────

/** `2026-10-19` → `2026-10-01`. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

/** The month `n` months after `month` (both 1sts). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1))
  return d.toISOString().slice(0, 10)
}

export function lastDayOf(month: string): string {
  return `${month.slice(0, 8)}${String(daysInMonth(month)).padStart(2, '0')}`
}

/** Whole days from `from` to `to`, both counted. Zero when `to` is before `from`. */
function daysBetween(from: string, to: string): number {
  if (to < from) return 0
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

function minDate(a: string, b: string): string {
  return a < b ? a : b
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b
}

// ── One month's cost (D3) ─────────────────────────────────────────────────

/** The dates of `month` the fixed cost runs on, from its start to its stop. */
export function activeDays(cost: Pick<FixedCostFacts, 'startsOn' | 'stopsOn'>, month: string) {
  const first = maxDate(month, cost.startsOn)
  const last = cost.stopsOn ? minDate(lastDayOf(month), cost.stopsOn) : lastDayOf(month)
  return { first, last, count: daysBetween(first, last) }
}

/** Whether `month` runs on fewer than all of its dates. */
export function isProrated(cost: Pick<FixedCostFacts, 'startsOn' | 'stopsOn'>, month: string) {
  const { count } = activeDays(cost, month)
  return count > 0 && count < daysInMonth(month)
}

/** The monthly amount in effect for `month`: the latest `fromMonth` at or before it. */
export function amountFor(amounts: readonly FixedCostAmount[], month: string): number {
  let best: FixedCostAmount | null = null
  for (const row of amounts) {
    if (row.fromMonth > month || row.voidedAt) continue
    if (
      !best ||
      row.fromMonth > best.fromMonth ||
      (row.fromMonth === best.fromMonth && row.createdAt > best.createdAt)
    )
      best = row
  }
  return best ? assertPaise(best.amountPaise) : 0
}

/** The monthly amount × active days ÷ days in the month, rounded down to the paisa. */
export function proratedAmount(cost: FixedCostFacts, month: string): number {
  const { count } = activeDays(cost, month)
  if (count === 0) return 0
  const amount = amountFor(cost.amounts, month)
  return Math.floor((amount * count) / daysInMonth(month))
}

/** The latest unvoided settlement of `month`, if there is one. */
export function settlementFor(cost: FixedCostFacts, month: string): FixedCostSettlement | null {
  let best: FixedCostSettlement | null = null
  for (const row of cost.settlements) {
    if (row.month !== month || row.voidedAt) continue
    if (!best || row.createdAt > best.createdAt) best = row
  }
  return best
}

/** What `month` costs: its settlement where it has one, else its prorated amount. */
export function monthCost(cost: FixedCostFacts, month: string): number {
  if (activeDays(cost, month).count === 0) return 0
  const settled = settlementFor(cost, month)
  return settled ? assertPaise(settled.amountPaise) : proratedAmount(cost, month)
}

/** Every month the fixed cost runs in, from its start through `through` (a 1st). */
export function monthsThrough(cost: FixedCostFacts, through: string): string[] {
  const months: string[] = []
  const last = cost.stopsOn ? minDate(monthOf(cost.stopsOn), through) : through
  for (let month = monthOf(cost.startsOn); month <= last; month = addMonths(month, 1))
    months.push(month)
  return months
}

// ── Coverage and the balance (D4) ─────────────────────────────────────────

export interface MonthCoverage {
  month: string
  costPaise: number
  coveredPaise: number
}

export interface Coverage {
  months: MonthCoverage[]
  /** Paid beyond every month through `through`: an advance on months to come. */
  aheadPaise: number
}

function paymentsInOrder(payments: readonly FixedCostPayment[]): FixedCostPayment[] {
  return [...payments].sort((a, b) =>
    a.countsIn === b.countsIn
      ? a.createdAt.localeCompare(b.createdAt)
      : a.countsIn.localeCompare(b.countsIn),
  )
}

/**
 * First in, first out: the payments counted on or before `onOrBefore`, in the
 * order they count in, fill each month from the oldest through `through`.
 */
export function coverage(
  cost: FixedCostFacts,
  through: string,
  onOrBefore: string = lastDayOf(through),
): Coverage {
  const months = monthsThrough(cost, through).map((month) => ({
    month,
    costPaise: monthCost(cost, month),
    coveredPaise: 0,
  }))
  let pool = 0
  for (const payment of paymentsInOrder(cost.payments))
    if (payment.countsIn <= onOrBefore) pool += assertPaise(payment.amountPaise)
  for (const row of months) {
    const take = Math.min(pool, row.costPaise)
    row.coveredPaise = take
    pool -= take
  }
  return { months, aheadPaise: pool }
}

/** Σ cost through `through` − Σ payments counted by its end. Below zero is paid ahead. */
export function balance(cost: FixedCostFacts, through: string): number {
  const months = monthsThrough(cost, through)
  let owed = 0
  for (const month of months) owed += monthCost(cost, month)
  const end = lastDayOf(through)
  for (const payment of cost.payments)
    if (payment.countsIn <= end) owed -= assertPaise(payment.amountPaise)
  return owed
}

/**
 * What payments leave for `month` once every earlier month is paid
 * (part-months-cost-what-was-agreed, design D2): everything counted on or
 * before `today`, less what the months before it cost, never below zero. An
 * advance paid in an earlier month is in it; where an earlier month is still
 * short it is zero. The TypeScript copy of `fixed_cost_already_paid_in`.
 */
export function alreadyPaidIn(cost: FixedCostFacts, month: string, today: string): number {
  let paid = 0
  for (const payment of cost.payments)
    if (payment.countsIn <= today) paid += assertPaise(payment.amountPaise)
  let earlier = 0
  for (const m of monthsThrough(cost, addMonths(month, -1))) earlier += monthCost(cost, m)
  return Math.max(0, paid - earlier)
}

/**
 * The months before `month` that payments leave short, each with what they
 * covered: what stopping on a day of `month` settles them at, so a stopped
 * cost owes nothing (owner, 2026-10-31). The TypeScript copy of the loop in
 * `stop_fixed_cost_v3`.
 */
export function shortBefore(
  cost: FixedCostFacts,
  month: string,
  today: string,
): { month: string; coveredPaise: number }[] {
  return coverage(cost, addMonths(month, -1), today)
    .months.filter((row) => row.month < month && row.coveredPaise < row.costPaise)
    .map((row) => ({ month: row.month, coveredPaise: row.coveredPaise }))
}

/** What the stop month comes to when it stops on `stopsOn` with `finalPaise` paid on top. */
export function closingCost(
  cost: FixedCostFacts,
  stopsOn: string,
  finalPaise: number,
  today: string,
): number {
  return alreadyPaidIn({ ...cost, stopsOn }, monthOf(stopsOn), today) + assertPaise(finalPaise)
}

/**
 * A part month's agreed figure, as a cost's months name it: the month it stopped
 * in is its *closing*, the month it started in its *first month*. Null for a
 * whole month, or a part month with no agreed figure.
 */
export function agreedPartMonth(
  cost: FixedCostFacts,
  month: string,
): 'closing' | 'first month' | null {
  if (!settlementFor(cost, month)) return null
  // Stopped on the month's last day is still its closing (owner, 2026-10-31).
  if (cost.stopsOn && monthOf(cost.stopsOn) === month) return 'closing'
  return isProrated(cost, month) ? 'first month' : null
}

export type BalanceState =
  { kind: 'to-pay'; paise: number } | { kind: 'clear'; paise: 0 } | { kind: 'ahead'; paise: number }

/** **To pay**, **All clear** or **Paid ahead**: never a negative figure on screen. */
export function balanceState(paise: number): BalanceState {
  assertPaise(paise)
  if (paise > 0) return { kind: 'to-pay', paise }
  if (paise < 0) return { kind: 'ahead', paise: -paise }
  return { kind: 'clear', paise: 0 }
}

/** Months before `today`'s month that ended with part of their cost uncovered. */
export function unpaidEndedMonths(cost: FixedCostFacts, today: string): MonthCoverage[] {
  const previous = addMonths(monthOf(today), -1)
  if (previous < monthOf(cost.startsOn)) return []
  // Every payment counted so far fills the ended months first.
  return coverage(cost, previous, today).months.filter((m) => m.coveredPaise < m.costPaise)
}

/**
 * One fixed cost as the Fixed tab reads it: this month on its own, then what is
 * overdue from months that ended and what was paid ahead (owner, 2026-10-19:
 * "make it clear from the label itself"). The balance across months is the
 * same money, said in parts that each mean one thing.
 */
export interface ThisMonthStatus {
  /** Whether it runs on any date of this month. */
  active: boolean
  /** What this month costs. */
  costPaise: number
  /** What payments have covered of this month, including an earlier advance. */
  paidPaise: number
  /** This month's cost not covered yet. */
  leftPaise: number
  /** Paid beyond this month: an advance on months to come. */
  aheadPaise: number
  /** Ended months with part of their cost uncovered, oldest first. */
  overdue: { month: string; paise: number }[]
}

export function thisMonthStatus(cost: FixedCostFacts, today: string): ThisMonthStatus {
  const month = monthOf(today)
  const stopMonth = cost.stopsOn ? monthOf(cost.stopsOn) : null
  const through = stopMonth && stopMonth < month ? stopMonth : month
  const fifo = coverage(cost, through, today)
  const current = fifo.months.find((m) => m.month === month)
  const active = current !== undefined && activeDays(cost, month).count > 0
  const costPaise = active ? current.costPaise : 0
  const paidPaise = active ? current.coveredPaise : 0
  return {
    active,
    costPaise,
    paidPaise,
    leftPaise: Math.max(0, costPaise - paidPaise),
    aheadPaise: fifo.aheadPaise,
    overdue: fifo.months
      .filter((m) => m.month < month && m.coveredPaise < m.costPaise)
      .map((m) => ({ month: m.month, paise: m.costPaise - m.coveredPaise })),
  }
}

// ── Paying (D5) ───────────────────────────────────────────────────────────
//
// Reworked after the owner's demo round (2026-10-19): the sheet compares the
// amount with what is owed **up to today**, a fixed figure at its top, so
// nothing chosen lower down (the date, the month it shows in) changes what is
// asked above it. It asks only when there is something to decide.

/** What a fixed cost owes today: overdue months, and this month's cost not yet paid. */
export interface PayOwed {
  overduePaise: number
  overdueMonths: string[]
  thisMonthPaise: number
  /** The amount the sheet starts at: the overdue months if any, else this month. */
  suggestedPaise: number
}

export function payOwed(cost: FixedCostFacts, today: string): PayOwed {
  const status = thisMonthStatus(cost, today)
  const overduePaise = status.overdue.reduce((sum, row) => sum + row.paise, 0)
  return {
    overduePaise,
    overdueMonths: status.overdue.map((row) => row.month),
    thisMonthPaise: status.leftPaise,
    // On the 1st or 2nd the payment is usually last month's salary; mid-month it
    // is this month's, or an advance on it.
    suggestedPaise: overduePaise > 0 ? overduePaise : status.leftPaise,
  }
}

/**
 * What a different payment does. More than owed: `ahead` (an advance), `extra`
 * (one time), `new-amount` (a raise). Less: nothing (the rest later), `settle`
 * (one time: leave, a fine), `cut` (a pay cut from next month).
 */
export type PayChoiceKey = 'settle' | 'cut' | 'ahead' | 'extra' | 'new-amount'

export type PayPrompt =
  | { kind: 'none' }
  /**
   * Paid less than a month owes, an ended one or this one: the rest later, a
   * one-time cut, or a pay cut from the next month (where it is not prorated).
   */
  | {
      kind: 'short'
      month: string
      restPaise: number
      /** What the month has covered once this payment is in: a cut settles it here. */
      settledAtPaise: number
      choices: PayChoiceKey[]
    }
  /** Paid more than everything owed up to today. */
  | {
      kind: 'over'
      month: string
      excessPaise: number
      choices: PayChoiceKey[]
      default: PayChoiceKey
    }

function withPending(cost: FixedCostFacts, amount: number, today: string): FixedCostFacts {
  const pending: FixedCostPayment = {
    id: 'pending',
    expenseId: 'pending',
    amountPaise: amount,
    countsIn: today,
    paidOn: today,
    isCash: false,
    note: null,
    createdAt: '9999-12-31T23:59:59Z',
  }
  return { ...cost, payments: [...cost.payments, pending] }
}

/**
 * What the sheet asks, if anything, for `amount` paid `today`:
 *
 * - more than everything owed through this month: advance, one-time extra, or a
 *   new monthly amount (the last not where this month is prorated);
 * - less than an ended month owes: the tickbox, for the month it leaves short;
 * - otherwise nothing. Paying last month in full and part of this one is the
 *   everyday case and asks nothing.
 */
export function payPrompt(cost: FixedCostFacts, amount: number, today: string): PayPrompt {
  assertPaise(amount)
  const month = monthOf(today)
  const owedPaise = Math.max(0, balance(cost, month))
  if (amount > owedPaise) {
    const choices: PayChoiceKey[] = isProrated(cost, month)
      ? ['ahead', 'extra']
      : ['ahead', 'extra', 'new-amount']
    return {
      kind: 'over',
      month,
      excessPaise: amount - owedPaise,
      choices,
      default: cost.category === 'salary' || cost.category === 'rent' ? 'ahead' : 'extra',
    }
  }
  const after = coverage(withPending(cost, amount, today), month, today)
  const short = after.months.find((row) => row.coveredPaise < row.costPaise)
  // A month this payment did not reach is not this payment's to cut.
  if (!short || short.coveredPaise === 0) return { kind: 'none' }
  return {
    kind: 'short',
    month: short.month,
    restPaise: short.costPaise - short.coveredPaise,
    settledAtPaise: short.coveredPaise,
    choices: isProrated(cost, short.month) ? ['settle'] : ['settle', 'cut'],
  }
}

/** What a choice records beside the payment: a settlement, a new amount, both or neither. */
export interface PayEffect {
  settlement: { month: string; amountPaise: number } | null
  amount: { fromMonth: string; amountPaise: number } | null
}

export function payEffect(
  cost: FixedCostFacts,
  prompt: PayPrompt,
  choice: PayChoiceKey | null,
  // Kept for the callers' shape: the prompt already carries what the payment covered.
  _amount?: number,
  _today?: string,
): PayEffect {
  const none: PayEffect = { settlement: null, amount: null }
  if (prompt.kind === 'none' || choice === null || choice === 'ahead') return none
  if (prompt.kind === 'short') {
    if (!prompt.choices.includes(choice)) throw new Error(`${choice} is not offered here`)
    const settlement = { month: prompt.month, amountPaise: prompt.settledAtPaise }
    return {
      settlement,
      amount:
        choice === 'cut'
          ? { fromMonth: addMonths(prompt.month, 1), amountPaise: prompt.settledAtPaise }
          : null,
    }
  }
  if (!prompt.choices.includes(choice)) throw new Error(`${choice} is not offered here`)
  const settledAt = monthCost(cost, prompt.month) + prompt.excessPaise
  return {
    settlement: { month: prompt.month, amountPaise: settledAt },
    amount:
      choice === 'new-amount'
        ? { fromMonth: addMonths(prompt.month, 1), amountPaise: settledAt }
        : null,
  }
}

/**
 * Which month's figures a payment shows in, by default: an earlier month when
 * the payment is late pay for it (not cash, and no more than it owes), so that
 * month's P&L carries its own salary; otherwise the day paid. Cash always shows
 * on the day it left the drawer. It changes nothing the sheet asks.
 */
export function showsInDefault(
  cost: FixedCostFacts,
  amount: number,
  paidOn: string,
  isCash: boolean,
): string {
  if (isCash) return paidOn
  const owed = payOwed(cost, paidOn)
  const latest = owed.overdueMonths.at(-1)
  return latest && amount > 0 && amount <= owed.overduePaise ? lastDayOf(latest) : paidOn
}

/** Whether "Shows in" is a question at all: something earlier is owed, and it is not cash. */
export function showsInApplies(cost: FixedCostFacts, paidOn: string, isCash: boolean): boolean {
  return !isCash && payOwed(cost, paidOn).overduePaise > 0
}

/**
 * What undoing a payment takes back (owner, 2026-10-19): the months its answer
 * settled and the monthly amount it set. The expense itself is withdrawn by the
 * adapter; this is what the confirmation says beside it.
 */
export interface PaymentUndo {
  settledMonths: string[]
  /** A permanent change it made, and the amount that applies again without it. */
  amount: { fromMonth: string; nowPaise: number; restoredPaise: number } | null
}

export function paymentUndo(cost: FixedCostFacts, paymentId: string): PaymentUndo {
  const settledMonths = cost.settlements
    .filter((row) => row.paymentId === paymentId && !row.voidedAt)
    .map((row) => row.month)
  const set = cost.amounts.find((row) => row.paymentId === paymentId && !row.voidedAt)
  return {
    settledMonths,
    amount: set
      ? {
          fromMonth: set.fromMonth,
          nowPaise: set.amountPaise,
          restoredPaise: amountFor(
            cost.amounts.filter((row) => row !== set),
            set.fromMonth,
          ),
        }
      : null,
  }
}

// ── Pro-rata P&L (D6) ─────────────────────────────────────────────────────

export interface ProRataLine {
  id: string
  name: string
  category: FixedCostCategory
  /** This month's cost, in full. */
  costPaise: number
  /** The share of it owed through today. */
  spreadPaise: number
  /** What payments have covered of this month. */
  coveredPaise: number
  /** Owed so far and not paid: what Pro-rata P&L charges. */
  unpaidPaise: number
  /** This month's cost not yet covered. */
  stillToPayPaise: number
}

export interface ProRataReading {
  month: string
  /** Days of the month through today, and the days in it. */
  daysSoFar: number
  daysInMonth: number
  lines: ProRataLine[]
  monthPaise: number
  unpaidPaise: number
  stillToPayPaise: number
}

/** The current month's fixed costs read at `today`, the outlet's business date. */
export function readProRata(costs: readonly FixedCostFacts[], today: string): ProRataReading {
  const month = monthOf(today)
  const lines: ProRataLine[] = []
  for (const cost of costs) {
    const active = activeDays(cost, month)
    if (active.count === 0) continue
    const costPaise = monthCost(cost, month)
    const elapsed = daysBetween(active.first, minDate(today, active.last))
    const spreadPaise = Math.floor((costPaise * elapsed) / active.count)
    const coveredPaise = coverage(cost, month, today).months.at(-1)?.coveredPaise ?? 0
    lines.push({
      id: cost.id,
      name: cost.name,
      category: cost.category,
      costPaise,
      spreadPaise,
      coveredPaise,
      unpaidPaise: Math.max(0, spreadPaise - coveredPaise),
      stillToPayPaise: Math.max(0, costPaise - coveredPaise),
    })
  }
  const sum = (key: keyof Pick<ProRataLine, 'costPaise' | 'unpaidPaise' | 'stillToPayPaise'>) =>
    lines.reduce((total, line) => total + line[key], 0)
  return {
    month,
    daysSoFar: Number(today.slice(8, 10)),
    daysInMonth: daysInMonth(month),
    lines,
    monthPaise: sum('costPaise'),
    unpaidPaise: sum('unpaidPaise'),
    stillToPayPaise: sum('stillToPayPaise'),
  }
}

/**
 * What this month's fixed costs come to per day (owner, 2026-10-21): each one's
 * cost this month over the days it runs, for those running on `today`, the way
 * Pro-rata P&L spreads them. What has been paid does not change it: it is the
 * cost of a day, not what is still owed. Each share rounded down to the paisa.
 */
export function dailySpreadPaise(costs: readonly FixedCostFacts[], today: string): number {
  const month = monthOf(today)
  let total = 0
  for (const cost of costs) {
    const active = activeDays(cost, month)
    if (active.count === 0 || today < active.first || today > active.last) continue
    total += Math.floor(monthCost(cost, month) / active.count)
  }
  return total
}

/** Pro-rata P&L: P&L less the unpaid share of this month's fixed costs. */
export function proRataPnl(pnlPaise: number, reading: ProRataReading): number {
  return assertPaise(pnlPaise) - reading.unpaidPaise
}

/**
 * How much of the month's fixed costs is covered so far, in whole percent,
 * between 0 and 100: P&L plus what payments have covered of this month, over
 * the month's fixed costs in full. It reaches 100 exactly when
 * `aheadOfCoveringPaise` reaches zero.
 */
export function coveredPercent(pnlPaise: number, reading: ProRataReading): number {
  if (reading.monthPaise <= 0) return 100
  const covered = assertPaise(pnlPaise) + reading.monthPaise - reading.stillToPayPaise
  return Math.min(100, Math.max(0, Math.floor((covered * 100) / reading.monthPaise)))
}

/**
 * P&L with every fixed cost of this month charged in full: P&L less what is
 * still to pay of them. Below zero the month is **Short** of covering its fixed
 * costs by that much, from zero up it is **Ahead** (owner, 2026-10-21).
 * Pro-rata P&L answers "are we making money at this pace"; this answers "how
 * far are we from covering the month". An advance paid last month covers this
 * month and was charged to last month, so it is not charged again.
 */
export function aheadOfCoveringPaise(pnlPaise: number, reading: ProRataReading): number {
  return assertPaise(pnlPaise) - reading.stillToPayPaise
}

/** *Nayan (Salary)*, or *Rent* where the name and the category are one word. */
export function fixedCostLabel(name: string, category: FixedCostCategory): string {
  const word = FIXED_COST_CATEGORY_LABEL[category]
  return name.trim().toLowerCase() === word.toLowerCase() ? name.trim() : `${name.trim()} (${word})`
}
