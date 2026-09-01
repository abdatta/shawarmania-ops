import {
  DELIVERY_CHANNELS,
  nextOpeningPaise,
  readMonth,
  resolveBusinessDate,
  shiftBusinessDate,
  type MonthDayInput,
} from '@/domain'

import {
  LedgerStatementActionError,
  toMonthDayInput,
  type LedgerDrawerEvent,
  type LedgerStatementAdapter,
  type LedgerStatementDay,
} from '../adapters'
import type { Tables } from '../database.types'

import { cashExpensesIn, effectiveExpenses } from './effective-expenses'
import { accountFixtures } from './fixtures/accounts'
import type { DemoStore } from './store'

/**
 * The ledger as a statement that writes itself, in demo mode.
 *
 * **Nothing here is stored, and that is the requirement rather than an
 * implementation detail.** No table holds a per-outlet-per-day ledger row, so
 * two properties follow and both are worth the read cost: the reading can never
 * disagree with itself, and a business date nobody touched still renders in full
 * rather than as an empty state.
 *
 * Three things this file has to get right, each of which the old day-close model
 * got wrong:
 *
 *   * **The drawer section is ordered by INSTANT, not grouped by category.** An
 *     expense at 18:10 sits above the 22:00 count and one at 23:00 sits below
 *     it. That ordering is what makes a collection legible; grouping by category
 *     would put both expenses together and leave the reader unable to tell which
 *     side of the count either fell on.
 *
 *   * **The float left and the closing balance are different figures with
 *     different names.** The retired word "Kept" conflated them. On the worked
 *     example they are ₹1,450 and ₹3,504, and the reading says plainly that the
 *     float left is not the next day's opening.
 *
 *   * **A day with no observation is `carried`, and a date before the outlet's
 *     anchor is `not tracked yet`.** Two different claims: `carried` means the
 *     app's belief, unchecked; before the anchor there is no belief to leave
 *     unchecked (design D18).
 */

const CUTOVER = '04:00'

function nameOf(profileId: string | null): string | null {
  if (!profileId) return null
  return accountFixtures.find((account) => account.id === profileId)?.full_name ?? null
}

/** The instant a business date opens at, and the one the next opens at. */
function dayBounds(businessDate: string): { from: string; to: string } {
  return {
    from: new Date(`${businessDate}T${CUTOVER}:00+05:30`).toISOString(),
    to: new Date(`${shiftBusinessDate(businessDate, 1)}T${CUTOVER}:00+05:30`).toISOString(),
  }
}

function observationsAt(store: DemoStore, outletId: string): Tables<'drawer_observations'>[] {
  return store.drawerObservations
    .filter((row) => row.outlet_id === outletId)
    .sort((a, b) => a.counted_at.localeCompare(b.counted_at))
}

function ownCashOutTotal(store: DemoStore, observationId: string): number {
  return store.drawerCashOut
    .filter((movement) => movement.observation_id === observationId)
    .reduce((sum, movement) => sum + movement.amount_paise, 0)
}

/**
 * The drawer balance at an instant, walked forward from the anchor.
 *
 * Walked rather than read from a stored figure because a business date has no
 * drawer row of its own — that is the whole point. Every observation re-anchors
 * the balance to physical cash, so the walk resets at each one rather than
 * accumulating an error.
 */
function balanceAt(store: DemoStore, outletId: string, instant: string): number | null {
  const observations = observationsAt(store, outletId)
  const anchor = observations[0]
  if (!anchor || instant < anchor.counted_at) return null

  // The last observation at or before this instant is the anchor for the walk.
  const previous = [...observations].reverse().find((row) => row.counted_at <= instant)
  if (!previous) return null

  let balance = nextOpeningPaise(previous.counted_total_paise, ownCashOutTotal(store, previous.id))

  for (const bill of store.bills) {
    if (bill.outlet_id !== outletId || bill.status !== 'settled') continue
    const paidAt = bill.paid_at ?? bill.created_at
    if (paidAt <= previous.counted_at || paidAt > instant) continue
    const allocations = store.billPayments.get(bill.id) ?? []
    balance += allocations
      .filter((allocation) => allocation.method === 'cash')
      .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
  }

  // Both expense sources, as `public.effective_expenses` reads them. Reading
  // `store.expenses` alone was this mock's copy of the production defect.
  for (const expense of cashExpensesIn(store, outletId, previous.counted_at, instant)) {
    balance -= expense.amountPaise
  }

  for (const movement of store.drawerCashOut) {
    if (movement.outlet_id !== outletId) continue
    if (movement.observation_id === previous.id) continue
    if (movement.occurred_at <= previous.counted_at || movement.occurred_at > instant) continue
    balance -= movement.amount_paise
  }

  return balance
}

export function createMockLedgerStatementAdapter(
  store: DemoStore,
  verifiedBy: string,
): LedgerStatementAdapter {
  let nextId = 700

  function dayFor(outletId: string, businessDate: string): LedgerStatementDay {
    const { from, to } = dayBounds(businessDate)

    // ── Revenue, from the counter's own allocations ────────────────────────
    let cashPaise = 0
    let cashBills = 0
    let upiPaise = 0
    let upiBills = 0

    for (const bill of store.bills) {
      if (bill.outlet_id !== outletId || bill.status !== 'settled') continue
      if (bill.business_date !== businessDate) continue
      const allocations = store.billPayments.get(bill.id) ?? []
      const cash = allocations
        .filter((allocation) => allocation.method === 'cash')
        .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
      const upi = allocations
        .filter((allocation) => allocation.method === 'upi')
        .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
      if (cash > 0) {
        cashPaise += cash
        cashBills += 1
      }
      if (upi > 0) {
        upiPaise += upi
        upiBills += 1
      }
    }

    const channels = store.aggregatorChannelDays
      .filter((row) => row.outlet_id === outletId && row.business_date === businessDate)
      .map((row) => ({
        channel: row.channel,
        grossPaise: row.revenue_paise,
        // Null means NOT KNOWN YET and must never render as nought. A commission
        // nobody has stated is not a commission of zero, and the month is a
        // ceiling while any day is in that state.
        commissionPaise: row.commission_paise,
        // **Net is null whenever commission is**, which is the notebook's own
        // rule. `net_paise` is preferred only once the commission is known: a
        // provisional row can carry a net the sync computed while the charge is
        // still unstated, and rendering that beside "Less commission — Not known
        // yet" invites the reader to subtract the two and discover the commission
        // the page has just said nobody knows.
        netPaise:
          row.commission_paise === null
            ? null
            : (row.net_paise ?? row.revenue_paise - row.commission_paise),
        settlementState: row.settlement_state,
        // `as_of_at` is null on every production row; `updated_at` moves on each
        // run that re-read the day. Same rule as `toZomatoSettlement`.
        asOfAt: row.as_of_at ?? row.updated_at,
      }))

    const isCeiling = channels.some((channel) => channel.commissionPaise === null)
    const totalPaise =
      cashPaise +
      upiPaise +
      channels.reduce((sum, channel) => sum + (channel.netPaise ?? channel.grossPaise), 0)

    // ── Expenses ───────────────────────────────────────────────────────────
    const expenseRows = effectiveExpenses(store)
      .filter((row) => row.outletId === outletId && row.businessDate === businessDate)
      .map((row) => ({
        id: row.id,
        label: row.description ?? row.category,
        // Carried separately: `label` prefers the description, so grouping the
        // month by category is impossible from `label` alone (#52 design D6).
        category: row.category,
        paise: row.amountPaise,
        isCash: row.isCash,
        instant: row.instant,
        recordedByName: nameOf(row.recordedBy),
      }))
      .sort((a, b) => a.instant.localeCompare(b.instant))

    // ── The drawer, ordered by instant ─────────────────────────────────────
    const observations = observationsAt(store, outletId)
    const anchor = observations[0] ?? null
    const inThisDay = observations.filter((row) => row.counted_at >= from && row.counted_at < to)

    const timeline: LedgerDrawerEvent[] = []

    if (cashPaise > 0) {
      // Cash sales as one line rather than one per bill: the drawer question is
      // how much arrived, and fifty rows of ₹180 answers it worse.
      timeline.push({ kind: 'cash-sales', instant: from, paise: cashPaise, bills: cashBills })
    }

    for (const expense of expenseRows) {
      if (!expense.isCash) continue
      timeline.push({
        kind: 'cash-expense',
        instant: expense.instant,
        paise: expense.paise,
        label: expense.label,
      })
    }

    for (const movement of store.drawerCashOut) {
      if (movement.outlet_id !== outletId) continue
      if (movement.occurred_at < from || movement.occurred_at >= to) continue
      // A movement belonging to an observation is rendered inside its block
      // rather than as a line of its own.
      if (movement.observation_id) continue
      timeline.push({
        kind: 'cash-out',
        instant: movement.occurred_at,
        paise: movement.amount_paise,
        label: movement.reason ?? (movement.kind === 'spend' ? 'Cash spend' : 'Collected'),
        spend: movement.kind === 'spend',
      })
    }

    for (const row of inThisDay) {
      const index = observations.findIndex((other) => other.id === row.id)
      const previous = observations[index - 1] ?? null
      let openingBreakPaise: number | null = null
      if (!row.is_anchor && previous && row.opening_paise !== null) {
        const carried = nextOpeningPaise(
          previous.counted_total_paise,
          ownCashOutTotal(store, previous.id),
        )
        if (carried !== row.opening_paise) openingBreakPaise = row.opening_paise - carried
      }

      timeline.push({
        kind: 'observation',
        instant: row.counted_at,
        observation: {
          id: row.id,
          outletId: row.outlet_id,
          countedAt: row.counted_at,
          recordedAt: row.recorded_at,
          isAnchor: row.is_anchor,
          openingPaise: row.opening_paise,
          expectedPaise: row.expected_paise,
          differencePaise: row.difference_paise,
          countedTotalPaise: row.counted_total_paise,
          isLegacyImprecise: row.is_legacy_imprecise,
          isApproximate: row.is_approximate,
          toleranceMinutes: row.tolerance_minutes,
          recordedBy: row.recorded_by,
          recordedByName: nameOf(row.recorded_by),
          correctedBy: row.corrected_by,
          correctedByName: nameOf(row.corrected_by),
          onSite: row.recorded_on_site,
          awayReason: row.away_reason,
          note: row.note,
          ownCashOut: store.drawerCashOut
            .filter((movement) => movement.observation_id === row.id)
            .map((movement) => ({
              id: movement.id,
              outletId: movement.outlet_id,
              kind: movement.kind === 'spend' ? ('spend' as const) : ('collection' as const),
              amountPaise: movement.amount_paise,
              occurredAt: movement.occurred_at,
              recordedBy: movement.recorded_by,
              recordedByName: nameOf(movement.recorded_by),
              observationId: movement.observation_id,
              reason: movement.reason,
              onSite: movement.recorded_on_site,
              awayReason: movement.away_reason,
            })),
          adjustments: store.drawerObservationAdjustments
            .filter((adjustment) => adjustment.observation_id === row.id)
            .map((adjustment) => ({
              id: adjustment.id,
              observationId: adjustment.observation_id,
              originalCountedTotalPaise: adjustment.original_counted_total_paise,
              correctedCountedTotalPaise: adjustment.corrected_counted_total_paise,
              reason: adjustment.reason,
              adjustedBy: adjustment.adjusted_by,
              adjustedByName: nameOf(adjustment.adjusted_by),
              adjustedAt: adjustment.adjusted_at,
            })),
          openingBreakPaise,
        },
      })
    }

    timeline.sort((a, b) => a.instant.localeCompare(b.instant))

    // How many business dates the observation covering this date spans. Stated
    // rather than implied, because a long interval blurs attribution and the
    // surface should not suggest precision it does not have.
    let observationCoversDays: number | null = null
    const covering = inThisDay[0]
    if (covering && !covering.is_anchor) {
      const index = observations.findIndex((other) => other.id === covering.id)
      const previous = observations[index - 1]
      if (previous) {
        const fromDate = resolveBusinessDate(new Date(previous.counted_at), CUTOVER)
        const toDate = resolveBusinessDate(new Date(covering.counted_at), CUTOVER)
        observationCoversDays =
          Math.round(
            (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
          ) + 1
      }
    }

    const beforeAnchor = anchor === null || to <= anchor.counted_at
    const state: 'counted' | 'carried' | 'not-tracked-yet' = beforeAnchor
      ? 'not-tracked-yet'
      : inThisDay.length > 0
        ? 'counted'
        : 'carried'

    const lastConfirmed = [...observations].reverse().find((row) => row.counted_at < to) ?? null

    const verifications = store.ledgerDayVerifications
      .filter((row) => row.outlet_id === outletId && row.business_date === businessDate)
      .map((row) => ({
        id: row.id,
        verifiedByName: nameOf(row.verified_by),
        verifiedAt: row.verified_at,
        note: row.note,
      }))

    // A figure moved after somebody verified the day. Names what moved, blocks
    // nothing: aggregator settlement legitimately restates a day afterwards, and
    // a verification that forbade it would be one nobody could use.
    const changedSinceVerified: string[] = []
    if (verifications.length > 0) {
      const earliest = verifications
        .map((entry) => entry.verifiedAt)
        .sort((a, b) => a.localeCompare(b))[0]
      if (earliest) {
        for (const row of inThisDay) {
          if (row.updated_at > earliest) changedSinceVerified.push('the drawer count')
        }
        for (const channel of channels) {
          if (channel.settlementState === 'settled') {
            changedSinceVerified.push(`${channel.channel} settlement`)
          }
        }
      }
    }

    return {
      outletId,
      businessDate,
      revenue: { cashPaise, cashBills, upiPaise, upiBills, channels, totalPaise, isCeiling },
      drawer: {
        state,
        openingPaise: beforeAnchor ? null : balanceAt(store, outletId, from),
        closingPaise: beforeAnchor ? null : balanceAt(store, outletId, to),
        lastConfirmedAt: lastConfirmed?.counted_at ?? null,
        observationCoversDays,
        timeline,
      },
      expenses: {
        totalPaise: expenseRows.reduce((sum, row) => sum + row.paise, 0),
        rows: expenseRows.sort((a, b) => a.instant.localeCompare(b.instant)),
      },
      verifications,
      changedSinceVerified: [...new Set(changedSinceVerified)],
    }
  }

  return {
    async getDay(outletId, businessDate) {
      return dayFor(outletId, businessDate)
    },

    async getMonth(outletId, month) {
      const [year, monthNumber] = month.split('-').map(Number)
      if (!year || !monthNumber) {
        throw new LedgerStatementActionError('bad_month', 'That is not a month this reads.')
      }
      const daysInMonth = new Date(year, monthNumber, 0).getDate()

      // The same day readings the real adapter folds, folded by the same
      // function — see `readMonth`. Nothing is read here that `dayFor` was not
      // already building (#52).
      const days: MonthDayInput[] = []
      for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
        const businessDate = `${month}-${String(dayNumber).padStart(2, '0')}`
        days.push(toMonthDayInput(dayFor(outletId, businessDate)))
      }

      return {
        outletId,
        month,
        // Bounded by what has actually happened — see `readMonth`.
        reading: readMonth(days, {
          throughBusinessDate: resolveBusinessDate(new Date(), CUTOVER),
          // Both channels, because both demo outlets trade on both. The real
          // adapter reads `outlet_channel_restaurants` instead, because a real
          // outlet may not sell on a channel at all — Kanchrapara does not sell
          // on Swiggy — and the demo store does not model that mapping.
          expectedChannels: DELIVERY_CHANNELS,
        }),
        // Deliberately outside the month's operating figure, and reported here so
        // a ₹40,000 fridge is findable without remembering the date (open
        // question 2).
        spends: store.drawerCashOut
          .filter(
            (movement) =>
              movement.outlet_id === outletId &&
              movement.kind === 'spend' &&
              movement.occurred_at.startsWith(month),
          )
          .map((movement) => ({
            id: movement.id,
            outletId: movement.outlet_id,
            kind: 'spend' as const,
            amountPaise: movement.amount_paise,
            occurredAt: movement.occurred_at,
            recordedBy: movement.recorded_by,
            recordedByName: nameOf(movement.recorded_by),
            observationId: movement.observation_id,
            reason: movement.reason,
            onSite: movement.recorded_on_site,
            awayReason: movement.away_reason,
          })),
      }
    },

    async verifyDay(outletId, businessDate, note) {
      const already = store.ledgerDayVerifications.some(
        (row) =>
          row.outlet_id === outletId &&
          row.business_date === businessDate &&
          row.verified_by === verifiedBy,
      )
      if (already) {
        throw new LedgerStatementActionError(
          'already_verified',
          'You have already verified this day. A second acknowledgement replaces nothing.',
        )
      }

      store.ledgerDayVerifications.push({
        id: `df000000-0000-4000-c000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: outletId,
        business_date: businessDate,
        verified_by: verifiedBy,
        verified_at: new Date().toISOString(),
        note: note?.trim() || null,
      })
      // Freezes nothing. The day computes and renders identically afterwards.
    },
  }
}
