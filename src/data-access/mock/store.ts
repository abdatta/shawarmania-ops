import {
  billTotals,
  differencePaise,
  expectedClosingPaise,
  lineTotalPaise,
  movementDelta,
  resolveBusinessDate,
  shiftBusinessDate,
  sumQuantities,
} from '@/domain'

import type { Tables } from '../database.types'
import {
  billSeeds,
  counterDeviceFixtures,
  DEMO_BILLER_ID,
  DEMO_COUNTER_DEVICE_ID,
  DEMO_OPEN_SHIFT_ID,
  type BillSeed,
} from './fixtures/billing'
import { menuCategoryFixtures, menuItemFixtures } from './fixtures/menu'
import {
  expenseSeeds,
  inventoryItemFixtures,
  movementSeeds,
  OPENING_CASH_PAISE,
  withdrawalSeeds,
  YESTERDAY_MISCOUNT_PAISE,
} from './fixtures/operations'
import { OUTLET_KALYANI_ID, outletFixtures } from './fixtures/outlets'
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
  /** Owned by the menu adapter. */
  menuCategories: Tables<'menu_categories'>[]
  /** Owned by the menu adapter. */
  menuItems: Tables<'menu_items'>[]
  /** Read-only here; #9 owns enrolment. */
  counterDevices: Tables<'counter_devices'>[]
  /** Owned by the billing adapter. */
  shifts: Tables<'shifts'>[]
  /** Owned by the billing adapter. Read by the daily-cash adapter. */
  bills: Tables<'bills'>[]
  /** Owned by the billing adapter. */
  billItems: Tables<'bill_items'>[]
  /**
   * The per-outlet bill number sequence, mirroring `bill_number_counters`.
   *
   * A number is spent when a bill is **sent**, never when it is queued — so a
   * bill cancelled in the undo window leaves no gap, exactly as the counter
   * billing spec requires of the real sequence.
   */
  billNumbers: Map<string, number>
  /** Owned by the inventory adapter. */
  inventoryItems: Tables<'inventory_items'>[]
  /** Owned by the inventory adapter. Append-only: the ledger is the truth. */
  inventoryMovements: Tables<'inventory_movements'>[]
  /** Owned by the expenses adapter. Read by the daily-cash adapter. */
  expenses: Tables<'expenses'>[]
  /** Owned by the daily-cash adapter. */
  withdrawals: Tables<'cash_withdrawals'>[]
  /** Owned by the daily-cash adapter. A record here is a signed-off snapshot. */
  dailyCashRecords: Tables<'daily_cash_records'>[]
  /** What was in the drawer when the day started. #12 makes this configurable. */
  readonly openingCashPaise: number
}

/** The outlet every demo persona but the owner belongs to. */
export const DEMO_OUTLET_ID = OUTLET_KALYANI_ID

/** Whoever recorded the demo's operational rows. A manager, as it would be. */
const MANAGER_ID = personaFixtures.franchise_admin.profile.id

function demoOutlet() {
  const outlet = outletFixtures.find((candidate) => candidate.id === DEMO_OUTLET_ID)
  if (!outlet) throw new Error('The demo outlet fixture is missing.')
  return outlet
}

/** `19:24` on a business date, as an instant. Demo data, so IST is assumed. */
function instantAt(businessDate: string, time: string): string {
  return new Date(`${businessDate}T${time}:00+05:30`).toISOString()
}

export function createDemoStore(): DemoStore {
  // Resolved once, through the outlet's own cutover — never derived from a
  // timestamp later. A demo opened at 00:30 must show the evening it is still
  // part of, for exactly the reason business_date is a column.
  const today = resolveBusinessDate(new Date(), demoOutlet().business_day_cutover)
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
  ]

  const bills: Tables<'bills'>[] = []
  const billItems: Tables<'bill_items'>[] = []
  const billNumbers = new Map<string, number>()

  /**
   * A seed becomes a bill the way the counter makes one: line totals from the
   * menu item's price **snapshotted at the moment of sale**, bill totals from
   * the same domain function the screen uses, and a number taken from the
   * outlet's sequence in the order the bills were sent.
   */
  function materialise(seed: BillSeed, index: number) {
    const date = businessDate(seed.daysAgo)
    const createdAt = instantAt(date, seed.time)
    const billId = `d7000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`

    const lines = seed.lines.map((line) => {
      const item = menuItems.find((candidate) => candidate.id === line.menuItemId)
      if (!item) throw new Error(`No demo menu item: ${line.menuItemId}`)
      return { item, quantity: line.quantity }
    })

    const totals = billTotals(
      lines.map((line) => ({ unitPricePaise: line.item.price_paise, quantity: line.quantity })),
    )

    const nextNumber = (billNumbers.get(DEMO_OUTLET_ID) ?? 0) + 1
    billNumbers.set(DEMO_OUTLET_ID, nextNumber)

    bills.push({
      id: billId,
      outlet_id: DEMO_OUTLET_ID,
      bill_number: nextNumber,
      biller_profile_id: DEMO_BILLER_ID,
      counter_device_id: DEMO_COUNTER_DEVICE_ID,
      shift_id: DEMO_OPEN_SHIFT_ID,
      business_date: date,
      created_at: createdAt,
      // A bill that arrived after its day was closed reached the server the
      // next morning. `created_at` is when it was rung; `synced_at` is when it
      // landed, and the gap between them is the whole reconciliation problem.
      synced_at: seed.arrivedAfterClose ? instantAt(businessDate(seed.daysAgo - 1), '08:30') : createdAt,
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

  // Oldest first, so the numbering runs in the order the bills were sent.
  ;[...billSeeds]
    .sort((a, b) => b.daysAgo - a.daysAgo || a.time.localeCompare(b.time))
    .forEach(materialise)

  // ── Stock ────────────────────────────────────────────────────────────────

  const inventoryItems = structuredClone(inventoryItemFixtures)
  const inventoryMovements: Tables<'inventory_movements'>[] = movementSeeds.map((seed, index) => ({
    id: `da000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
    outlet_id: DEMO_OUTLET_ID,
    inventory_item_id: seed.itemId,
    movement_type: seed.movementType,
    quantity_delta: movementDelta(seed.movementType, seed.quantity),
    note: seed.note ?? null,
    business_date: businessDate(seed.daysAgo),
    created_at: instantAt(businessDate(seed.daysAgo), '10:00'),
    recorded_by: MANAGER_ID,
    unit_cost_paise: null,
  }))

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
    outlet_id: DEMO_OUTLET_ID,
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
    outlet_id: DEMO_OUTLET_ID,
    business_date: businessDate(seed.daysAgo),
    amount_paise: seed.amountPaise,
    reason: seed.reason ?? null,
    withdrawn_by: seed.withdrawnBy,
    recorded_by: MANAGER_ID,
    created_at: instantAt(businessDate(seed.daysAgo), seed.time),
  }))

  /**
   * Yesterday, closed — and closed with a mismatch.
   *
   * The figures are computed here from the same rows the surface derives from,
   * with **the late bill deliberately excluded**: it had not arrived when the
   * drawer was counted, and a closed day is a snapshot that nothing recomputes.
   * That exclusion is the entire reconciliation exception, and hard-coding these
   * numbers instead would produce a demo the real system could not reproduce.
   */
  const yesterday = businessDate(1)
  const closedCashSales = bills
    .filter(
      (bill) =>
        bill.business_date === yesterday &&
        bill.payment_method === 'cash' &&
        bill.status === 'settled' &&
        // Rung before the close; anything that landed afterwards is the
        // exception, not part of the signed-off figure.
        bill.synced_at <= instantAt(yesterday, '22:30'),
    )
    .reduce((running, bill) => running + bill.total_paise, 0)
  const closedCashExpenses = expenses
    .filter(
      (expense) => expense.business_date === yesterday && expense.payment_method === 'cash',
    )
    .reduce((running, expense) => running + expense.amount_paise, 0)
  const closedWithdrawn = withdrawals
    .filter((withdrawal) => withdrawal.business_date === yesterday)
    .reduce((running, withdrawal) => running + withdrawal.amount_paise, 0)

  const closedExpected = expectedClosingPaise({
    openingCashPaise: OPENING_CASH_PAISE,
    cashSalesPaise: closedCashSales,
    cashExpensesPaise: closedCashExpenses,
    cashWithdrawnPaise: closedWithdrawn,
  })
  const closedActual = closedExpected + YESTERDAY_MISCOUNT_PAISE

  const dailyCashRecords: Tables<'daily_cash_records'>[] = [
    {
      id: 'dd000000-0000-4000-a000-000000000001',
      outlet_id: DEMO_OUTLET_ID,
      business_date: yesterday,
      opening_cash_paise: OPENING_CASH_PAISE,
      cash_sales_paise: closedCashSales,
      cash_expenses_paise: closedCashExpenses,
      cash_withdrawn_paise: closedWithdrawn,
      expected_closing_paise: closedExpected,
      actual_closing_paise: closedActual,
      difference_paise: differencePaise(closedActual, closedExpected),
      notes: 'Counted twice. Short by the same amount both times.',
      closed_at: instantAt(yesterday, '22:30'),
      closed_by: MANAGER_ID,
    },
  ]

  return {
    today,
    businessDate,
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
    withdrawals,
    dailyCashRecords,
    openingCashPaise: OPENING_CASH_PAISE,
  }
}
