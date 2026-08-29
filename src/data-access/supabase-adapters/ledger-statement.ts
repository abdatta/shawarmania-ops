import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { nextOpeningPaise, resolveBusinessDate, shiftBusinessDate } from '@/domain'

import {
  LedgerStatementActionError,
  type LedgerDrawerEvent,
  type LedgerStatementAdapter,
  type LedgerStatementDay,
  type LedgerStatementMonthDay,
} from '../adapters'
import type { Database, Tables } from '../database.types'

/**
 * The real ledger statement (#11) — **a reading, with nothing to write into it**.
 *
 * No table stores a per-outlet-per-day ledger row, so every figure here is
 * assembled on read from five sources: bills and their effective allocations,
 * expenses, sourced aggregator channel days, drawer cash out, and drawer
 * observations. Two properties follow and both are worth the read cost — the
 * reading can never disagree with itself, and a date nobody touched still
 * renders in full.
 *
 * The one thing this file must never gain is a write path for a figure. A figure
 * judged wrong is corrected at its source: a void and re-ring for a bill, a
 * withdrawal and re-entry for an expense, an adjustment for an observation.
 * `verifyDay` is the only write, and it is an acknowledgement that freezes
 * nothing.
 */

type Client = SupabaseClient<Database>

const CUTOVER = '04:00'

function refuse(error: PostgrestError | Error): never {
  const message = 'message' in error ? error.message : String(error)
  if (/already verified/i.test(message)) {
    throw new LedgerStatementActionError('already_verified', message)
  }
  if (/may not verify/i.test(message)) {
    throw new LedgerStatementActionError('refused', message)
  }
  throw new LedgerStatementActionError('failed', message)
}

function dayBounds(businessDate: string): { from: string; to: string } {
  return {
    from: new Date(`${businessDate}T${CUTOVER}:00+05:30`).toISOString(),
    to: new Date(`${shiftBusinessDate(businessDate, 1)}T${CUTOVER}:00+05:30`).toISOString(),
  }
}

export function createSupabaseLedgerStatementAdapter(client: Client): LedgerStatementAdapter {
  async function namesFor(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
    if (wanted.length === 0) return new Map()
    const { data } = await client.from('profiles').select('id, full_name').in('id', wanted)
    return new Map((data ?? []).map((row) => [row.id, row.full_name]))
  }

  /**
   * The drawer balance at an instant, walked forward from the last observation
   * at or before it.
   *
   * Walked rather than stored, because a business date has no drawer row — that
   * is the point of the model. The walk resets at every observation, which is
   * decision 3 showing up as a property of the reader: an error cannot
   * accumulate across counts because each one re-anchors on physical cash.
   */
  async function balanceAt(outletId: string, instant: string): Promise<number | null> {
    const previousResult = await client
      .from('drawer_observations')
      .select('*')
      .eq('outlet_id', outletId)
      .lte('counted_at', instant)
      .order('counted_at', { ascending: false })
      .limit(1)
    if (previousResult.error) refuse(previousResult.error)
    const previous = previousResult.data?.[0]
    if (!previous) return null

    const ownResult = await client
      .from('drawer_cash_out')
      .select('amount_paise')
      .eq('observation_id', previous.id)
    const own = (ownResult.data ?? []).reduce((sum, row) => sum + row.amount_paise, 0)

    const [receipts, expenses, cashOut] = await Promise.all([
      client.rpc('drawer_cash_receipts_paise', {
        p_outlet_id: outletId,
        p_from: previous.counted_at,
        p_to: instant,
      }),
      client.rpc('drawer_cash_expenses_paise', {
        p_outlet_id: outletId,
        p_from: previous.counted_at,
        p_to: instant,
      }),
      client.rpc('drawer_cash_out_paise', {
        p_outlet_id: outletId,
        p_from: previous.counted_at,
        p_to: instant,
        p_exclude_observation: previous.id,
      }),
    ])

    return (
      nextOpeningPaise(previous.counted_total_paise, own) +
      Number(receipts.data ?? 0) -
      Number(expenses.data ?? 0) -
      Number(cashOut.data ?? 0)
    )
  }

  async function dayFor(outletId: string, businessDate: string): Promise<LedgerStatementDay> {
    const { from, to } = dayBounds(businessDate)

    const [
      billsResult,
      expensesResult,
      channelsResult,
      observationsResult,
      cashOutResult,
      anchorResult,
      verificationsResult,
    ] = await Promise.all([
      // No embed of `effective_bill_payments`: it is a VIEW with no declared
      // foreign key, so PostgREST refuses the nesting outright. The allocations
      // are read as their own select below and joined by bill id.
      client
        .from('bills')
        .select('id, bill_number, business_date, paid_at')
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
        .eq('status', 'settled'),
      client
        .from('expenses')
        .select('*')
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate),
      client
        .from('aggregator_channel_days')
        .select('*')
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate),
      client
        .from('drawer_observations')
        .select('*')
        .eq('outlet_id', outletId)
        .gte('counted_at', from)
        .lt('counted_at', to)
        .order('counted_at', { ascending: true }),
      client
        .from('drawer_cash_out')
        .select('*')
        .eq('outlet_id', outletId)
        .gte('occurred_at', from)
        .lt('occurred_at', to),
      client
        .from('drawer_observations')
        .select('counted_at')
        .eq('outlet_id', outletId)
        .eq('is_anchor', true)
        .limit(1),
      client
        .from('ledger_day_verifications')
        .select('*')
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate),
    ])

    if (billsResult.error) refuse(billsResult.error)
    if (expensesResult.error) refuse(expensesResult.error)

    const bills = billsResult.data ?? []

    // One select for every allocation on the day's bills, joined by id below.
    // See `cashByBill` for why this is not an embed.
    let cashPaise = 0
    let cashBills = 0
    let upiPaise = 0
    let upiBills = 0

    if (bills.length > 0) {
      const allocationsResult = await client
        .from('effective_bill_payments')
        .select('bill_id, method, amount_paise')
        .in(
          'bill_id',
          bills.map((bill) => bill.id),
        )
      if (allocationsResult.error) refuse(allocationsResult.error)

      const perBill = new Map<string, { cash: number; upi: number }>()
      for (const allocation of allocationsResult.data ?? []) {
        if (!allocation.bill_id) continue
        const entry = perBill.get(allocation.bill_id) ?? { cash: 0, upi: 0 }
        // Nullable on the view in the generated types, so coalesced.
        if (allocation.method === 'cash') entry.cash += allocation.amount_paise ?? 0
        if (allocation.method === 'upi') entry.upi += allocation.amount_paise ?? 0
        perBill.set(allocation.bill_id, entry)
      }

      for (const entry of perBill.values()) {
        if (entry.cash > 0) {
          cashPaise += entry.cash
          cashBills += 1
        }
        if (entry.upi > 0) {
          upiPaise += entry.upi
          upiBills += 1
        }
      }
    }

    const channels = (channelsResult.data ?? []).map((row) => ({
      channel: row.channel,
      grossPaise: row.revenue_paise,
      // Null is NOT KNOWN YET, and must never render as nought.
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
    }))
    const isCeiling = channels.some((channel) => channel.commissionPaise === null)

    const expenseRowsRaw = expensesResult.data ?? []
    const names = await namesFor([
      ...expenseRowsRaw.map((row) => row.recorded_by),
      ...(observationsResult.data ?? []).map((row) => row.recorded_by),
      ...(observationsResult.data ?? []).map((row) => row.corrected_by),
      ...(cashOutResult.data ?? []).map((row) => row.recorded_by),
      ...(verificationsResult.data ?? []).map((row) => row.verified_by),
    ])

    const expenseRows = expenseRowsRaw
      .map((row) => ({
        id: row.id,
        label: row.description ?? row.category,
        paise: row.amount_paise,
        isCash: row.payment_method === 'cash',
        instant: row.occurred_at ?? row.created_at,
        recordedByName: names.get(row.recorded_by) ?? null,
      }))
      .sort((a, b) => a.instant.localeCompare(b.instant))

    // ── The drawer, ordered by instant rather than grouped by category ──────
    const observations = observationsResult.data ?? []
    const movements = cashOutResult.data ?? []
    const timeline: LedgerDrawerEvent[] = []

    if (cashPaise > 0) {
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
    for (const movement of movements) {
      // A movement belonging to an observation renders inside its block.
      if (movement.observation_id) continue
      timeline.push({
        kind: 'cash-out',
        instant: movement.occurred_at,
        paise: movement.amount_paise,
        label: movement.reason ?? (movement.kind === 'spend' ? 'Cash spend' : 'Collected'),
        spend: movement.kind === 'spend',
      })
    }

    const adjustmentsResult = await client
      .from('drawer_observation_adjustments')
      .select('*')
      .in(
        'observation_id',
        observations.length > 0
          ? observations.map((row) => row.id)
          : ['00000000-0000-0000-0000-000000000000'],
      )

    const toObservationRecord = (row: Tables<'drawer_observations'>) => ({
      id: row.id,
      outletId: row.outlet_id,
      countedAt: row.counted_at,
      recordedAt: row.recorded_at,
      isAnchor: row.is_anchor,
      openingPaise: row.opening_paise,
      expectedPaise: row.expected_paise,
      differencePaise: row.difference_paise,
      countedTotalPaise: row.counted_total_paise,
      isApproximate: row.is_approximate,
      toleranceMinutes: row.tolerance_minutes,
      recordedBy: row.recorded_by,
      recordedByName: names.get(row.recorded_by) ?? null,
      correctedBy: row.corrected_by,
      correctedByName: row.corrected_by ? (names.get(row.corrected_by) ?? null) : null,
      onSite: row.recorded_on_site,
      awayReason: row.away_reason,
      note: row.note,
      ownCashOut: movements
        .filter((movement) => movement.observation_id === row.id)
        .map((movement) => ({
          id: movement.id,
          outletId: movement.outlet_id,
          kind: movement.kind === 'spend' ? ('spend' as const) : ('collection' as const),
          amountPaise: movement.amount_paise,
          occurredAt: movement.occurred_at,
          recordedBy: movement.recorded_by,
          recordedByName: names.get(movement.recorded_by) ?? null,
          observationId: movement.observation_id,
          reason: movement.reason,
          onSite: movement.recorded_on_site,
          awayReason: movement.away_reason,
        })),
      adjustments: (adjustmentsResult.data ?? [])
        .filter((adjustment) => adjustment.observation_id === row.id)
        .map((adjustment) => ({
          id: adjustment.id,
          observationId: adjustment.observation_id,
          originalCountedTotalPaise: adjustment.original_counted_total_paise,
          correctedCountedTotalPaise: adjustment.corrected_counted_total_paise,
          reason: adjustment.reason,
          adjustedBy: adjustment.adjusted_by,
          adjustedByName: names.get(adjustment.adjusted_by) ?? null,
          adjustedAt: adjustment.adjusted_at,
        })),
      openingBreakPaise: null,
    })

    for (const row of observations) {
      timeline.push({
        kind: 'observation',
        instant: row.counted_at,
        observation: toObservationRecord(row),
      })
    }
    timeline.sort((a, b) => a.instant.localeCompare(b.instant))

    const anchorAt = anchorResult.data?.[0]?.counted_at ?? null
    const beforeAnchor = anchorAt === null || to <= anchorAt

    const lastConfirmedResult = beforeAnchor
      ? null
      : await client
          .from('drawer_observations')
          .select('counted_at')
          .eq('outlet_id', outletId)
          .lt('counted_at', to)
          .order('counted_at', { ascending: false })
          .limit(1)

    let observationCoversDays: number | null = null
    const covering = observations[0]
    if (covering && !covering.is_anchor) {
      const previousResult = await client
        .from('drawer_observations')
        .select('counted_at')
        .eq('outlet_id', outletId)
        .lt('counted_at', covering.counted_at)
        .order('counted_at', { ascending: false })
        .limit(1)
      const previous = previousResult.data?.[0]
      if (previous) {
        const fromDate = resolveBusinessDate(new Date(previous.counted_at), CUTOVER)
        const toDate = resolveBusinessDate(new Date(covering.counted_at), CUTOVER)
        observationCoversDays =
          Math.round(
            (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
          ) + 1
      }
    }

    const verifications = (verificationsResult.data ?? []).map((row) => ({
      id: row.id,
      verifiedByName: names.get(row.verified_by) ?? null,
      verifiedAt: row.verified_at,
      note: row.note,
    }))

    // A figure moved after somebody verified. Named, and blocking nothing:
    // settlement legitimately restates a day, and a verification that forbade
    // that would be one nobody could use.
    const changedSinceVerified: string[] = []
    if (verifications.length > 0) {
      const earliest = verifications
        .map((entry) => entry.verifiedAt)
        .sort((a, b) => a.localeCompare(b))[0]
      if (earliest) {
        for (const row of observations) {
          if (row.updated_at > earliest) changedSinceVerified.push('the drawer count')
        }
        for (const row of channelsResult.data ?? []) {
          if (row.revised_at && row.revised_at > earliest) {
            changedSinceVerified.push(`${row.channel} was restated`)
          }
        }
      }
    }

    return {
      outletId,
      businessDate,
      revenue: {
        cashPaise,
        cashBills,
        upiPaise,
        upiBills,
        channels,
        totalPaise:
          cashPaise +
          upiPaise +
          channels.reduce((sum, channel) => sum + (channel.netPaise ?? channel.grossPaise), 0),
        isCeiling,
      },
      drawer: {
        state: beforeAnchor ? 'not-tracked-yet' : observations.length > 0 ? 'counted' : 'carried',
        openingPaise: beforeAnchor ? null : await balanceAt(outletId, from),
        closingPaise: beforeAnchor ? null : await balanceAt(outletId, to),
        lastConfirmedAt: lastConfirmedResult?.data?.[0]?.counted_at ?? null,
        observationCoversDays,
        timeline,
      },
      expenses: {
        totalPaise: expenseRows.reduce((sum, row) => sum + row.paise, 0),
        rows: expenseRows,
      },
      verifications,
      changedSinceVerified: [...new Set(changedSinceVerified)],
    }
  }

  return {
    getDay: dayFor,

    async getMonth(outletId, month) {
      const [year, monthNumber] = month.split('-').map(Number)
      if (!year || !monthNumber) {
        throw new LedgerStatementActionError('bad_month', 'That is not a month this reads.')
      }
      const daysInMonth = new Date(year, monthNumber, 0).getDate()
      const dates = Array.from(
        { length: daysInMonth },
        (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
      )

      // Thirty-one reads in parallel rather than in series. Open question 3 asks
      // whether the derived month holds at this scale; the answer is measured
      // against a real August in `docs/TESTING.md`, and the remedy if it does not
      // is a materialised read model — never a stored day row that can disagree
      // with its sources.
      const days: LedgerStatementMonthDay[] = await Promise.all(
        dates.map(async (businessDate) => {
          const day = await dayFor(outletId, businessDate)
          const observation = day.drawer.timeline.find((event) => event.kind === 'observation')
          return {
            businessDate,
            openingPaise: day.drawer.openingPaise,
            closingPaise: day.drawer.closingPaise,
            state: day.drawer.state,
            countedAt:
              observation?.kind === 'observation' ? observation.observation.countedAt : null,
            differencePaise:
              observation?.kind === 'observation' ? observation.observation.differencePaise : null,
            observationCoversDays: day.drawer.observationCoversDays,
          }
        }),
      )

      const spendsResult = await client
        .from('drawer_cash_out')
        .select('*')
        .eq('outlet_id', outletId)
        .eq('kind', 'spend')
        .gte('occurred_at', dayBounds(`${month}-01`).from)
        .lt('occurred_at', dayBounds(`${month}-${String(daysInMonth).padStart(2, '0')}`).to)
      const spendNames = await namesFor((spendsResult.data ?? []).map((row) => row.recorded_by))

      return {
        outletId,
        month,
        days,
        spends: (spendsResult.data ?? []).map((row) => ({
          id: row.id,
          outletId: row.outlet_id,
          kind: 'spend' as const,
          amountPaise: row.amount_paise,
          occurredAt: row.occurred_at,
          recordedBy: row.recorded_by,
          recordedByName: spendNames.get(row.recorded_by) ?? null,
          observationId: row.observation_id,
          reason: row.reason,
          onSite: row.recorded_on_site,
          awayReason: row.away_reason,
        })),
      }
    },

    async verifyDay(outletId, businessDate, note) {
      const { error } = await client.rpc('verify_ledger_day', {
        p_outlet_id: outletId,
        p_business_date: businessDate,
        ...(note ? { p_note: note } : {}),
      })
      if (error) refuse(error)
    },
  }
}
