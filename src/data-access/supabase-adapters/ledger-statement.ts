import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  DELIVERY_CHANNELS,
  readMonth,
  resolveBusinessDate,
  shiftBusinessDate,
  type MonthDayInput,
} from '@/domain'

import {
  LedgerReadAborted,
  LedgerStatementActionError,
  type LedgerDrawerEvent,
  type LedgerReadOptions,
  type LedgerStatementAdapter,
  type LedgerStatementDay,
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
 * **The read cost is paid in round trips, so round trips are what this file
 * counts** (`the-ledger-reads-fast-and-keeps-its-place`). Measured on production
 * on 2026-09-24, every request from a phone costs about 300 ms whatever it asks.
 * A day used to make thirteen of them one after another and a month about six
 * hundred; a day now makes two waves and a month one server read plus one. The
 * figures did not move — the same rows reach the same code — only when each
 * request starts.
 *
 * **A reading completes or it throws.** Every read feeds a figure, a section or
 * a word, and a read whose error was ignored used to render as nought: a channel
 * vanished, a counted day read carried. So every `{ error }` below is thrown, and
 * the one deliberate empty result that remains — a manager's channel mapping,
 * which RLS filters rather than refuses — is named where it is read.
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

/**
 * The rows of a read, or a throw.
 *
 * An abandoned read surfaces from supabase-js as an ordinary error object, so the
 * signal is consulted first: a read the reader walked away from is not a failure
 * and must never be reported as one.
 */
function rowsOf<T>(
  result: { data: T | null; error: PostgrestError | null },
  signal: AbortSignal | undefined,
): T | null {
  if (signal?.aborted) throw new LedgerReadAborted()
  if (result.error) refuse(result.error)
  return result.data
}

function dayBounds(businessDate: string): { from: string; to: string } {
  return {
    from: new Date(`${businessDate}T${CUTOVER}:00+05:30`).toISOString(),
    to: new Date(`${shiftBusinessDate(businessDate, 1)}T${CUTOVER}:00+05:30`).toISOString(),
  }
}

export function createSupabaseLedgerStatementAdapter(client: Client): LedgerStatementAdapter {
  /**
   * An abortable query. supabase-js builders take the signal one call at a
   * time, and a builder without it is a request nothing can cancel.
   */
  function abortable<Q extends { abortSignal(signal: AbortSignal): Q }>(
    query: Q,
    signal: AbortSignal | undefined,
  ): Q {
    return signal ? query.abortSignal(signal) : query
  }

  async function namesFor(
    ids: readonly (string | null)[],
    signal: AbortSignal | undefined,
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
    if (wanted.length === 0) return new Map()
    const rows = rowsOf(
      await abortable(client.from('profiles').select('id, full_name').in('id', wanted), signal),
      signal,
    )
    return new Map((rows ?? []).map((row) => [row.id, row.full_name]))
  }

  /**
   * The drawer balance at an instant, in one request.
   *
   * Walked rather than stored, because a business date has no drawer row — that
   * is the point of the model — and walked on the server, where the five reads
   * it takes cost one round trip instead of three. The arithmetic is
   * `ledger_drawer_balance_at`'s; null before the outlet's first observation.
   */
  async function balanceAt(
    outletId: string,
    instant: string,
    signal: AbortSignal | undefined,
  ): Promise<number | null> {
    const balance = rowsOf(
      await abortable(
        client.rpc('ledger_drawer_balance_at', { p_outlet_id: outletId, p_at: instant }),
        signal,
      ),
      signal,
    )
    return balance === null ? null : Number(balance)
  }

  async function dayFor(
    outletId: string,
    businessDate: string,
    { signal }: LedgerReadOptions = {},
  ): Promise<LedgerStatementDay> {
    const { from, to } = dayBounds(businessDate)

    // ── Wave 1: everything that depends on nothing ─────────────────────────
    //
    // Two of these replace reads that used to wait their turn. The count
    // "previous to the covering one" is the last before the day starts, because
    // the covering count is the day's first; and the balances and the last
    // confirmed instant run whether or not the date precedes the anchor, their
    // answers simply unused when it does.
    const [
      billsResult,
      expensesResult,
      channelsResult,
      observationsResult,
      cashOutResult,
      anchorResult,
      verificationsResult,
      beforeDayResult,
      lastConfirmedResult,
      openingPaise,
      closingPaise,
    ] = await Promise.all([
      // No embed of `effective_bill_payments`: it is a VIEW with no declared
      // foreign key, so PostgREST refuses the nesting outright. The allocations
      // are read as their own select below and joined by bill id.
      abortable(
        client
          .from('bills')
          .select('id, bill_number, business_date, paid_at, discount_paise')
          .eq('outlet_id', outletId)
          .eq('business_date', businessDate)
          .eq('status', 'settled'),
        signal,
      ),
      // `effective_expenses`: the un-voided rows of the one `expenses` table.
      abortable(
        client
          .from('effective_expenses')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('business_date', businessDate),
        signal,
      ),
      // Ordered by name so a day and its month list channels the same way.
      abortable(
        client
          .from('aggregator_channel_days')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('business_date', businessDate)
          .order('channel', { ascending: true }),
        signal,
      ),
      abortable(
        client
          .from('drawer_observations')
          .select('*')
          .eq('outlet_id', outletId)
          .gte('counted_at', from)
          .lt('counted_at', to)
          .order('counted_at', { ascending: true }),
        signal,
      ),
      abortable(
        client
          .from('drawer_cash_out')
          .select('*')
          .eq('outlet_id', outletId)
          .gte('occurred_at', from)
          .lt('occurred_at', to),
        signal,
      ),
      abortable(
        client
          .from('drawer_observations')
          .select('counted_at')
          .eq('outlet_id', outletId)
          .eq('is_anchor', true)
          .limit(1),
        signal,
      ),
      abortable(
        client
          .from('ledger_day_verifications')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('business_date', businessDate),
        signal,
      ),
      abortable(
        client
          .from('drawer_observations')
          .select('counted_at')
          .eq('outlet_id', outletId)
          .lt('counted_at', from)
          .order('counted_at', { ascending: false })
          .limit(1),
        signal,
      ),
      abortable(
        client
          .from('drawer_observations')
          .select('counted_at')
          .eq('outlet_id', outletId)
          .lt('counted_at', to)
          .order('counted_at', { ascending: false })
          .limit(1),
        signal,
      ),
      balanceAt(outletId, from, signal),
      balanceAt(outletId, to, signal),
    ])

    const bills = rowsOf(billsResult, signal) ?? []
    const expenseRowsRaw = rowsOf(expensesResult, signal) ?? []
    const channelRows = rowsOf(channelsResult, signal) ?? []
    const observations = rowsOf(observationsResult, signal) ?? []
    const movements = rowsOf(cashOutResult, signal) ?? []
    const anchorAt = rowsOf(anchorResult, signal)?.[0]?.counted_at ?? null
    const verificationRows = rowsOf(verificationsResult, signal) ?? []
    const beforeDay = rowsOf(beforeDayResult, signal)?.[0] ?? null
    const lastConfirmedAt = rowsOf(lastConfirmedResult, signal)?.[0]?.counted_at ?? null

    // ── Wave 2: what needs wave 1's ids, all at once ───────────────────────
    const [allocationsResult, names, adjustmentsResult] = await Promise.all([
      bills.length > 0
        ? abortable(
            client
              .from('effective_bill_payments')
              .select('bill_id, method, amount_paise')
              .in(
                'bill_id',
                bills.map((bill) => bill.id),
              ),
            signal,
          )
        : null,
      namesFor(
        [
          ...expenseRowsRaw.map((row) => row.recorded_by),
          ...observations.map((row) => row.recorded_by),
          ...observations.map((row) => row.corrected_by),
          ...movements.map((row) => row.recorded_by),
          ...verificationRows.map((row) => row.verified_by),
        ],
        signal,
      ),
      observations.length > 0
        ? abortable(
            client
              .from('drawer_observation_adjustments')
              .select('*')
              .in(
                'observation_id',
                observations.map((row) => row.id),
              ),
            signal,
          )
        : null,
    ])

    const allocations = allocationsResult ? (rowsOf(allocationsResult, signal) ?? []) : []
    const adjustmentRows = adjustmentsResult ? (rowsOf(adjustmentsResult, signal) ?? []) : []

    let cashPaise = 0
    let cashBills = 0
    let upiPaise = 0
    let upiBills = 0

    const perBill = new Map<string, { cash: number; upi: number }>()
    for (const allocation of allocations) {
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

    const channels = channelRows.map((row) => ({
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
      // `as_of_at` is null on every production row; `updated_at` moves on each
      // run that re-read the day. Same rule as `toZomatoSettlement`.
      asOfAt: row.as_of_at ?? row.updated_at,
    }))
    const isCeiling = channels.some((channel) => channel.commissionPaise === null)

    const expenseRows = expenseRowsRaw
      .map((row) => ({
        id: row.id ?? '',
        label: row.description ?? row.category ?? 'Expense',
        // Carried separately: `label` prefers the description, so grouping the
        // month by category is impossible from `label` alone (#52 design D6).
        category: row.category ?? 'Expense',
        paise: row.amount_paise ?? 0,
        // The view normalises the two shapes: `payment_method = 'cash'` on one
        // side, `is_cash` on the other, one boolean out.
        isCash: row.is_cash ?? false,
        instant: row.occurred_at ?? row.created_at ?? '',
        // Nullable through the view, because a notebook row carried over from
        // before accounts existed has no recorder.
        recordedByName: row.recorded_by ? (names.get(row.recorded_by) ?? null) : null,
      }))
      // Instant, then id: the order `ledger_month_inputs` lists them in, so a
      // day and its month agree on the order of two expenses at one instant.
      .sort((a, b) =>
        a.instant === b.instant
          ? a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0
          : (Date.parse(a.instant) || 0) - (Date.parse(b.instant) || 0),
      )

    // ── The drawer, ordered by instant rather than grouped by category ──────
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
      isLegacyImprecise: row.is_legacy_imprecise,
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
      adjustments: adjustmentRows
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

    // Compared as instants: `to` is `toISOString()` and `anchorAt` is
    // PostgREST's `+00:00` form, and as strings the two disagree about an
    // anchor at the cutover exactly. `ledger_month_inputs` compares instants.
    const beforeAnchor = anchorAt === null || Date.parse(to) <= Date.parse(anchorAt)

    let observationCoversDays: number | null = null
    const covering = observations[0]
    if (covering && !covering.is_anchor && beforeDay) {
      const fromDate = resolveBusinessDate(new Date(beforeDay.counted_at), CUTOVER)
      const toDate = resolveBusinessDate(new Date(covering.counted_at), CUTOVER)
      observationCoversDays =
        Math.round(
          (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
        ) + 1
    }

    const verifications = verificationRows.map((row) => ({
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
        for (const row of channelRows) {
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
        // Summed from the same settled bills the takings come from, so a voided
        // bill drops out of both together.
        discountPaise: bills.reduce((sum, bill) => sum + (bill.discount_paise ?? 0), 0),
        totalPaise:
          cashPaise +
          upiPaise +
          channels.reduce((sum, channel) => sum + (channel.netPaise ?? channel.grossPaise), 0),
        isCeiling,
      },
      drawer: {
        state: beforeAnchor ? 'not-tracked-yet' : observations.length > 0 ? 'counted' : 'carried',
        openingPaise: beforeAnchor ? null : openingPaise,
        closingPaise: beforeAnchor ? null : closingPaise,
        lastConfirmedAt: beforeAnchor ? null : lastConfirmedAt,
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

    async getMonth(outletId, month, { signal } = {}) {
      const [year, monthNumber] = month.split('-').map(Number)
      if (!year || !monthNumber) {
        throw new LedgerStatementActionError('bad_month', 'That is not a month this reads.')
      }
      const daysInMonth = new Date(year, monthNumber, 0).getDate()

      // One server read of exactly what the month uses, rather than thirty-one
      // whole days of which the month kept the revenue, the expenses and one
      // word. `ledger_month_inputs` is `toMonthDayInput(getDay(date))` for every
      // date, derived on read from the same sources and stored nowhere; a parity
      // test holds the two together to the paisa. It runs alongside the two
      // reads the month has always made.
      const [inputsResult, mappedResult, spendsResult] = await Promise.all([
        abortable(
          client.rpc('ledger_month_inputs', { p_outlet_id: outletId, p_month: `${month}-01` }),
          signal,
        ),
        // Which channels this OUTLET trades on, from the mapping the sync itself
        // is driven by.
        //
        // Not every known channel: Kanchrapara does not sell on Swiggy, and the
        // sync writes it a month of nought rows regardless. Assuming both
        // channels everywhere put three nought rows on that outlet's screen
        // every month, and where the rows were absent it would have raised a
        // "recorded nothing" alarm about a channel nobody expected to report
        // [owner, 2026-09-01].
        abortable(
          client
            .from('outlet_channel_restaurants')
            .select('channel, state')
            .eq('outlet_id', outletId),
          signal,
        ),
        abortable(
          client
            .from('drawer_cash_out')
            .select('*')
            .eq('outlet_id', outletId)
            .eq('kind', 'spend')
            .gte('occurred_at', dayBounds(`${month}-01`).from)
            .lt('occurred_at', dayBounds(`${month}-${String(daysInMonth).padStart(2, '0')}`).to),
          signal,
        ),
      ])

      const days = (rowsOf(inputsResult, signal) ?? []) as unknown as MonthDayInput[]
      const spends = rowsOf(spendsResult, signal) ?? []
      const mapped = [
        ...new Set(
          (rowsOf(mappedResult, signal) ?? [])
            .filter((row) => row.state === 'enabled')
            .map((row) => row.channel),
        ),
      ]
      /*
       * An unreadable mapping falls back to every known channel, and the
       * direction of that fallback is the point.
       *
       * The only SELECT policy on `outlet_channel_restaurants` is owner-only, so
       * a Franchise Admin reads **nought rows with no error** — RLS filters, it
       * does not refuse. Trusting an empty result would mean a manager silently
       * loses the alarm this change exists to raise, on the same month where the
       * owner sees it: two people disagreeing about whether a channel is missing.
       *
       * So an empty mapping means "cannot tell", not "trades on nothing", and the
       * month errs toward saying too much rather than too little. The cost is a
       * possible "recorded nothing" line for a channel the outlet does not use;
       * the alternative cost is a missing sales channel nobody is told about.
       * Giving the manager the same read is a policy change, and therefore a
       * migration, which this change does not make — which is also why the
       * mapping is not read inside `ledger_month_inputs`, where security
       * definer would quietly make it.
       *
       * An *error* on this read is different, and throws like every other.
       */
      const expectedChannels = mapped.length > 0 ? mapped : DELIVERY_CHANNELS

      // Bounded by what has actually happened, so an unfinished month does not
      // report its remaining dates as days with no sales (see `readMonth`).
      const reading = readMonth(days, {
        throughBusinessDate: resolveBusinessDate(new Date(), CUTOVER),
        expectedChannels,
      })

      const spendNames = await namesFor(
        spends.map((row) => row.recorded_by),
        signal,
      )

      return {
        outletId,
        month,
        reading,
        spends: spends.map((row) => ({
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
