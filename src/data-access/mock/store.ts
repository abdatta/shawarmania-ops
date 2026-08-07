import {
  billTotals,
  differencePaise,
  expectedClosingPaise,
  lineTotalPaise,
  movementDelta,
  normalizeCategory,
  resolveBusinessDate,
  shiftBusinessDate,
  sumQuantities,
} from '@/domain'

import type { Tables } from '../database.types'
import {
  billSeedItemId,
  billSeedOutlet,
  billSeeds,
  counterDeviceFixtures,
  DEMO_BILLER_ID,
  DEMO_COUNTER_DEVICE_ID,
  DEMO_KANCHRAPARA_BILLER_ID,
  DEMO_KANCHRAPARA_DEVICE_ID,
  DEMO_KANCHRAPARA_SHIFT_ID,
  DEMO_OPEN_SHIFT_ID,
  type BillSeed,
} from './fixtures/billing'
import { alertSeeds } from './fixtures/alerts'
import { manualLedgerDaySeeds, manualLedgerExpenseSeeds } from './fixtures/manual-ledger'
import { menuCategoryFixtures, menuItemFixtures } from './fixtures/menu'
import {
  CLOSED_DAYS_AGO,
  expenseSeeds,
  inventoryItemFixtures,
  MISCOUNT_DAYS_AGO,
  MISCOUNT_OUTLET_ID,
  MISCOUNT_PAISE,
  movementSeeds,
  OPENING_CASH_PAISE,
  withdrawalSeeds,
} from './fixtures/operations'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

/**
 * The demo store — one mutable dataset per demo session, shared by every mock
 * adapter that needs it.
 *
 * The accounts and roster mocks already shared a list, for a reason that
 * generalises: an account deactivated on Access has to read as deactivated on
 * Staff in the same walkthrough. The operational surfaces need far more of it —
 * the cash screen's takings must be the bills the counter actually rang, and the
 * inventory list's quantity must be the sum of the ledger it links to. Anyone
 * looking at two screens in a row notices figures that do not correspond, which
 * is the classic way a demo stops being convincing (docs/DEMO_MODE.md).
 *
 * **Both trading outlets are materialised here**, because the owner console
 * compares them and a second outlet invented separately would contradict the
 * first within one screen of it (ui-owner-console-and-demo, design D1).
 *
 * Constructed per call rather than as a module singleton, so demo state resets
 * with the demo tree and a walkthrough always starts from the same place.
 *
 * Each slice names the adapter that owns its writes. A slice with two owners is
 * a design mistake, not a convenience.
 */

export interface DemoStore {
  /** Today's business date at the demo outlet, resolved through the cutover. */
  readonly today: string
  /** `daysAgo` business days back from today. 0 is today. */
  businessDate(daysAgo: number): string
  /** The outlets that trade in the demo, in the order the console shows them. */
  readonly tradingOutletIds: readonly string[]
  /** Owned by the menu adapter. */
  menuCategories: Tables<'menu_categories'>[]
  /** Owned by the menu adapter. */
  menuItems: Tables<'menu_items'>[]
  /** Read-only here; #9 owns enrolment. */
  counterDevices: Tables<'counter_devices'>[]
  /** Owned by the billing adapter. */
  shifts: Tables<'shifts'>[]
  /** Owned by the billing adapter. Read by the daily-cash and insights adapters. */
  bills: Tables<'bills'>[]
  /** Owned by the billing adapter. */
  billItems: Tables<'bill_items'>[]
  /**
   * The per-outlet bill number sequence, mirroring `bill_number_counters`.
   *
   * A number is spent when a bill is **sent**, never when it is queued — so a
   * bill cancelled in the undo window leaves no gap, exactly as the counter
   * billing spec requires of the real sequence. Each outlet counts on its own,
   * which is what `(outlet_id, bill_number)` unique means.
   */
  billNumbers: Map<string, number>
  /** Owned by the inventory adapter. */
  inventoryItems: Tables<'inventory_items'>[]
  /** Owned by the inventory adapter. Append-only: the ledger is the truth. */
  inventoryMovements: Tables<'inventory_movements'>[]
  /** Owned by the expenses adapter. Read by the daily-cash and insights adapters. */
  expenses: Tables<'expenses'>[]
  /** Business-wide suggestions, shared by both expense records. */
  expenseCategories: Tables<'expense_categories'>[]
  /** Owner curation history. */
  expenseCategoryOperations: Tables<'expense_category_operations'>[]
  /** Owned by the daily-cash adapter. */
  withdrawals: Tables<'cash_withdrawals'>[]
  /** Owned by the daily-cash adapter. A record here is a signed-off snapshot. */
  dailyCashRecords: Tables<'daily_cash_records'>[]
  /** Owned by the alerts adapter. */
  alerts: Tables<'alerts'>[]
  /** Owned by the alerts adapter. Append-only: a response is never edited. */
  alertResponses: Tables<'alert_responses'>[]
  /** What was in the drawer when the day started. #12 makes this configurable. */
  readonly openingCashPaise: number
  /**
   * Owned by the manual-ledger adapter (#36), and **temporary**: both slices go
   * when that capability is retired. Kept here rather than inside the mock
   * adapter so a role switch does not restart the demo month, which is the same
   * reason every other slice lives here.
   */
  manualLedgerDays: Tables<'manual_ledger_days'>[]
  /** Owned by the manual-ledger adapter (#36). Temporary. */
  manualLedgerExpenses: Tables<'manual_ledger_expenses'>[]
}

/** The outlet every demo persona but the owner belongs to. */
export const DEMO_OUTLET_ID = OUTLET_KALYANI_ID

/** The second outlet, which exists to be compared against rather than walked. */
export const DEMO_SECOND_OUTLET_ID = OUTLET_KANCHRAPARA_ID

/** Whoever recorded the demo's operational rows. A manager, as it would be. */
const MANAGER_ID = personaFixtures.franchise_admin.profile.id

/** Whoever wrote the manual ledger's rows. The owner, because nobody else can. */
const OWNER_ID = personaFixtures.super_admin.profile.id

/** When each outlet counted its drawer yesterday. */
const CLOSE_TIME: Record<string, string> = {
  [OUTLET_KALYANI_ID]: '22:30',
  [OUTLET_KANCHRAPARA_ID]: '22:00',
}

function outletById(id: string) {
  const outlet = outletFixtures.find((candidate) => candidate.id === id)
  if (!outlet) throw new Error(`The demo outlet fixture ${id} is missing.`)
  return outlet
}

/** `19:24` on a business date, as an instant. Demo data, so IST is assumed. */
function instantAt(businessDate: string, time: string): string {
  return new Date(`${businessDate}T${time}:00+05:30`).toISOString()
}

export function createDemoStore(): DemoStore {
  const tradingOutletIds = [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID]

  // Resolved once, through the outlet's own cutover — never derived from a
  // timestamp later. A demo opened at 00:30 must show the evening it is still
  // part of, for exactly the reason business_date is a column. Both outlets
  // share a cutover, so one resolution serves the whole scenario.
  const today = resolveBusinessDate(new Date(), outletById(DEMO_OUTLET_ID).business_day_cutover)
  const businessDate = (daysAgo: number) => shiftBusinessDate(today, -daysAgo)

  const menuItems = structuredClone(menuItemFixtures)

  const shifts: Tables<'shifts'>[] = [
    {
      id: DEMO_OPEN_SHIFT_ID,
      outlet_id: DEMO_OUTLET_ID,
      biller_profile_id: DEMO_BILLER_ID,
      counter_device_id: DEMO_COUNTER_DEVICE_ID,
      business_date: today,
      opened_at: instantAt(today, '11:00'),
      // Open on arrival: the counter's gate is ringing and settling an order,
      // and a walkthrough should land able to do it rather than behind a PIN
      // nobody was handed. The shift screen is still fully walkable.
      closed_at: null,
    },
    {
      // Kanchrapara's, closed. Its bills need a shift to be attributed to, and
      // nobody is standing at that counter during a demo — an open shift at an
      // outlet no persona occupies would be a second counter the walkthrough
      // never reaches.
      id: DEMO_KANCHRAPARA_SHIFT_ID,
      outlet_id: DEMO_SECOND_OUTLET_ID,
      biller_profile_id: DEMO_KANCHRAPARA_BILLER_ID,
      counter_device_id: DEMO_KANCHRAPARA_DEVICE_ID,
      business_date: today,
      opened_at: instantAt(today, '11:00'),
      closed_at: instantAt(today, '21:30'),
    },
  ]

  const shiftForOutlet = (outletId: string) =>
    outletId === DEMO_OUTLET_ID ? DEMO_OPEN_SHIFT_ID : DEMO_KANCHRAPARA_SHIFT_ID
  const billerForOutlet = (outletId: string) =>
    outletId === DEMO_OUTLET_ID ? DEMO_BILLER_ID : DEMO_KANCHRAPARA_BILLER_ID
  const deviceForOutlet = (outletId: string) =>
    outletId === DEMO_OUTLET_ID ? DEMO_COUNTER_DEVICE_ID : DEMO_KANCHRAPARA_DEVICE_ID

  const bills: Tables<'bills'>[] = []
  const billItems: Tables<'bill_items'>[] = []
  const billNumbers = new Map<string, number>()

  /**
   * A seed becomes a bill the way the counter makes one: line totals from the
   * menu item's price **snapshotted at the moment of sale**, bill totals from
   * the same domain function the screen uses, and a number taken from **that
   * outlet's** sequence in the order its bills were sent.
   */
  function materialise(seed: BillSeed, index: number) {
    const outletId = billSeedOutlet(seed)
    const date = businessDate(seed.daysAgo)
    const createdAt = instantAt(date, seed.time)
    const billId = `d7000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`

    const lines = seed.lines.map((line) => {
      const itemId = billSeedItemId(seed, line)
      const item = menuItems.find((candidate) => candidate.id === itemId)
      if (!item) throw new Error(`No demo menu item: ${itemId}`)
      return { item, quantity: line.quantity }
    })

    const totals = billTotals(
      lines.map((line) => ({ unitPricePaise: line.item.price_paise, quantity: line.quantity })),
    )

    const nextNumber = (billNumbers.get(outletId) ?? 0) + 1
    billNumbers.set(outletId, nextNumber)

    bills.push({
      id: billId,
      outlet_id: outletId,
      bill_number: nextNumber,
      biller_profile_id: billerForOutlet(outletId),
      counter_device_id: deviceForOutlet(outletId),
      shift_id: shiftForOutlet(outletId),
      business_date: date,
      created_at: createdAt,
      // A bill that arrived after its day was closed reached the server the
      // next morning. `created_at` is when it was rung; `synced_at` is when it
      // landed, and the gap between them is the whole reconciliation problem.
      synced_at: seed.arrivedAfterClose
        ? instantAt(businessDate(seed.daysAgo - 1), '08:30')
        : createdAt,
      customer_id: null,
      customer_name: seed.customerName ?? null,
      customer_phone: null,
      payment_method: seed.paymentMethod,
      pricing_mode: 'no_tax',
      status: 'settled',
      subtotal_paise: totals.subtotalPaise,
      discount_paise: totals.discountPaise,
      tax_paise: totals.taxPaise,
      total_paise: totals.totalPaise,
      void_reason: null,
      voided_at: null,
      voided_by: null,
    })

    lines.forEach((line, lineIndex) => {
      billItems.push({
        id: `d8000000-0000-4000-a000-${String(index + 1).padStart(9, '0')}${String(lineIndex + 1).padStart(3, '0')}`,
        bill_id: billId,
        menu_item_id: line.item.id,
        // The snapshot. Never joined back to the live menu — a price change
        // must not silently rewrite last month's revenue.
        item_name: line.item.name,
        unit_price_paise: line.item.price_paise,
        quantity: line.quantity,
        line_total_paise: lineTotalPaise(line.item.price_paise, line.quantity),
      })
    })
  }

  // Oldest first, so each outlet's numbering runs in the order its bills were
  // sent. Sorting the whole set at once is safe because the sequence is taken
  // per outlet inside `materialise`.
  ;[...billSeeds]
    .sort((a, b) => b.daysAgo - a.daysAgo || a.time.localeCompare(b.time))
    .forEach(materialise)

  /**
   * Every outlet numbers its own bills from one, without a gap. The real
   * sequence is `(outlet_id, bill_number)` unique with a per-outlet counter, and
   * a demo that shared one counter across two outlets would be demonstrating a
   * product this one is not.
   */
  for (const outletId of tradingOutletIds) {
    const numbers = bills
      .filter((bill) => bill.outlet_id === outletId)
      .map((bill) => bill.bill_number)
      .sort((a, b) => a - b)
    const expected = numbers.map((_, index) => index + 1)
    if (numbers.join(',') !== expected.join(',')) {
      throw new Error(
        `Demo fixture drift: outlet ${outletId} numbered its bills ${numbers.join(', ')}, ` +
          `which is not a gapless per-outlet sequence from 1.`,
      )
    }
  }

  // ── Stock ────────────────────────────────────────────────────────────────

  const inventoryItems = structuredClone(inventoryItemFixtures)
  const inventoryMovements: Tables<'inventory_movements'>[] = movementSeeds.map((seed, index) => {
    const item = inventoryItems.find((candidate) => candidate.id === seed.itemId)
    if (!item) throw new Error(`No demo inventory item: ${seed.itemId}`)
    return {
      id: `da000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      // Read from the item rather than restated on the seed: a movement that
      // claimed a different outlet from the item it moves would be a row the
      // database's own foreign keys could not produce.
      outlet_id: item.outlet_id,
      inventory_item_id: seed.itemId,
      movement_type: seed.movementType,
      quantity_delta: movementDelta(seed.movementType, seed.quantity),
      note: seed.note ?? null,
      business_date: businessDate(seed.daysAgo),
      created_at: instantAt(businessDate(seed.daysAgo), '10:00'),
      recorded_by: MANAGER_ID,
      unit_cost_paise: null,
    }
  })

  /**
   * The ledger is the truth and the quantity is a cache of it — so a fixture
   * whose stored quantity does not equal its own movements is a demo that
   * cannot answer "why does it say 4 kg?". Caught here, at construction, rather
   * than discovered on screen.
   */
  for (const item of inventoryItems) {
    const fromLedger = sumQuantities(
      inventoryMovements
        .filter((movement) => movement.inventory_item_id === item.id)
        .map((movement) => movement.quantity_delta),
    )
    if (fromLedger !== item.current_quantity) {
      throw new Error(
        `Demo fixture drift: ${item.name} stores ${item.current_quantity} ${item.unit} but its ` +
          `movements sum to ${fromLedger}. The ledger is the truth — fix the fixture.`,
      )
    }
  }

  // ── Expenses and the drawer ──────────────────────────────────────────────

  const expenses: Tables<'expenses'>[] = expenseSeeds.map((seed, index) => ({
    id: `db000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
    outlet_id: seed.outletId ?? DEMO_OUTLET_ID,
    business_date: businessDate(seed.daysAgo),
    category: seed.category,
    amount_paise: seed.amountPaise,
    payment_method: seed.paymentMethod,
    description: seed.description ?? null,
    created_at: instantAt(businessDate(seed.daysAgo), seed.time),
    recorded_by: MANAGER_ID,
  }))

  const withdrawals: Tables<'cash_withdrawals'>[] = withdrawalSeeds.map((seed, index) => ({
    id: `dc000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
    outlet_id: seed.outletId ?? DEMO_OUTLET_ID,
    business_date: businessDate(seed.daysAgo),
    amount_paise: seed.amountPaise,
    reason: seed.reason ?? null,
    withdrawn_by: seed.withdrawnBy,
    recorded_by: MANAGER_ID,
    created_at: instantAt(businessDate(seed.daysAgo), seed.time),
  }))

  /**
   * The days that were counted and signed off — at Kalyani, one of them with a
   * mismatch.
   *
   * The figures are computed here from the same rows the surface derives from,
   * with **the late bill deliberately excluded**: it had not arrived when the
   * drawer was counted, and a closed day is a snapshot that nothing recomputes.
   * That exclusion is the entire reconciliation exception, and hard-coding these
   * numbers instead would produce a demo the real system could not reproduce.
   */
  const dailyCashRecords: Tables<'daily_cash_records'>[] = tradingOutletIds.flatMap(
    (outletId, outletIndex) =>
      CLOSED_DAYS_AGO.map((daysAgo, dayIndex) => {
        const date = businessDate(daysAgo)
        const closeTime = CLOSE_TIME[outletId]
        if (!closeTime) throw new Error(`No demo close time for outlet ${outletId}.`)
        const closedAt = instantAt(date, closeTime)

        const closedCashSales = bills
          .filter(
            (bill) =>
              bill.outlet_id === outletId &&
              bill.business_date === date &&
              bill.payment_method === 'cash' &&
              bill.status === 'settled' &&
              // Rung before the close; anything that landed afterwards is the
              // exception, not part of the signed-off figure.
              bill.synced_at <= closedAt,
          )
          .reduce((running, bill) => running + bill.total_paise, 0)
        const closedCashExpenses = expenses
          .filter(
            (expense) =>
              expense.outlet_id === outletId &&
              expense.business_date === date &&
              expense.payment_method === 'cash',
          )
          .reduce((running, expense) => running + expense.amount_paise, 0)
        const closedWithdrawn = withdrawals
          .filter(
            (withdrawal) => withdrawal.outlet_id === outletId && withdrawal.business_date === date,
          )
          .reduce((running, withdrawal) => running + withdrawal.amount_paise, 0)

        const closedExpected = expectedClosingPaise({
          openingCashPaise: OPENING_CASH_PAISE,
          cashSalesPaise: closedCashSales,
          cashExpensesPaise: closedCashExpenses,
          cashWithdrawnPaise: closedWithdrawn,
        })
        const miscount =
          outletId === MISCOUNT_OUTLET_ID && daysAgo === MISCOUNT_DAYS_AGO ? MISCOUNT_PAISE : 0
        const closedActual = closedExpected + miscount

        return {
          id: `dd000000-0000-4000-a00${outletIndex}-${String(dayIndex + 1).padStart(12, '0')}`,
          outlet_id: outletId,
          business_date: date,
          opening_cash_paise: OPENING_CASH_PAISE,
          cash_sales_paise: closedCashSales,
          cash_expenses_paise: closedCashExpenses,
          cash_withdrawn_paise: closedWithdrawn,
          expected_closing_paise: closedExpected,
          actual_closing_paise: closedActual,
          difference_paise: differencePaise(closedActual, closedExpected),
          notes: miscount === 0 ? null : 'Counted twice. Short by the same amount both times.',
          closed_at: closedAt,
          closed_by: MANAGER_ID,
        }
      }),
  )

  // ── Alerts ───────────────────────────────────────────────────────────────

  const alerts: Tables<'alerts'>[] = alertSeeds.map((seed) => ({
    id: seed.id,
    outlet_id: seed.outletId,
    raised_by: seed.raisedBy,
    category: seed.category,
    priority: seed.priority,
    status: seed.status,
    subject: seed.subject,
    message: seed.message,
    created_at: instantAt(businessDate(seed.daysAgo), seed.time),
  }))

  const alertResponses: Tables<'alert_responses'>[] = alertSeeds.flatMap((seed) =>
    (seed.responses ?? []).map((response) => ({
      id: response.id,
      alert_id: seed.id,
      responder_profile_id: response.responderId,
      message: response.message,
      created_at: instantAt(businessDate(response.daysAgo), response.time),
    })),
  )

  // ── The manual ledger's demo month (#36, temporary) ───────────────────────
  //
  // One outlet only. The month view reads one outlet at a time (design D9), and a
  // second fabricated outlet would double the fixture for nothing observable.

  const manualLedgerExpenses: Tables<'manual_ledger_expenses'>[] = manualLedgerExpenseSeeds.map(
    (seed, index) => ({
      id: `de000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outlet_id: DEMO_OUTLET_ID,
      business_date: businessDate(seed.daysAgo),
      category: seed.category,
      is_cash: seed.isCash,
      amount_paise: seed.amountPaise,
      description: seed.note ?? null,
      recorded_by: OWNER_ID,
      created_at: instantAt(businessDate(seed.daysAgo), seed.time),
      updated_at: instantAt(businessDate(seed.daysAgo), seed.time),
    }),
  )

  const manualLedgerDays: Tables<'manual_ledger_days'>[] = manualLedgerDaySeeds.map(
    (seed, index) => ({
      id: `dd000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outlet_id: DEMO_OUTLET_ID,
      business_date: businessDate(seed.daysAgo),
      opening_cash_paise: seed.openingCashPaise,
      cash_revenue_paise: seed.cashRevenuePaise,
      upi_revenue_paise: seed.upiRevenuePaise,
      zomato_revenue_paise: seed.zomatoRevenuePaise,
      swiggy_revenue_paise: seed.swiggyRevenuePaise,
      cash_added_paise: seed.cashAddedPaise ?? 0,
      cash_added_reason: seed.cashAddedReason ?? null,
      cash_removed_paise: seed.cashRemovedPaise ?? 0,
      cash_removed_reason: seed.cashRemovedReason ?? null,
      counted_cash_paise: seed.countedCashPaise,
      zomato_commission_bp: seed.zomatoCommissionBp,
      swiggy_commission_bp: seed.swiggyCommissionBp,
      note: seed.note ?? null,
      recorded_by: OWNER_ID,
      created_at: instantAt(businessDate(seed.daysAgo), '23:00'),
      updated_at: instantAt(businessDate(seed.daysAgo), '23:00'),
    }),
  )

  const categoryNames = new Map<string, string>()
  for (const row of [...expenses, ...manualLedgerExpenses]) {
    const name = normalizeCategory(row.category)
    if (!categoryNames.has(name.toLocaleLowerCase())) {
      categoryNames.set(name.toLocaleLowerCase(), name)
    }
  }
  const expenseCategories: Tables<'expense_categories'>[] = [...categoryNames.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((name, index) => ({
      id: `e1000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      name,
      created_by: OWNER_ID,
      created_at: new Date().toISOString(),
    }))
  const expenseCategoryOperations: Tables<'expense_category_operations'>[] = []

  // The same drift guard the inventory fixtures get, for the same reason: a demo
  // whose drawer does not add up is a demo the real system cannot reproduce, and
  // the arithmetic here is exactly what the surface will show.
  for (const [index, seed] of manualLedgerDaySeeds.entries()) {
    const row = manualLedgerDays[index]
    if (!row) throw new Error(`Demo fixture drift: manual ledger day ${index} was not built.`)
    const cashExpenses = manualLedgerExpenses
      .filter((expense) => expense.business_date === row.business_date && expense.is_cash)
      .reduce((running, expense) => running + expense.amount_paise, 0)
    const expected = expectedClosingPaise({
      openingCashPaise: row.opening_cash_paise,
      cashSalesPaise: row.cash_revenue_paise + row.cash_added_paise,
      cashExpensesPaise: cashExpenses,
      cashWithdrawnPaise: row.cash_removed_paise,
    })
    const difference = differencePaise(row.counted_cash_paise, expected)
    const declared = seed.expectedDifferencePaise ?? 0
    if (difference !== declared) {
      throw new Error(
        `Demo fixture drift: the manual ledger day ${row.business_date} is out by ${difference} ` +
          `paise but declares ${declared}. Fix the fixture, not this check.`,
      )
    }
  }

  return {
    today,
    businessDate,
    tradingOutletIds,
    menuCategories: structuredClone(menuCategoryFixtures),
    menuItems,
    counterDevices: structuredClone(counterDeviceFixtures),
    shifts,
    bills,
    billItems,
    billNumbers,
    inventoryItems,
    inventoryMovements,
    expenses,
    expenseCategories,
    expenseCategoryOperations,
    withdrawals,
    dailyCashRecords,
    alerts,
    alertResponses,
    openingCashPaise: OPENING_CASH_PAISE,
    manualLedgerDays,
    manualLedgerExpenses,
  }
}
