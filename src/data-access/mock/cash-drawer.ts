import {
  drawerDifferencePaise,
  expectedTotalPaise,
  nextOpeningPaise,
  resolveBusinessDate,
} from '@/domain'

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
  type DrawerState,
  type ObservationPage,
  type ObservationPageQuery,
  type RecordCashOutInput,
  type RecordObservationInput,
} from '../adapters'
import type { Tables } from '../database.types'

import { cashExpensesIn } from './effective-expenses'
import { accountFixtures } from './fixtures/accounts'
import { outletFixtures } from './fixtures/outlets'
import type { DemoStore } from './store'

/**
 * The drawer, in demo mode.
 *
 * **This mock computes every derived figure the same way the database does**, by
 * calling the same pure functions in `src/domain/drawer.ts` that the real
 * adapter's screens read. That is not a shortcut: a mock that accepted an
 * opening or an expected total from a caller would be teaching the opposite of
 * the contract, which is that those three figures are computed inside the
 * transaction that writes the row and cannot be supplied.
 *
 * It also refuses what the database refuses — a count in the future, a count
 * slotted before a settled interval, a zero movement, a negative spend, a spend
 * with no reason, an edit to an observation a later one has anchored on, and an
 * adjustment to one nothing has anchored on yet. A demo that accepted any of
 * those would be demonstrating a product that does not exist.
 */

const MANUAL_TOLERANCE_MINUTES = 15

function paise(value: number, what: string): number {
  if (!Number.isInteger(value)) {
    throw new CashDrawerActionError('not_paise', `${what} must be a whole number of paise.`)
  }
  return value
}

/**
 * The bills that contributed cash in `(from, to]`, from the latest effective
 * allocations.
 *
 * The rows rather than the sum, because the breakdown groups exactly these — so
 * the grouped reading and the scalar it explains are two views of one list and
 * cannot select differently.
 */
function cashReceiptBills(
  store: DemoStore,
  outletId: string,
  from: string | null,
  to: string,
): { paidAt: string; cashPaise: number }[] {
  const found: { paidAt: string; cashPaise: number }[] = []

  for (const bill of store.bills) {
    if (bill.outlet_id !== outletId || bill.status !== 'settled') continue
    const paidAt = bill.paid_at ?? bill.created_at
    // Half-open at the start, closed at the end (design D2).
    if (from !== null && paidAt <= from) continue
    if (paidAt > to) continue

    const allocations = store.billPayments.get(bill.id) ?? []
    const cash = allocations
      .filter((allocation) => allocation.method === 'cash')
      .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
    if (cash === 0) continue

    found.push({ paidAt, cashPaise: cash })
  }

  return found
}

/** Cash actually received in `(from, to]`, and how many bills brought it. */
function cashReceipts(
  store: DemoStore,
  outletId: string,
  from: string | null,
  to: string,
): { paise: number; bills: number } {
  const contributing = cashReceiptBills(store, outletId, from, to)
  return {
    paise: contributing.reduce((sum, bill) => sum + bill.cashPaise, 0),
    bills: contributing.length,
  }
}

/**
 * Cash expenses in `(from, to]`, by occurrence instant.
 *
 * Through `cashExpensesIn`, which reads both expense sources exactly as
 * `public.effective_expenses` does. Reading `store.expenses` alone was this
 * mock's copy of the production defect: the live surfaces read a table nothing
 * writes, so the drawer's expected balance was overstated by every cash expense
 * and the next count would have read short by it.
 */
function cashExpenses(
  store: DemoStore,
  outletId: string,
  from: string | null,
  to: string,
): { paise: number; rows: number } {
  const matching = cashExpensesIn(store, outletId, from, to)
  return {
    paise: matching.reduce((sum, expense) => sum + expense.amountPaise, 0),
    rows: matching.length,
  }
}

/**
 * Signed cash movements in `(from, to]`, excluding any attributed to one
 * observation.
 *
 * The exclusion is what keeps an observation's own collection out of its own
 * expected total: it reduces the next opening instead.
 */
function cashOutIn(
  store: DemoStore,
  outletId: string,
  from: string | null,
  to: string,
  excludeObservationId: string | null,
): { paise: number; rows: number } {
  let total = 0
  let rows = 0

  for (const movement of store.drawerCashOut) {
    if (movement.outlet_id !== outletId) continue
    if (excludeObservationId && movement.observation_id === excludeObservationId) continue
    if (from !== null && movement.occurred_at <= from) continue
    if (movement.occurred_at > to) continue
    total += movement.amount_paise
    rows += 1
  }

  return { paise: total, rows }
}

/**
 * The outlet's own business-day cutover.
 *
 * **Read from the outlet, never held as a constant here.** The real adapter used
 * to carry `const CUTOVER = '04:00'`; the grouped readers take it from
 * `outlets.business_day_cutover`, and a mock that assumed one would be teaching
 * a rule the database does not follow.
 */
function cutoverOf(outletId: string): string {
  return outletFixtures.find((outlet) => outlet.id === outletId)?.business_day_cutover ?? '04:00:00'
}

/**
 * The mock's half of `drawer_cash_receipts_by_day` and
 * `drawer_cash_expenses_by_day`.
 *
 * **The partition is of the INTERVAL, not of the calendar day** (design D1).
 * Everything the scalar readers above already selected is grouped by the
 * business date its instant resolves to, so the groups sum to the scalar by
 * construction on this side of the seam exactly as they do in SQL. Grouping a
 * different set of rows here is how the demo would come to disagree with
 * production, which is the failure `effective-expenses.ts` exists to remember.
 */
function groupByBusinessDate<T>(
  rows: readonly T[],
  outletId: string,
  instantOf: (row: T) => string,
  paiseOf: (row: T) => number,
): { businessDate: string; paise: number; rows: number }[] {
  const cutover = cutoverOf(outletId)
  const groups = new Map<string, { businessDate: string; paise: number; rows: number }>()

  for (const row of rows) {
    const businessDate = resolveBusinessDate(new Date(instantOf(row)), cutover)
    const group = groups.get(businessDate) ?? { businessDate, paise: 0, rows: 0 }
    group.paise += paiseOf(row)
    group.rows += 1
    groups.set(businessDate, group)
  }

  // Newest first, which is the order the breakdown reads in.
  return [...groups.values()].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
}

/** That observation's own cash out, read from the link rather than a window. */
function ownCashOut(store: DemoStore, observationId: string): Tables<'drawer_cash_out'>[] {
  return store.drawerCashOut.filter((movement) => movement.observation_id === observationId)
}

/**
 * Whose count this is.
 *
 * Named rather than left as an id, because attribution names BOTH the account
 * that recorded an observation and the one that last corrected it — so a count
 * the owner recorded and a manager later fixed must not read as though the owner
 * entered what is on screen.
 */
function nameOf(profileId: string | null): string | null {
  if (!profileId) return null
  return accountFixtures.find((account) => account.id === profileId)?.full_name ?? null
}

function toCashOut(row: Tables<'drawer_cash_out'>): DrawerCashOutRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    kind: row.kind === 'spend' ? 'spend' : 'collection',
    amountPaise: row.amount_paise,
    occurredAt: row.occurred_at,
    recordedBy: row.recorded_by,
    recordedByName: nameOf(row.recorded_by),
    observationId: row.observation_id,
    reason: row.reason,
    onSite: row.recorded_on_site,
    awayReason: row.away_reason,
  }
}

function toAdjustment(row: Tables<'drawer_observation_adjustments'>): DrawerAdjustmentRecord {
  return {
    id: row.id,
    observationId: row.observation_id,
    originalCountedTotalPaise: row.original_counted_total_paise,
    correctedCountedTotalPaise: row.corrected_counted_total_paise,
    reason: row.reason,
    adjustedBy: row.adjusted_by,
    adjustedByName: nameOf(row.adjusted_by),
    adjustedAt: row.adjusted_at,
  }
}

function sortedObservations(store: DemoStore, outletId: string): Tables<'drawer_observations'>[] {
  return store.drawerObservations
    .filter((row) => row.outlet_id === outletId)
    .sort((a, b) => a.counted_at.localeCompare(b.counted_at))
}

function toObservation(
  store: DemoStore,
  row: Tables<'drawer_observations'>,
  previous: Tables<'drawer_observations'> | null,
): DrawerObservationRecord {
  // The break is REPORTED, never repaired (design D4). A stored opening that
  // disagrees with the previous observation's carry-forward is evidence about
  // what somebody entered; recomputing it would destroy that evidence and
  // silently move a figure nobody decided to move.
  let openingBreakPaise: number | null = null
  if (!row.is_anchor && previous && row.opening_paise !== null) {
    const carried = nextOpeningPaise(
      previous.counted_total_paise,
      ownCashOut(store, previous.id).reduce((sum, movement) => sum + movement.amount_paise, 0),
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
    recordedByName: nameOf(row.recorded_by),
    correctedBy: row.corrected_by,
    correctedByName: nameOf(row.corrected_by),
    onSite: row.recorded_on_site,
    awayReason: row.away_reason,
    note: row.note,
    ownCashOut: ownCashOut(store, row.id).map(toCashOut),
    adjustments: store.drawerObservationAdjustments
      .filter((adjustment) => adjustment.observation_id === row.id)
      .map(toAdjustment),
    openingBreakPaise,
  }
}

/**
 * Exceptions: work that landed inside an interval an observation had already
 * covered.
 *
 * Derived from instants the store already holds, never stored. A bill qualifies
 * when its payment instant is inside the interval AND it arrived after the
 * observation was recorded — the second half is what makes it a surprise rather
 * than simply a bill.
 */
function exceptionsFor(store: DemoStore, outletId: string): DrawerExceptionRecord[] {
  const observations = sortedObservations(store, outletId)
  const found: DrawerExceptionRecord[] = []

  observations.forEach((observation, index) => {
    if (observation.is_anchor) return
    const previous = observations[index - 1]
    const from = previous ? previous.counted_at : null

    for (const bill of store.bills) {
      if (bill.outlet_id !== outletId || bill.status !== 'settled') continue
      const paidAt = bill.paid_at ?? bill.created_at
      if (from !== null && paidAt <= from) continue
      if (paidAt > observation.counted_at) continue
      if (bill.synced_at <= observation.recorded_at) continue

      const allocations = store.billPayments.get(bill.id) ?? []
      const cash = allocations
        .filter((allocation) => allocation.method === 'cash')
        .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
      if (cash === 0) continue

      const acknowledgement = store.drawerAcknowledgements.find(
        (row) => row.observation_id === observation.id && row.source_id === bill.id,
      )

      // What the difference WOULD have been. Stated rather than applied: the
      // recorded figure stands, and this sits beside it.
      const wouldHaveBeen =
        observation.expected_paise === null
          ? 0
          : drawerDifferencePaise(
              observation.counted_total_paise,
              observation.expected_paise + cash,
            )

      found.push({
        sourceKind: 'bill',
        sourceId: bill.id,
        label: `Bill ${bill.bill_number}`,
        amountPaise: cash,
        occurredAt: paidAt,
        arrivedAt: bill.synced_at,
        observationId: observation.id,
        differenceWouldHaveBeenPaise: wouldHaveBeen,
        // An over that turns out to be an unsynced tablet's cash. The recorded
        // excess stays; the explanation is what is new.
        explainsRecordedVariance: observation.difference_paise === cash,
        acknowledgedAt: acknowledgement?.acknowledged_at ?? null,
        acknowledgedByName: nameOf(acknowledgement?.acknowledged_by ?? null),
        acknowledgementNote: acknowledgement?.note ?? null,
      })
    }
  })

  return found
}

export function createMockCashDrawerAdapter(
  store: DemoStore,
  recordedBy: string,
): CashDrawerAdapter {
  let nextId = 900

  const newId = (prefix: string) =>
    `${prefix}000000-0000-4000-c000-${String(nextId++).padStart(12, '0')}`

  function stateFor(outletId: string): DrawerState {
    const observations = sortedObservations(store, outletId)
    const last = observations.at(-1) ?? null
    const now = new Date().toISOString()

    if (!last) {
      // No anchor yet: the drawer is not tracked at all, and the surface says so
      // rather than showing a zero balance it cannot justify (design D18).
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

    const left = nextOpeningPaise(
      last.counted_total_paise,
      ownCashOut(store, last.id).reduce((sum, movement) => sum + movement.amount_paise, 0),
    )
    const receiptBills = cashReceiptBills(store, outletId, last.counted_at, now)
    const expenseRows = cashExpensesIn(store, outletId, last.counted_at, now)
    const out = cashOutIn(store, outletId, last.counted_at, now, last.id)

    const receiptsByDay: DrawerReceiptsDay[] = groupByBusinessDate(
      receiptBills,
      outletId,
      (bill) => bill.paidAt,
      (bill) => bill.cashPaise,
    ).map((group) => ({ businessDate: group.businessDate, paise: group.paise, bills: group.rows }))

    const cashExpensesByDay: DrawerExpensesDay[] = groupByBusinessDate(
      expenseRows,
      outletId,
      (expense) => expense.instant,
      (expense) => expense.amountPaise,
    )

    const receipts = {
      paise: receiptBills.reduce((sum, bill) => sum + bill.cashPaise, 0),
      bills: receiptBills.length,
    }
    const expenses = {
      paise: expenseRows.reduce((sum, expense) => sum + expense.amountPaise, 0),
      rows: expenseRows.length,
    }

    // The inclusive span of business dates the interval actually touched, read
    // off the groups so the outlet's own cutover decides it (design D2).
    const touched = [...receiptsByDay, ...cashExpensesByDay].map((group) => group.businessDate)
    const daysCovered =
      touched.length === 0
        ? 1
        : Math.round(
            (Date.parse(`${touched.reduce((a, b) => (a > b ? a : b))}T00:00:00Z`) -
              Date.parse(`${touched.reduce((a, b) => (a < b ? a : b))}T00:00:00Z`)) /
              86_400_000,
          ) + 1

    // The bills either side of the last count, for the movable boundary and the
    // exact-coincidence report. Deliberately the bills themselves rather than
    // any candidate instant (design D7).
    const nearby = store.bills
      .filter((bill) => bill.outlet_id === outletId && bill.status === 'settled')
      .map((bill) => {
        const allocations = store.billPayments.get(bill.id) ?? []
        const cash = allocations
          .filter((allocation) => allocation.method === 'cash')
          .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
        return {
          billId: bill.id,
          billNumber: bill.bill_number,
          paidAt: bill.paid_at ?? bill.created_at,
          cashPaise: cash,
        }
      })
      .filter((bill) => bill.cashPaise > 0)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
      .slice(0, 12)

    return {
      outletId,
      lastObservation: toObservation(store, last, observations.at(-2) ?? null),
      expectedNowPaise: expectedTotalPaise({
        openingPaise: left,
        cashReceiptsPaise: receipts.paise,
        cashExpensesPaise: expenses.paise,
        cashOutPaise: out.paise,
      }),
      leftInDrawerPaise: left,
      cashReceiptsSincePaise: receipts.paise,
      cashReceiptsSinceCount: receipts.bills,
      cashExpensesSincePaise: expenses.paise,
      cashExpensesSinceCount: expenses.rows,
      receiptsByDay,
      cashExpensesByDay,
      cashOutSincePaise: out.paise,
      cashOutSinceCount: out.rows,
      daysCovered,
      recentObservations: pageOf(outletId, {}).observations,
      nearbyCashBills: nearby,
      unsyncedDevices: { count: 0, since: null },
      exceptions: exceptionsFor(store, outletId),
    }
  }

  /**
   * One page of counts, newest first, cursored on the counted instant.
   *
   * The whole outlet is mapped and then sliced rather than sliced and then
   * mapped, because an observation's opening break is computed against its
   * PREDECESSOR — and the predecessor of the first row on a page lives on the
   * previous page. Slicing first would silently drop the break marker from
   * exactly one row per page.
   */
  function pageOf(outletId: string, query: ObservationPageQuery): ObservationPage {
    const observations = sortedObservations(store, outletId)
    const newestFirst = observations
      .map((row, index) => toObservation(store, row, observations[index - 1] ?? null))
      .reverse()

    const before = query.before ?? null
    const after =
      before === null ? newestFirst : newestFirst.filter((row) => row.countedAt < before)
    const limit = query.limit ?? DRAWER_HISTORY_PAGE

    return { observations: after.slice(0, limit), hasMore: after.length > limit }
  }

  return {
    async getState(outletId) {
      return stateFor(outletId)
    },

    async listObservations(outletId, query = {}) {
      return pageOf(outletId, query)
    },

    async recordObservation(input: RecordObservationInput) {
      paise(input.countedTotalPaise, 'The counted amount')
      if (input.countedTotalPaise < 0) {
        throw new CashDrawerActionError(
          'negative_count',
          'A drawer cannot hold less than nothing. Enter what you counted.',
        )
      }

      const now = new Date().toISOString()
      if (input.countedAt > now) {
        throw new CashDrawerActionError(
          'future_count',
          'A count cannot be taken in the future. Choose when you actually counted it.',
        )
      }

      const observations = sortedObservations(store, input.outletId)
      const previous = observations.at(-1) ?? null

      if (previous && input.countedAt <= previous.counted_at) {
        throw new CashDrawerActionError(
          'already_counted',
          'This drawer was already counted at that moment or later. A count cannot be slotted into a settled interval.',
        )
      }

      // Being elsewhere is recorded, never refused — but the reason is asked for
      // first, which is what makes an off-site count reviewable.
      const onSite = input.position !== null
      if (!onSite && !input.awayReason?.trim()) {
        throw new CashDrawerActionError(
          'away_needs_reason',
          'Say why you are recording this away from the outlet. Nothing is refused for being elsewhere; the record just says where you were.',
        )
      }

      const isAnchor = previous === null
      let openingPaise: number | null = null
      let expectedPaise: number | null = null

      if (previous) {
        openingPaise = nextOpeningPaise(
          previous.counted_total_paise,
          ownCashOut(store, previous.id).reduce((sum, movement) => sum + movement.amount_paise, 0),
        )
        expectedPaise = expectedTotalPaise({
          openingPaise,
          cashReceiptsPaise: cashReceipts(
            store,
            input.outletId,
            previous.counted_at,
            input.countedAt,
          ).paise,
          cashExpensesPaise: cashExpenses(
            store,
            input.outletId,
            previous.counted_at,
            input.countedAt,
          ).paise,
          cashOutPaise: cashOutIn(
            store,
            input.outletId,
            previous.counted_at,
            input.countedAt,
            previous.id,
          ).paise,
        })
      }

      const row: Tables<'drawer_observations'> = {
        id: newId('dc'),
        outlet_id: input.outletId,
        counted_at: input.countedAt,
        recorded_at: now,
        is_anchor: isAnchor,
        is_legacy_imprecise: false,
        opening_paise: openingPaise,
        expected_paise: expectedPaise,
        difference_paise:
          expectedPaise === null
            ? null
            : drawerDifferencePaise(input.countedTotalPaise, expectedPaise),
        counted_total_paise: input.countedTotalPaise,
        is_approximate: !input.certain && input.countedAt < now,
        tolerance_minutes: MANUAL_TOLERANCE_MINUTES,
        recorded_by: recordedBy,
        corrected_by: null,
        recorded_lat: input.position?.latitude ?? null,
        recorded_lng: input.position?.longitude ?? null,
        recorded_accuracy_m: input.position?.accuracyMetres ?? null,
        recorded_distance_m: null,
        recorded_on_site: onSite,
        away_reason: onSite ? null : (input.awayReason?.trim() ?? null),
        note: input.note?.trim() || null,
        created_at: now,
        updated_at: now,
      }

      store.drawerObservations.push(row)

      // The collection taken at the same moment, in the same act.
      if (input.cashOut && input.cashOut.amountPaise !== 0) {
        store.drawerCashOut.push({
          id: newId('dd'),
          outlet_id: input.outletId,
          kind: input.cashOut.kind,
          amount_paise: paise(input.cashOut.amountPaise, 'The amount collected'),
          occurred_at: input.countedAt,
          recorded_by: recordedBy,
          observation_id: row.id,
          reason: input.cashOut.reason?.trim() || null,
          recorded_lat: row.recorded_lat,
          recorded_lng: row.recorded_lng,
          recorded_accuracy_m: row.recorded_accuracy_m,
          recorded_distance_m: null,
          recorded_on_site: onSite,
          away_reason: row.away_reason,
          created_at: now,
        })
      }

      return toObservation(store, row, previous)
    },

    /**
     * **Unreachable from the app**, and kept in step with the real adapter
     * anyway. `the-drawer-explains-its-figures` deleted the two controls that
     * reached it; the record still carries both kinds and their refusals, so
     * this mock still demonstrates them for whatever reaches the table next.
     */
    async recordCashOut(input: RecordCashOutInput) {
      paise(input.amountPaise, 'The amount')
      if (input.amountPaise === 0) {
        throw new CashDrawerActionError(
          'zero_amount',
          'A cash movement of nought is not a movement.',
        )
      }
      if (input.kind === 'spend' && input.amountPaise < 0) {
        throw new CashDrawerActionError(
          'negative_spend',
          'Drawer cash cannot un-buy something. A spend is money that left the drawer.',
        )
      }
      if (input.kind === 'spend' && !input.reason?.trim()) {
        throw new CashDrawerActionError(
          'spend_needs_reason',
          'Say what the money bought. A spend has to identify itself; a collection does not.',
        )
      }

      const onSite = input.position !== null
      if (!onSite && !input.awayReason?.trim()) {
        throw new CashDrawerActionError(
          'away_needs_reason',
          'Say why you are recording this away from the outlet.',
        )
      }

      const now = new Date().toISOString()
      const row: Tables<'drawer_cash_out'> = {
        id: newId('dd'),
        outlet_id: input.outletId,
        kind: input.kind,
        amount_paise: input.amountPaise,
        occurred_at: input.occurredAt ?? now,
        recorded_by: recordedBy,
        observation_id: null,
        reason: input.reason?.trim() || null,
        recorded_lat: input.position?.latitude ?? null,
        recorded_lng: input.position?.longitude ?? null,
        recorded_accuracy_m: input.position?.accuracyMetres ?? null,
        recorded_distance_m: null,
        recorded_on_site: onSite,
        away_reason: onSite ? null : (input.awayReason?.trim() ?? null),
        created_at: now,
      }
      store.drawerCashOut.push(row)
      return toCashOut(row)
    },

    async editObservation(observationId, edit: DrawerEdit) {
      paise(edit.countedTotalPaise, 'The counted amount')
      const row = store.drawerObservations.find((candidate) => candidate.id === observationId)
      if (!row) throw new CashDrawerActionError('not_found', 'That count is no longer there.')

      const observations = sortedObservations(store, row.outlet_id)
      const later = observations.filter((other) => other.counted_at > row.counted_at)

      // The lock, in one sentence: the next count read this figure as its own
      // stored opening, which is the moment it became load-bearing. It is
      // checked FIRST, before any bound on the instant, so a caller correcting
      // an anchored count is told the one thing that matters.
      if (later.length > 0) {
        throw new CashDrawerActionError(
          'anchored',
          'A later count has already anchored on this one. Post an adjustment instead, with a reason.',
        )
      }

      const countedAt = edit.countedAt ?? row.counted_at
      const previous =
        observations.filter((other) => other.counted_at < row.counted_at).at(-1) ?? null

      if (countedAt !== row.counted_at) {
        // The recording bounds, re-asserted: a corrected instant is an instant.
        const now = new Date().toISOString()
        if (countedAt > now) {
          throw new CashDrawerActionError(
            'future_count',
            'A count cannot be taken in the future. Choose when you actually counted it.',
          )
        }
        if (previous && countedAt <= previous.counted_at) {
          throw new CashDrawerActionError(
            'already_counted',
            'This drawer was already counted at that moment or later. A count cannot be moved into a settled interval.',
          )
        }
        const earliest = store.bills
          .filter((bill) => bill.outlet_id === row.outlet_id && bill.status === 'settled')
          .map((bill) => bill.paid_at ?? bill.created_at)
          .sort()[0]
        if (earliest && countedAt < earliest) {
          throw new CashDrawerActionError(
            'before_activity',
            `This outlet had no drawer activity before ${earliest}; a count cannot precede it.`,
          )
        }

        // **A moved boundary genuinely changes which cash was in the drawer.**
        // The stored opening does not move — it is the previous count's
        // carry-forward — but the three interval terms are recomputed over
        // `(previous count, the new instant]`, with this observation's OWN
        // movements excluded because they belong to the following opening.
        row.expected_paise =
          row.is_anchor || previous === null
            ? null
            : expectedTotalPaise({
                openingPaise: row.opening_paise ?? 0,
                cashReceiptsPaise: cashReceipts(
                  store,
                  row.outlet_id,
                  previous.counted_at,
                  countedAt,
                ).paise,
                cashExpensesPaise: cashExpenses(
                  store,
                  row.outlet_id,
                  previous.counted_at,
                  countedAt,
                ).paise,
                cashOutPaise: cashOutIn(
                  store,
                  row.outlet_id,
                  previous.counted_at,
                  countedAt,
                  row.id,
                ).paise,
              })
        row.counted_at = countedAt
      }

      row.counted_total_paise = edit.countedTotalPaise
      row.difference_paise =
        row.expected_paise === null
          ? null
          : drawerDifferencePaise(edit.countedTotalPaise, row.expected_paise)
      // **Undefined leaves it alone**, which is the bug this replaces: the note
      // was assigned from a parameter nobody sent, so every amount correction
      // cleared it. An empty string clears it on purpose.
      if (edit.note !== undefined) row.note = edit.note?.trim() || null
      if (recordedBy !== row.recorded_by) row.corrected_by = recordedBy
      row.updated_at = new Date().toISOString()

      return toObservation(store, row, previous)
    },

    async adjustObservation(observationId, correctedCountedTotalPaise, reason) {
      paise(correctedCountedTotalPaise, 'The corrected amount')
      const row = store.drawerObservations.find((candidate) => candidate.id === observationId)
      if (!row) throw new CashDrawerActionError('not_found', 'That count is no longer there.')

      const later = sortedObservations(store, row.outlet_id).filter(
        (other) => other.counted_at > row.counted_at,
      )
      if (later.length === 0) {
        throw new CashDrawerActionError(
          'not_anchored',
          'Nothing has anchored on this count yet, so edit it instead — no reason needed.',
        )
      }
      if (!reason.trim()) {
        throw new CashDrawerActionError(
          'reason_required',
          'An adjustment needs a reason. Both figures stay on the record.',
        )
      }

      const adjustment: Tables<'drawer_observation_adjustments'> = {
        id: newId('de'),
        observation_id: row.id,
        outlet_id: row.outlet_id,
        original_counted_total_paise: row.counted_total_paise,
        corrected_counted_total_paise: correctedCountedTotalPaise,
        reason: reason.trim(),
        adjusted_by: recordedBy,
        adjusted_at: new Date().toISOString(),
      }
      store.drawerObservationAdjustments.push(adjustment)

      // **The observation itself is not rewritten, and no later stored opening
      // moves.** The following count re-anchored the balance to physical cash,
      // so nothing after it changes.
      row.corrected_by = recordedBy

      return toAdjustment(adjustment)
    },

    async acknowledgeException(observationId, sourceKind, sourceId, note) {
      const row = store.drawerObservations.find((candidate) => candidate.id === observationId)
      if (!row) throw new CashDrawerActionError('not_found', 'That count is no longer there.')

      const already = store.drawerAcknowledgements.some(
        (entry) => entry.observation_id === observationId && entry.source_id === sourceId,
      )
      if (already) {
        throw new CashDrawerActionError(
          'already_acknowledged',
          'This arrival has already been acknowledged against that count.',
        )
      }

      store.drawerAcknowledgements.push({
        id: newId('df'),
        outlet_id: row.outlet_id,
        observation_id: observationId,
        source_kind: sourceKind,
        source_id: sourceId,
        acknowledged_by: recordedBy,
        acknowledged_at: new Date().toISOString(),
        note: note?.trim() || null,
      })

      // Nothing else happens. The app never changes a person's observation on
      // its own.
    },
  }
}
