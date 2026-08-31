import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { drawerDifferencePaise, expectedTotalPaise, nextOpeningPaise } from '@/domain'

import {
  CashDrawerActionError,
  DRAWER_HISTORY_PAGE,
  type CashDrawerAdapter,
  type DrawerAdjustmentRecord,
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
 * Cash allocations for a set of bills, read as their own select.
 *
 * **Not a PostgREST embed, and that is not a style choice.**
 * `effective_bill_payments` is a VIEW with no declared foreign key, so
 * `bills(..., effective_bill_payments(...))` fails outright with
 * *"Could not find a relationship between 'bills' and 'effective_bill_payments'
 * in the schema cache"*. The first version of these adapters used the embed; the
 * pgTAP suite passed (it tests SQL functions), the mock passed (it is not
 * PostgREST), and the surfaces would have failed on their first real read. The
 * derived-month measurement is what caught it.
 *
 * `src/data-access/supabase-adapters/billing.ts` already reads the view this
 * way, which is the convention this follows rather than reinvents.
 *
 * `amount_paise` is nullable on the view in the generated types, so it is
 * coalesced rather than asserted.
 */
async function cashByBill(
  client: Client,
  billIds: readonly string[],
): Promise<Map<string, number>> {
  const cash = new Map<string, number>()
  if (billIds.length === 0) return cash

  const { data, error } = await client
    .from('effective_bill_payments')
    .select('bill_id, method, amount_paise')
    .in('bill_id', [...billIds])
  if (error) refuse(error)

  for (const allocation of data ?? []) {
    if (allocation.method !== 'cash' || !allocation.bill_id) continue
    cash.set(
      allocation.bill_id,
      (cash.get(allocation.bill_id) ?? 0) + (allocation.amount_paise ?? 0),
    )
  }
  return cash
}

export function createSupabaseCashDrawerAdapter(client: Client): CashDrawerAdapter {
  /** Names for attribution. Read once per load rather than joined per row. */
  async function namesFor(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
    if (wanted.length === 0) return new Map()
    const { data } = await client.from('profiles').select('id, full_name').in('id', wanted)
    return new Map((data ?? []).map((row) => [row.id, row.full_name]))
  }

  return {
    async getState(outletId) {
      // One row beyond the page: it is the predecessor the oldest row on the
      // page is measured against, and it is dropped before the page is returned.
      const observationsResult = await client
        .from('drawer_observations')
        .select('*')
        .eq('outlet_id', outletId)
        .order('counted_at', { ascending: false })
        .limit(DRAWER_HISTORY_PAGE + 1)
      if (observationsResult.error) refuse(observationsResult.error)

      const observations = observationsResult.data ?? []
      const last = observations[0] ?? null

      const names = await namesFor([
        ...observations.map((row) => row.recorded_by),
        ...observations.map((row) => row.corrected_by),
      ])

      if (!last) {
        // No anchor yet. The drawer is not tracked at all, and the surface says
        // so rather than showing a zero it cannot justify (design D18).
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
          recentObservations: [],
          nearbyCashBills: [],
          unsyncedDevices: { count: 0, since: null },
          exceptions: [],
        }
      }

      const now = new Date().toISOString()

      // The three interval readers, called on the database rather than
      // reimplemented here, so the pending figure and the figure the next count
      // is measured against come from one piece of arithmetic.
      const [receipts, expenses, cashOut, receiptDays, expenseDays] = await Promise.all([
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
      ])
      if (receipts.error) refuse(receipts.error)
      if (expenses.error) refuse(expenses.error)
      if (cashOut.error) refuse(cashOut.error)
      if (receiptDays.error) refuse(receiptDays.error)
      if (expenseDays.error) refuse(expenseDays.error)

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

      /**
       * **Two reads, because they answer two different questions**, and one of
       * them used to answer both wrongly.
       *
       * This was a single read of the newest sixty movements at the outlet, and
       * `listObservations` two hundred lines below already did it correctly —
       * so the first page could lie while every later page told the truth. The
       * sixty were ordered by instant across the whole outlet rather than scoped
       * to the observations on the page, so a burst of spends could push an
       * older row's own collection out of the window. Nothing failed; the row
       * simply found no movements of its own, and **that is the shape of the
       * bug worth stating**: `Collected` understated, `Left` overstated, and —
       * because a carry-forward is the previous count less its own movements —
       * `openingBreakPaise` computed against a figure that was too high and
       * **reported a break that did not exist**. A fabricated discrepancy
       * warning, in the one surface whose promise is to report and never invent.
       *
       * Unreachable in production until `retire-the-manual-ledger` (#12): each
       * outlet held three counts, fewer than one page, so the list never paged
       * and the window never had to stretch. Carrying August took each outlet to
       * nineteen.
       *
       * So: the page's movements by observation, which is bounded by the page
       * and served by `drawer_cash_out_observation_idx`; and the movements since
       * the last count by instant, which is what `cashOutSinceCount` actually
       * asks and is bounded by how recently the drawer was counted.
       */
      const observationIds = observations.map((row) => row.id)
      const [pageMovements, sinceMovements, adjustments] = await Promise.all([
        client
          .from('drawer_cash_out')
          .select('*')
          .eq('outlet_id', outletId)
          .in('observation_id', observationIds),
        client
          .from('drawer_cash_out')
          .select('id, observation_id')
          .eq('outlet_id', outletId)
          .gt('occurred_at', last.counted_at),
        // Scoped to the page for the same reason, and it had no bound at all:
        // every adjustment the outlet had ever recorded, on every drawer open.
        client
          .from('drawer_observation_adjustments')
          .select('*')
          .eq('outlet_id', outletId)
          .in(
            'observation_id',
            observations.slice(0, DRAWER_HISTORY_PAGE).map((row) => row.id),
          ),
      ])
      if (pageMovements.error) refuse(pageMovements.error)
      if (sinceMovements.error) refuse(sinceMovements.error)
      if (adjustments.error) refuse(adjustments.error)

      const movements = pageMovements.data ?? []
      const ownOf = (observationId: string) =>
        movements.filter((row) => row.observation_id === observationId)

      // `observations` is newest-first, so the row AFTER an index is its
      // predecessor in time. One row beyond the page was read for exactly this,
      // and it is dropped from the page itself below.
      const recent = observations
        .slice(0, DRAWER_HISTORY_PAGE)
        .map((row, index) =>
          toObservationRecord(
            row,
            observations[index + 1] ?? null,
            movements,
            adjustments.data ?? [],
            names,
          ),
        )

      const left = nextOpeningPaise(
        last.counted_total_paise,
        ownOf(last.id).reduce((sum, movement) => sum + movement.amount_paise, 0),
      )

      // The nearby cash bills, for the movable boundary and the coincidence
      // report. Deliberately the bills themselves and never a candidate instant.
      const nearbyResult = await client
        .from('bills')
        .select('id, bill_number, paid_at')
        .eq('outlet_id', outletId)
        .eq('status', 'settled')
        .order('paid_at', { ascending: false })
        .limit(40)
      if (nearbyResult.error) refuse(nearbyResult.error)

      const nearbyBills = nearbyResult.data ?? []
      const nearbyCash = await cashByBill(
        client,
        nearbyBills.map((bill) => bill.id),
      )

      const nearbyCashBills: NearbyCashBillRecord[] = nearbyBills
        .map((bill) => ({
          billId: bill.id,
          billNumber: bill.bill_number,
          paidAt: bill.paid_at ?? '',
          cashPaise: nearbyCash.get(bill.id) ?? 0,
        }))
        .filter((bill) => bill.cashPaise > 0 && bill.paidAt !== '')
        .slice(0, 12)

      // Exceptions: derived from instants, never stored. A cash bill inside an
      // observed interval that arrived after the observation was recorded.
      const acknowledgements = await client
        .from('drawer_reconciliation_acknowledgements')
        .select('*')
        .eq('outlet_id', outletId)
      const ackNames = await namesFor(
        (acknowledgements.data ?? []).map((row) => row.acknowledged_by),
      )

      const lateResult = await client
        .from('bills')
        .select('id, bill_number, paid_at, synced_at')
        .eq('outlet_id', outletId)
        .eq('status', 'settled')
        .gt('synced_at', observations.at(-1)?.recorded_at ?? now)
        .order('paid_at', { ascending: false })
        .limit(40)
      if (lateResult.error) refuse(lateResult.error)

      const lateBills = lateResult.data ?? []
      const lateCash = await cashByBill(
        client,
        lateBills.map((bill) => bill.id),
      )

      const exceptions: DrawerExceptionRecord[] = []
      for (const bill of lateBills) {
        const paidAt = bill.paid_at
        if (!paidAt) continue
        const cash = lateCash.get(bill.id) ?? 0
        if (cash === 0) continue

        // Which observation's interval does this fall in? The earliest one whose
        // counted instant is at or after the payment, and which was recorded
        // before the bill landed.
        const chronological = [...observations].reverse()
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

      return {
        outletId,
        lastObservation: recent[0] ?? null,
        expectedNowPaise: expectedTotalPaise({
          openingPaise: left,
          cashReceiptsPaise: Number(receipts.data ?? 0),
          cashExpensesPaise: Number(expenses.data ?? 0),
          cashOutPaise: Number(cashOut.data ?? 0),
        }),
        leftInDrawerPaise: left,
        cashReceiptsSincePaise: Number(receipts.data ?? 0),
        // **The true count, from the grouped read.** It used to be the length of
        // `nearbyCashBills`, which is capped at twelve and drawn from the last
        // forty settled bills for a different job entirely — so forty cash bills
        // since the last count reported twelve. The cap on that list is
        // deliberate and stays; only the count stops being derived from it.
        cashReceiptsSinceCount: receiptsByDay.reduce((sum, day) => sum + day.bills, 0),
        cashExpensesSincePaise: Number(expenses.data ?? 0),
        // And this was the literal nought.
        cashExpensesSinceCount: cashExpensesByDay.reduce((sum, day) => sum + day.rows, 0),
        receiptsByDay,
        cashExpensesByDay,
        cashOutSincePaise: Number(cashOut.data ?? 0),
        // Its own read, by instant: the movements since the last count are not
        // the page's movements, and counting them out of the page's array is
        // what made this figure disagree with the paise beside it.
        cashOutSinceCount: (sinceMovements.data ?? []).filter(
          (row) => row.observation_id !== last.id,
        ).length,
        daysCovered: daysCoveredBy([receiptsByDay, cashExpensesByDay]),
        recentObservations: recent,
        nearbyCashBills,
        unsyncedDevices: { count: 0, since: null },
        exceptions,
      }
    },

    /**
     * A page of past counts, older than `before`, newest first.
     *
     * Its own three reads rather than a slice of `getState`: this runs while
     * somebody scrolls, and re-reading the interval aggregates, the nearby bills
     * and the late arrivals to render ten more rows would be four round trips
     * for a list that has not changed.
     */
    async listObservations(outletId, query: ObservationPageQuery = {}) {
      const limit = query.limit ?? DRAWER_HISTORY_PAGE

      // `limit + 1` rows, which answers both questions at once: whether there is
      // another page, and what the oldest row on THIS page carries forward from.
      let select = client
        .from('drawer_observations')
        .select('*')
        .eq('outlet_id', outletId)
        .order('counted_at', { ascending: false })
        .limit(limit + 1)
      // Exclusive, so a page continues from the oldest row already on screen and
      // a count sharing that instant cannot be shown twice. The database keeps
      // counted instants strictly increasing per outlet, so this is a total order.
      if (query.before) select = select.lt('counted_at', query.before)

      const rows = await select
      if (rows.error) refuse(rows.error)

      const observations = rows.data ?? []
      const page = observations.slice(0, limit)
      if (page.length === 0) return { observations: [], hasMore: false } satisfies ObservationPage

      // The page's own rows AND the predecessor read beyond it. The break on the
      // oldest row is measured against the predecessor's counted total less that
      // observation's OWN cash out, so leaving its movements out would compute a
      // carry-forward of the wrong figure and report a break that is not there.
      const movementIds = observations.map((row) => row.id)
      const adjustmentIds = page.map((row) => row.id)

      const [movementRows, adjustmentRows] = await Promise.all([
        client
          .from('drawer_cash_out')
          .select('*')
          .eq('outlet_id', outletId)
          .in('observation_id', movementIds),
        client
          .from('drawer_observation_adjustments')
          .select('*')
          .eq('outlet_id', outletId)
          .in('observation_id', adjustmentIds),
      ])
      if (movementRows.error) refuse(movementRows.error)
      if (adjustmentRows.error) refuse(adjustmentRows.error)

      const movements = movementRows.data ?? []
      const adjustments = adjustmentRows.data ?? []

      const names = await namesFor([
        ...page.map((row) => row.recorded_by),
        ...page.map((row) => row.corrected_by),
        ...movements.map((row) => row.recorded_by),
        ...adjustments.map((row) => row.adjusted_by),
      ])

      return {
        observations: page.map((row, index) =>
          toObservationRecord(row, observations[index + 1] ?? null, movements, adjustments, names),
        ),
        hasMore: observations.length > limit,
      } satisfies ObservationPage
    },

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
