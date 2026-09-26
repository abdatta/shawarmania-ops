import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { drawerDifferencePaise, expectedTotalPaise, nextOpeningPaise } from '@/domain'

import {
  CashDrawerActionError,
  DRAWER_HISTORY_PAGE,
  type CashDrawerAdapter,
  type DrawerAdjustmentRecord,
  type DrawerBalance,
  type DrawerCashOutRecord,
  type DrawerEdit,
  type DrawerExceptionRecord,
  type DrawerExpensesDay,
  type DrawerObservationRecord,
  type DrawerReceiptsDay,
  type NearbyCashBillRecord,
  type ObservationPage,
  type ObservationPageQuery,
  type RecordCashOutInput,
  type RecordObservationInput,
} from '../adapters'
import type { Database, Tables } from '../database.types'

/**
 * The real cash-drawer adapter (#11).
 *
 * **It computes nothing that the database computes.** Every write goes through a
 * `security definer` command — `record_drawer_observation`,
 * `record_drawer_cash_out`, `edit_drawer_observation`,
 * `adjust_drawer_observation`, `acknowledge_drawer_exception` — because the
 * opening, the expected total and the difference are derived inside the
 * transaction that writes the row and a client must not be able to supply them.
 * There is no table insert anywhere in this file, and no grant that would let
 * one succeed.
 *
 * What it does compute is the **pending** interval: what should be in the drawer
 * *right now*, which is not a stored figure and cannot be, because "now" moves.
 * That uses the same `src/domain/drawer.ts` functions the screens use and the
 * same three interval readers the database exposes, so the running balance and
 * the figure the next count is measured against cannot disagree.
 */

type Client = SupabaseClient<Database>

function refuse(error: PostgrestError | Error): never {
  const message = 'message' in error ? error.message : String(error)

  // The database's refusals are written to be read by a person — they name what
  // the count collided with. Passing them through beats replacing them with a
  // generic sentence that loses the previous count's instant.
  if (/future/i.test(message)) {
    throw new CashDrawerActionError('future_count', message)
  }
  if (/already counted/i.test(message)) {
    throw new CashDrawerActionError('already_counted', message)
  }
  if (/away_needs_a_reason/i.test(message)) {
    throw new CashDrawerActionError(
      'away_needs_reason',
      'Say why you are recording this away from the outlet. Nothing is refused for being elsewhere; the record just says where you were.',
    )
  }
  if (/anchored on this one/i.test(message)) {
    throw new CashDrawerActionError('anchored', message)
  }
  if (/edit it instead/i.test(message)) {
    throw new CashDrawerActionError('not_anchored', message)
  }
  if (/spend_is_positive/i.test(message)) {
    throw new CashDrawerActionError(
      'negative_spend',
      'Drawer cash cannot un-buy something. A spend is money that left the drawer.',
    )
  }
  if (/spend_needs_a_reason/i.test(message)) {
    throw new CashDrawerActionError(
      'spend_needs_reason',
      'Say what the money bought. A spend has to identify itself; a collection does not.',
    )
  }
  if (/Super Admin|Franchise Admin/i.test(message)) {
    throw new CashDrawerActionError('refused', message)
  }
  throw new CashDrawerActionError('failed', message)
}

/**
 * How many business dates the pending interval touched.
 *
 * **The `const CUTOVER = '04:00'` this replaces was a guess.** It happened to be
 * right — both outlets read 04:00, measured 2026-08-29 — and it is exactly the
 * kind of constant that stays right until an outlet opens with a different one.
 * The grouped readers resolve every date through `outlets.business_day_cutover`
 * on the outlet's own row, so the span is read off them and nothing here has an
 * opinion about when a day starts.
 *
 * An interval that touched no business date at all counts as one: nothing moved
 * in it, so there is no attribution for a long interval to blur.
 */
function daysCoveredBy(groups: readonly { businessDate: string }[][]): number {
  const dates = groups.flat().map((group) => group.businessDate)
  if (dates.length === 0) return 1
  const oldest = dates.reduce((a, b) => (a < b ? a : b))
  const newest = dates.reduce((a, b) => (a > b ? a : b))
  return (
    Math.round(
      (Date.parse(`${newest}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000,
    ) + 1
  )
}

function toCashOut(
  row: Tables<'drawer_cash_out'>,
  names: Map<string, string>,
): DrawerCashOutRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    kind: row.kind === 'spend' ? 'spend' : 'collection',
    amountPaise: row.amount_paise,
    occurredAt: row.occurred_at,
    recordedBy: row.recorded_by,
    recordedByName: names.get(row.recorded_by) ?? null,
    observationId: row.observation_id,
    reason: row.reason,
    onSite: row.recorded_on_site,
    awayReason: row.away_reason,
  }
}

function toAdjustment(
  row: Tables<'drawer_observation_adjustments'>,
  names: Map<string, string>,
): DrawerAdjustmentRecord {
  return {
    id: row.id,
    observationId: row.observation_id,
    originalCountedTotalPaise: row.original_counted_total_paise,
    correctedCountedTotalPaise: row.corrected_counted_total_paise,
    reason: row.reason,
    adjustedBy: row.adjusted_by,
    adjustedByName: names.get(row.adjusted_by) ?? null,
    adjustedAt: row.adjusted_at,
  }
}

/**
 * One observation, assembled from the rows that describe it.
 *
 * Module level rather than a closure inside `getState`, because the paged
 * history reader needs the identical mapping and a second copy of the
 * opening-break rule is a second place for it to drift.
 *
 * `previous` is the observation immediately BEFORE this one in time, which is
 * what the break is measured against. A caller reading a page has to supply the
 * predecessor of its oldest row even though that row belongs to the next page,
 * or exactly one row per page silently loses its marker.
 */
function toObservationRecord(
  row: Tables<'drawer_observations'>,
  previous: Tables<'drawer_observations'> | null,
  movements: readonly Tables<'drawer_cash_out'>[],
  adjustments: readonly Tables<'drawer_observation_adjustments'>[],
  names: Map<string, string>,
): DrawerObservationRecord {
  const ownOf = (observationId: string) =>
    movements.filter((movement) => movement.observation_id === observationId)

  // Reported, never repaired (design D4).
  let openingBreakPaise: number | null = null
  if (!row.is_anchor && previous && row.opening_paise !== null) {
    const carried = nextOpeningPaise(
      previous.counted_total_paise,
      ownOf(previous.id).reduce((sum, movement) => sum + movement.amount_paise, 0),
    )
    if (carried !== row.opening_paise) openingBreakPaise = row.opening_paise - carried
  }

  return {
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
    ownCashOut: ownOf(row.id).map((movement) => toCashOut(movement, names)),
    adjustments: adjustments
      .filter((adjustment) => adjustment.observation_id === row.id)
      .map((adjustment) => toAdjustment(adjustment, names)),
    openingBreakPaise,
  }
}

/**
 * Every name a row carries, from the profiles embedded in it.
 *
 * The Drawer's reads embed each recorder, corrector and adjuster in the rows
 * that name them, so a name never costs a round trip of its own.
 */
type Named = { full_name: string } | null
type ObservationWithEmbeds = Tables<'drawer_observations'> & {
  recorder: Named
  corrector: Named
  drawer_cash_out: (Tables<'drawer_cash_out'> & { recorder: Named })[]
  drawer_observation_adjustments: (Tables<'drawer_observation_adjustments'> & {
    adjuster: Named
  })[]
}

function namesIn(rows: readonly ObservationWithEmbeds[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const row of rows) {
    if (row.recorder) names.set(row.recorded_by, row.recorder.full_name)
    if (row.corrected_by && row.corrector) names.set(row.corrected_by, row.corrector.full_name)
    for (const movement of row.drawer_cash_out) {
      if (movement.recorder) names.set(movement.recorded_by, movement.recorder.full_name)
    }
    for (const adjustment of row.drawer_observation_adjustments) {
      if (adjustment.adjuster) names.set(adjustment.adjusted_by, adjustment.adjuster.full_name)
    }
  }
  return names
}

/** A count with everything that describes it, in the one request. */
const OBSERVATION_WITH_EMBEDS =
  '*, recorder:profiles!recorded_by(full_name), corrector:profiles!corrected_by(full_name), drawer_cash_out(*, recorder:profiles!recorded_by(full_name)), drawer_observation_adjustments(*, adjuster:profiles!adjusted_by(full_name))'

/** What the recent-bills read returns, cash already split on the server. */
type RecentBill = {
  id: string
  bill_number: number
  paid_at: string | null
  cash_paise: number
}
type RecentBills = { nearby: RecentBill[]; late: (RecentBill & { synced_at: string })[] }

export function createSupabaseCashDrawerAdapter(client: Client): CashDrawerAdapter {
  /** Names for attribution. Read once per load rather than joined per row. */
  async function namesFor(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
    if (wanted.length === 0) return new Map()
    const { data } = await client.from('profiles').select('id, full_name').in('id', wanted)
    return new Map((data ?? []).map((row) => [row.id, row.full_name]))
  }

  /**
   * A page of past counts, newest first, in one round trip.
   *
   * `limit + 1` rows, which answers both questions at once: whether there is
   * another page, and what the oldest row on THIS page carries forward from. Each
   * row arrives with its own cash out, adjustments and names embedded; the
   * predecessor's own cash out matters too, because the break on the oldest row
   * is measured against its counted total less that cash out, and leaving it out
   * would report a break that is not there.
   */
  async function pageOf(outletId: string, query: ObservationPageQuery): Promise<ObservationPage> {
    const limit = query.limit ?? DRAWER_HISTORY_PAGE
    let select = client
      .from('drawer_observations')
      .select(OBSERVATION_WITH_EMBEDS)
      .eq('outlet_id', outletId)
      .order('counted_at', { ascending: false })
      .limit(limit + 1)
    // Exclusive, so a page continues from the oldest row already on screen and a
    // count sharing that instant cannot be shown twice. The database keeps
    // counted instants strictly increasing per outlet, so this is a total order.
    if (query.before) select = select.lt('counted_at', query.before)

    const rows = await select
    if (rows.error) refuse(rows.error)

    const observations = (rows.data ?? []) as unknown as ObservationWithEmbeds[]
    const page = observations.slice(0, limit)
    if (page.length === 0) return { observations: [], hasMore: false }

    const movements = observations.flatMap((row) => row.drawer_cash_out)
    const adjustments = page.flatMap((row) => row.drawer_observation_adjustments)
    const names = namesIn(observations)
    return {
      observations: page.map((row, index) =>
        toObservationRecord(row, observations[index + 1] ?? null, movements, adjustments, names),
      ),
      hasMore: observations.length > limit,
    }
  }

  /**
   * The balance: the last count and what has happened since. Two round trips —
   * the last two counts (for the last one's own record and the break against its
   * predecessor) alongside the nearby cash bills, then the interval readers,
   * which need the last count's instant.
   */
  async function balanceFor(outletId: string): Promise<DrawerBalance> {
    const now = new Date().toISOString()
    const [lastTwo, recentBills] = await Promise.all([
      client
        .from('drawer_observations')
        .select(OBSERVATION_WITH_EMBEDS)
        .eq('outlet_id', outletId)
        .order('counted_at', { ascending: false })
        .limit(2),
      // The nearby cash bills, for the movable boundary and the coincidence
      // report — deliberately the bills themselves and never a candidate
      // instant. Late bills are the exceptions' business; asking for those after
      // `now` asks for none.
      client.rpc('drawer_recent_cash_bills', { p_outlet_id: outletId, p_late_after: now }),
    ])
    if (lastTwo.error) refuse(lastTwo.error)
    if (recentBills.error) refuse(recentBills.error)

    const rows = (lastTwo.data ?? []) as unknown as ObservationWithEmbeds[]
    const last = rows[0] ?? null
    if (!last) {
      // No anchor yet. The drawer is not tracked at all, and the surface says so
      // rather than showing a zero it cannot justify (design D18).
      return {
        outletId,
        lastObservation: null,
        expectedNowPaise: null,
        leftInDrawerPaise: null,
        cashReceiptsSincePaise: 0,
        cashReceiptsSinceCount: 0,
        cashExpensesSincePaise: 0,
        cashExpensesSinceCount: 0,
        receiptsByDay: [],
        cashExpensesByDay: [],
        cashOutSincePaise: 0,
        cashOutSinceCount: 0,
        daysCovered: 0,
        nearbyCashBills: [],
        unsyncedDevices: { count: 0, since: null },
      }
    }

    // The three interval readers, called on the database rather than
    // reimplemented here, so the pending figure and the figure the next count is
    // measured against come from one piece of arithmetic.
    const [receipts, expenses, cashOut, receiptDays, expenseDays, sinceMovements] =
      await Promise.all([
        client.rpc('drawer_cash_receipts_paise', {
          p_outlet_id: outletId,
          p_from: last.counted_at,
          p_to: now,
        }),
        client.rpc('drawer_cash_expenses_paise', {
          p_outlet_id: outletId,
          p_from: last.counted_at,
          p_to: now,
        }),
        client.rpc('drawer_cash_out_paise', {
          p_outlet_id: outletId,
          p_from: last.counted_at,
          p_to: now,
          p_exclude_observation: last.id,
        }),
        // The same two questions, one `group by` apart — same relation, same
        // predicate, same `(from, to]` interval. That is what lets the surface
        // assert that the breakdown sums to the tile it was opened from, rather
        // than hoping (design D2). Nothing here re-adds them in TypeScript.
        client.rpc('drawer_cash_receipts_by_day', {
          p_outlet_id: outletId,
          p_from: last.counted_at,
          p_to: now,
        }),
        client.rpc('drawer_cash_expenses_by_day', {
          p_outlet_id: outletId,
          p_from: last.counted_at,
          p_to: now,
        }),
        // The movements since the last count, by instant: which is what
        // `cashOutSinceCount` asks, and not the same question as a count's own
        // movements (the page's movements answered it wrongly once).
        client
          .from('drawer_cash_out')
          .select('id, observation_id')
          .eq('outlet_id', outletId)
          .gt('occurred_at', last.counted_at),
      ])
    if (receipts.error) refuse(receipts.error)
    if (expenses.error) refuse(expenses.error)
    if (cashOut.error) refuse(cashOut.error)
    if (receiptDays.error) refuse(receiptDays.error)
    if (expenseDays.error) refuse(expenseDays.error)
    if (sinceMovements.error) refuse(sinceMovements.error)

    const receiptsByDay: DrawerReceiptsDay[] = (receiptDays.data ?? []).map((row) => ({
      businessDate: row.business_date,
      paise: Number(row.paise),
      bills: row.bills,
    }))
    const cashExpensesByDay: DrawerExpensesDay[] = (expenseDays.data ?? []).map((row) => ({
      businessDate: row.business_date,
      paise: Number(row.paise),
      rows: row.rows,
    }))

    const movements = rows.flatMap((row) => row.drawer_cash_out)
    const lastObservation = toObservationRecord(
      last,
      rows[1] ?? null,
      movements,
      last.drawer_observation_adjustments,
      namesIn(rows),
    )
    const left = nextOpeningPaise(
      last.counted_total_paise,
      last.drawer_cash_out.reduce((sum, movement) => sum + movement.amount_paise, 0),
    )

    const nearbyCashBills: NearbyCashBillRecord[] = (
      recentBills.data as unknown as RecentBills
    ).nearby
      .map((bill) => ({
        billId: bill.id,
        billNumber: bill.bill_number,
        paidAt: bill.paid_at ?? '',
        cashPaise: Number(bill.cash_paise),
      }))
      .filter((bill) => bill.cashPaise > 0 && bill.paidAt !== '')
      .slice(0, 12)

    return {
      outletId,
      lastObservation,
      expectedNowPaise: expectedTotalPaise({
        openingPaise: left,
        cashReceiptsPaise: Number(receipts.data ?? 0),
        cashExpensesPaise: Number(expenses.data ?? 0),
        cashOutPaise: Number(cashOut.data ?? 0),
      }),
      leftInDrawerPaise: left,
      cashReceiptsSincePaise: Number(receipts.data ?? 0),
      // **The true count, from the grouped read.** It used to be the length of
      // `nearbyCashBills`, which is capped at twelve and drawn from the last forty
      // settled bills for a different job entirely — so forty cash bills since
      // the last count reported twelve.
      cashReceiptsSinceCount: receiptsByDay.reduce((sum, day) => sum + day.bills, 0),
      cashExpensesSincePaise: Number(expenses.data ?? 0),
      cashExpensesSinceCount: cashExpensesByDay.reduce((sum, day) => sum + day.rows, 0),
      receiptsByDay,
      cashExpensesByDay,
      cashOutSincePaise: Number(cashOut.data ?? 0),
      cashOutSinceCount: (sinceMovements.data ?? []).filter((row) => row.observation_id !== last.id)
        .length,
      daysCovered: daysCoveredBy([receiptsByDay, cashExpensesByDay]),
      nearbyCashBills,
      unsyncedDevices: { count: 0, since: null },
    }
  }

  /**
   * Late arrivals inside an observed interval: derived from instants, never
   * stored. A cash bill inside an observed interval that arrived after the
   * observation was recorded. Two round trips — the page's counts and the
   * acknowledgements, then the bills that synced after the oldest count on the
   * page was recorded, cash already split.
   */
  async function exceptionsFor(outletId: string): Promise<DrawerExceptionRecord[]> {
    const [observationsResult, acknowledgements] = await Promise.all([
      client
        .from('drawer_observations')
        .select(
          'id, counted_at, recorded_at, is_anchor, expected_paise, counted_total_paise, difference_paise',
        )
        .eq('outlet_id', outletId)
        .order('counted_at', { ascending: false })
        .limit(DRAWER_HISTORY_PAGE + 1),
      client
        .from('drawer_reconciliation_acknowledgements')
        .select('*, acknowledger:profiles!acknowledged_by(full_name)')
        .eq('outlet_id', outletId),
    ])
    if (observationsResult.error) refuse(observationsResult.error)
    if (acknowledgements.error) refuse(acknowledgements.error)

    const observations = observationsResult.data ?? []
    const oldest = observations.at(-1)
    if (!oldest) return []

    const recentBills = await client.rpc('drawer_recent_cash_bills', {
      p_outlet_id: outletId,
      p_late_after: oldest.recorded_at,
    })
    if (recentBills.error) refuse(recentBills.error)
    const lateBills = (recentBills.data as unknown as RecentBills).late

    const ackNames = new Map<string, string>()
    for (const row of acknowledgements.data ?? []) {
      if (row.acknowledger) ackNames.set(row.acknowledged_by, row.acknowledger.full_name)
    }

    const chronological = [...observations].reverse()
    const exceptions: DrawerExceptionRecord[] = []
    for (const bill of lateBills) {
      const paidAt = bill.paid_at
      if (!paidAt) continue
      const cash = Number(bill.cash_paise)
      if (cash === 0) continue

      // Which observation's interval does this fall in? The earliest one whose
      // counted instant is at or after the payment, and which was recorded
      // before the bill landed.
      const covering = chronological.find(
        (row) => !row.is_anchor && row.counted_at >= paidAt && row.recorded_at < bill.synced_at,
      )
      if (!covering) continue

      const acknowledgement = (acknowledgements.data ?? []).find(
        (row) => row.observation_id === covering.id && row.source_id === bill.id,
      )

      exceptions.push({
        sourceKind: 'bill',
        sourceId: bill.id,
        label: `Bill ${bill.bill_number}`,
        amountPaise: cash,
        occurredAt: paidAt,
        arrivedAt: bill.synced_at,
        observationId: covering.id,
        differenceWouldHaveBeenPaise:
          covering.expected_paise === null
            ? 0
            : drawerDifferencePaise(covering.counted_total_paise, covering.expected_paise + cash),
        explainsRecordedVariance: covering.difference_paise === cash,
        acknowledgedAt: acknowledgement?.acknowledged_at ?? null,
        acknowledgedByName: acknowledgement
          ? (ackNames.get(acknowledgement.acknowledged_by) ?? null)
          : null,
        acknowledgementNote: acknowledgement?.note ?? null,
      })
    }
    return exceptions
  }

  return {
    async getState(outletId) {
      // Everything at once, for readers that want the whole drawer. The surface
      // reads the three parts separately so each appears when it lands (D18).
      const [balance, page, exceptions] = await Promise.all([
        balanceFor(outletId),
        pageOf(outletId, {}),
        exceptionsFor(outletId),
      ])
      return { ...balance, recentObservations: page.observations, exceptions }
    },

    getBalance: balanceFor,

    getExceptions: exceptionsFor,

    /**
     * A page of past counts, older than `before`, newest first.
     *
     * Its own three reads rather than a slice of `getState`: this runs while
     * somebody scrolls, and re-reading the interval aggregates, the nearby bills
     * and the late arrivals to render ten more rows would be four round trips
     * for a list that has not changed.
     */
    listObservations: pageOf,

    async recordObservation(input: RecordObservationInput) {
      // Keys are OMITTED rather than set to undefined, so each absent argument
      // falls to the function's own default. `exactOptionalPropertyTypes` refuses
      // the shorter spelling, and it is right to: a `p_certain: undefined` sent
      // over the wire is not the same request as one that never mentioned it.
      const { data, error } = await client.rpc('record_drawer_observation', {
        p_outlet_id: input.outletId,
        p_counted_at: input.countedAt,
        p_counted_total_paise: input.countedTotalPaise,
        p_certain: input.certain,
        ...(input.position
          ? {
              p_lat: input.position.latitude,
              p_lng: input.position.longitude,
              p_accuracy_m: input.position.accuracyMetres,
            }
          : {}),
        ...(input.awayReason ? { p_away_reason: input.awayReason } : {}),
        ...(input.note ? { p_note: input.note } : {}),
        // Signed: a negative is cash added to a thin drawer, through the same
        // parameter, with no second call and no second concept.
        ...(input.cashOut
          ? {
              p_cash_out_paise: input.cashOut.amountPaise,
              p_cash_out_kind: input.cashOut.kind,
              ...(input.cashOut.reason ? { p_cash_out_reason: input.cashOut.reason } : {}),
            }
          : {}),
      })
      if (error) refuse(error)

      const row = data as unknown as Tables<'drawer_observations'>
      const names = await namesFor([row.recorded_by, row.corrected_by])
      return {
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
        correctedByName: null,
        onSite: row.recorded_on_site,
        awayReason: row.away_reason,
        note: row.note,
        ownCashOut: [],
        adjustments: [],
        openingBreakPaise: null,
      }
    },

    /**
     * **Nothing under `src/` calls this, and that is the point.**
     *
     * `the-drawer-explains-its-figures` deleted Only Collect and Other Spend
     * from the drawer surface, so every movement the app writes now belongs to a
     * count and is folded into the following opening. That is what makes the
     * three tiles on the balance card account for the headline exactly, rather
     * than leaving `cashOutSincePaise` as a term with no tile.
     *
     * The command, the table, both kinds, their constraints, their policies and
     * their grants are untouched: two production rows exist and must keep
     * reading, and a later change that finds a real spend case re-offers it by
     * adding a control, not by writing a migration.
     */
    async recordCashOut(input: RecordCashOutInput) {
      const { data, error } = await client.rpc('record_drawer_cash_out', {
        p_outlet_id: input.outletId,
        p_amount_paise: input.amountPaise,
        p_kind: input.kind,
        ...(input.occurredAt ? { p_occurred_at: input.occurredAt } : {}),
        ...(input.reason ? { p_reason: input.reason } : {}),
        ...(input.position
          ? {
              p_lat: input.position.latitude,
              p_lng: input.position.longitude,
              p_accuracy_m: input.position.accuracyMetres,
            }
          : {}),
        ...(input.awayReason ? { p_away_reason: input.awayReason } : {}),
      })
      if (error) refuse(error)
      const row = data as unknown as Tables<'drawer_cash_out'>
      const names = await namesFor([row.recorded_by])
      return toCashOut(row, names)
    },

    async editObservation(observationId, edit: DrawerEdit) {
      // Each key OMITTED where the caller left the field alone, so the command's
      // own "null means leave it" default applies. `note: ''` is sent as an
      // empty string, which is how the sheet clears a note on purpose — the
      // shorter `edit.note ? …` spelling is what silently wiped notes before.
      const { data, error } = await client.rpc('edit_drawer_observation', {
        p_observation_id: observationId,
        p_counted_total_paise: edit.countedTotalPaise,
        // `?? ''` rather than a null: the command reads an empty string as
        // "clear this", and `p_note` is not nullable over the wire.
        ...(edit.note === undefined ? {} : { p_note: edit.note ?? '' }),
        ...(edit.countedAt === undefined || edit.countedAt === null
          ? {}
          : { p_counted_at: edit.countedAt }),
      })
      if (error) refuse(error)
      const row = data as unknown as Tables<'drawer_observations'>
      const names = await namesFor([row.recorded_by, row.corrected_by])
      return {
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
        ownCashOut: [],
        adjustments: [],
        openingBreakPaise: null,
      }
    },

    async adjustObservation(observationId, correctedCountedTotalPaise, reason) {
      const { data, error } = await client.rpc('adjust_drawer_observation', {
        p_observation_id: observationId,
        p_corrected_counted_total_paise: correctedCountedTotalPaise,
        p_reason: reason,
      })
      if (error) refuse(error)
      const row = data as unknown as Tables<'drawer_observation_adjustments'>
      const names = await namesFor([row.adjusted_by])
      return toAdjustment(row, names)
    },

    async acknowledgeException(observationId, sourceKind, sourceId, note) {
      const { error } = await client.rpc('acknowledge_drawer_exception', {
        p_observation_id: observationId,
        p_source_kind: sourceKind,
        p_source_id: sourceId,
        ...(note ? { p_note: note } : {}),
      })
      if (error) refuse(error)
    },
  }
}
