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
import type { BillDraft, PaymentAllocation } from '../adapters'
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
  DEMO_MORNING_BILLER_ID,
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
  /** Exact tender allocation for each bill, including split payments. */
  billPayments: Map<string, PaymentAllocation[]>
  /**
   * Tender held against a paid order that has no bill yet — the upfront payer
   * whose food is still being made. It becomes `billPayments` when preparation
   * settles the order, and is discarded by an Un-pay.
   */
  orderPayments: Map<string, { payments: PaymentAllocation[]; paidAt: string; shiftId: string }>
  /** Owned by the billing adapter; open, paid and cancelled lifecycle records. */
  orders: Tables<'orders'>[]
  /** Immutable snapshots belonging to `orders`. */
  orderItems: Tables<'order_items'>[]
  /** Per-outlet, per-business-date order-number counters. */
  orderNumbers: Map<string, number>
  /** Server-side command metadata used by read-only manager diagnostics. */
  billingCommands: Tables<'billing_commands'>[]
  /** Local-only accepted payments that have no server bill number yet. */
  billingQueueSeeds: BillDraft[]
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
  /** What was in the drawer when the day started. `cash-is-counted-not-closed`
   *  (#11) replaces this with a per-outlet opening anchor, after which every
   *  opening is the previous observation's carry-forward. */
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
  /**
   * A channel's measured figures, on their own table so a figure can exist for a
   * date with no day row. Written only by the sync in production; the mock seeds
   * them and the form never writes them.
   */
  aggregatorChannelDays: Tables<'aggregator_channel_days'>[]
  /**
   * The drawer as a continuous balance (#11). Session-scoped like every other
   * slice, so recording a count as the manager and reading it as the owner is
   * one demo rather than two.
   *
   * The fixture deliberately reaches the states the surface has to render
   * differently: an anchor carrying no arithmetic at all, an ordinary night that
   * balanced, an approximate count whose difference exactly matches a run of cash
   * bills, a genuine shortfall that matches nothing, a negative collection (cash
   * added to a thin drawer), and a spend that stays out of the month's operating
   * expenses.
   */
  drawerObservations: Tables<'drawer_observations'>[]
  drawerCashOut: Tables<'drawer_cash_out'>[]
  drawerObservationAdjustments: Tables<'drawer_observation_adjustments'>[]
  ledgerDayVerifications: Tables<'ledger_day_verifications'>[]
  drawerAcknowledgements: Tables<'drawer_reconciliation_acknowledgements'>[]
}

/** The outlet every demo persona but the owner belongs to. */
export const DEMO_OUTLET_ID = OUTLET_KALYANI_ID

/** The second outlet, which exists to be compared against rather than walked. */
export const DEMO_SECOND_OUTLET_ID = OUTLET_KANCHRAPARA_ID

/** Whoever recorded the demo's operational rows. A manager, as it would be. */
const MANAGER_ID = personaFixtures.franchise_admin.profile.id

/** Whoever wrote the manual ledger's day rows. Owners and managers only. */
const OWNER_ID = personaFixtures.super_admin.profile.id

/**
 * Who a ledger expense seed can be attributed to.
 *
 * All four, because `the-ledger-opens-to-the-outlet` made the expense list a
 * thing several people write into, and a demo where every row names the owner
 * would not show what the surface is now for: seeing at a glance which rows are
 * yours to fix.
 */
const LEDGER_RECORDERS: Record<'owner' | 'manager' | 'biller' | 'employee', string> = {
  owner: OWNER_ID,
  manager: MANAGER_ID,
  biller: personaFixtures.biller.profile.id,
  employee: personaFixtures.employee.profile.id,
}

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

export function createDemoStore(options: { billingLifecycle?: boolean } = {}): DemoStore {
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
  const billPayments = new Map<string, PaymentAllocation[]>()
  const orderPayments = new Map<
    string,
    { payments: PaymentAllocation[]; paidAt: string; shiftId: string }
  >()
  const billNumbers = new Map<string, number>()
  const orders: Tables<'orders'>[] = []
  const orderItems: Tables<'order_items'>[] = []
  const orderNumbers = new Map<string, number>()
  const billingCommands: Tables<'billing_commands'>[] = []
  const billingQueueSeeds: BillDraft[] = []

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
      counter_shift_id: null,
      order_id: null,
      business_date: date,
      created_at: createdAt,
      ordered_at: createdAt,
      paid_at: createdAt,
      payment_business_date: date,
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
      void_kind: null,
      void_reason: null,
      voided_at: null,
      voided_by: null,
    })
    billPayments.set(billId, [{ method: seed.paymentMethod, amountPaise: totals.totalPaise }])

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

  // Three existing sales become lifecycle examples without inventing extra
  // revenue: paid on handover, aggregator rider collection, and direct pay.
  // A cancelled and an open order add the two non-revenue states. The two paid
  // orders carry prepared_at — they were fired, made and handed over — while
  // the open one, 105, is still preparing. 104 was taken by the morning
  // biller before the handover and has been prepared but never paid: it shows
  // the Unpaid Prepared section with a creator who is not the current shift
  // holder, which is exactly the cross-person state the rail must read well.
  const lifecycleBills = bills
    .filter((bill) => bill.outlet_id === DEMO_OUTLET_ID && bill.business_date === today)
    .slice(2, 4)
  const lifecycle: Array<{
    status: Tables<'orders'>['status']
    bill: Tables<'bills'> | null
    reason?: string
    createdBy?: string
    preparedAtTime?: string | null
  }> = [
    { status: 'paid', bill: lifecycleBills[0] ?? null },
    { status: 'paid', bill: lifecycleBills[1] ?? null },
    { status: 'cancelled', bill: null, reason: 'Customer changed their mind' },
    {
      status: 'open',
      bill: null,
      createdBy: DEMO_MORNING_BILLER_ID,
      preparedAtTime: '18:45',
    },
    { status: 'open', bill: null, preparedAtTime: null },
  ]
  lifecycle.forEach((seed, index) => {
    const number = index + 101
    const id = `e2000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
    const sourceBill = seed.bill
    const sourceLines = sourceBill
      ? billItems.filter((line) => line.bill_id === sourceBill.id)
      : billItems
          .filter(
            (line) => line.bill_id === bills.find((bill) => bill.outlet_id === DEMO_OUTLET_ID)?.id,
          )
          .slice(0, 1)
    const orderedAt =
      sourceBill?.ordered_at ??
      instantAt(today, index === 2 ? '18:15' : index === 3 ? '18:40' : '19:10')
    const totals = billTotals(
      sourceLines.map((line) => ({
        unitPricePaise: line.unit_price_paise,
        quantity: line.quantity,
      })),
    )
    const cancelled = seed.status === 'cancelled'
    const preparedAt =
      seed.preparedAtTime !== undefined
        ? seed.preparedAtTime === null
          ? null
          : instantAt(today, seed.preparedAtTime)
        : (sourceBill?.paid_at ?? null)
    orders.push({
      id,
      outlet_id: DEMO_OUTLET_ID,
      device_id: DEMO_COUNTER_DEVICE_ID,
      order_number: number,
      business_date: today,
      ordered_at: orderedAt,
      created_at: orderedAt,
      created_by: seed.createdBy ?? DEMO_BILLER_ID,
      created_shift_id: DEMO_OPEN_SHIFT_ID,
      changed_at: null,
      changed_by: null,
      changed_shift_id: null,
      customer_id: null,
      customer_name: sourceBill?.customer_name ?? (index === 3 ? 'Demo Customer' : null),
      customer_phone: sourceBill?.customer_phone ?? null,
      pricing_mode: 'no_tax',
      subtotal_paise: totals.subtotalPaise,
      discount_paise: 0,
      tax_paise: 0,
      total_paise: totals.totalPaise,
      prepared_at: preparedAt,
      status: seed.status,
      bill_id: sourceBill?.id ?? null,
      paid_at: sourceBill?.paid_at ?? null,
      paid_by: sourceBill ? DEMO_BILLER_ID : null,
      paid_shift_id: sourceBill ? DEMO_OPEN_SHIFT_ID : null,
      cancel_reason: seed.reason ?? null,
      cancelled_at: cancelled ? instantAt(today, '18:25') : null,
      cancelled_by: cancelled ? MANAGER_ID : null,
      cancelled_device_id: cancelled ? DEMO_COUNTER_DEVICE_ID : null,
      cancelled_shift_id: cancelled ? DEMO_OPEN_SHIFT_ID : null,
    })
    sourceLines.forEach((line, lineIndex) =>
      orderItems.push({
        id: `${id}-${lineIndex}`,
        order_id: id,
        menu_item_id: line.menu_item_id,
        item_name: line.item_name,
        unit_price_paise: line.unit_price_paise,
        quantity: line.quantity,
        line_total_paise: line.line_total_paise,
      }),
    )
    if (sourceBill) sourceBill.order_id = id
  })
  orderNumbers.set(`${DEMO_OUTLET_ID}:${today}`, 105)

  billingCommands.push({
    id: 'e3000000-0000-4000-a000-000000000001',
    outlet_id: DEMO_OUTLET_ID,
    device_id: DEMO_COUNTER_DEVICE_ID,
    shift_id: DEMO_OPEN_SHIFT_ID,
    actor_id: DEMO_BILLER_ID,
    business_date: today,
    payment_business_date: today,
    client_created_at: instantAt(today, '19:00'),
    received_at: instantAt(today, '19:01'),
    command_type: 'pay_now',
    payload_hash: 'demo-redacted',
    schema_version: 1,
    result_category: 'permanent_refusal',
    result: {},
    watermark: 1,
  })
  if (options.billingLifecycle) {
    const item = menuItems.find(
      (candidate) => candidate.outlet_id === DEMO_OUTLET_ID && candidate.is_available,
    )
    if (!item) throw new Error('The demo billing queue needs one available menu item.')
    billingQueueSeeds.push({
      clientId: 'e4000000-0000-4000-a000-000000000001',
      outletId: DEMO_OUTLET_ID,
      shiftId: DEMO_OPEN_SHIFT_ID,
      businessDate: today,
      payments: [{ method: 'upi', amountPaise: item.price_paise }],
      lines: [
        { menuItemId: item.id, itemName: item.name, unitPricePaise: item.price_paise, quantity: 1 },
      ],
      customerName: null,
      customerPhone: null,
    })
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
    // The fixture knows the time, so it states it. That is what puts a demo
    // expense on one side or the other of a mid-day count rather than leaving
    // the drawer to fall back on when the row was written (#11).
    occurred_at: instantAt(businessDate(seed.daysAgo), seed.time),
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
              bill.status === 'settled' &&
              // Rung before the close; anything that landed afterwards is the
              // exception, not part of the signed-off figure.
              bill.synced_at <= closedAt,
          )
          .reduce(
            (running, bill) =>
              running +
              (
                billPayments.get(bill.id) ?? [
                  { method: bill.payment_method, amountPaise: bill.total_paise },
                ]
              )
                .filter((payment) => payment.method === 'cash')
                .reduce((sum, payment) => sum + payment.amountPaise, 0),
            0,
          )
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
      // A sourced supply row was recorded by nobody, exactly as production stores
      // it: the recorder is null when a source system is present.
      recorded_by: seed.sourceSystem ? null : LEDGER_RECORDERS[seed.recordedBy ?? 'owner'],
      // Stamped at insert by the guard, from the recorder's assignments as they
      // stood then. Declared on the seed rather than derived here — see the
      // fixture, where the reason is that the demo owner manages Kalyani and a
      // production owner manages nothing.
      recorded_away: seed.recordedAway ?? false,
      created_at: instantAt(businessDate(seed.daysAgo), seed.time),
      occurred_at: instantAt(businessDate(seed.daysAgo), seed.time),
      updated_at: instantAt(businessDate(seed.daysAgo), seed.time),
      updated_by: null,
      voided_at: seed.voidedAtTime
        ? instantAt(businessDate(seed.daysAgo), seed.voidedAtTime)
        : null,
      voided_by: seed.voidedAtTime ? LEDGER_RECORDERS[seed.recordedBy ?? 'owner'] : null,
      voided_reason: seed.voidedReason ?? null,
      // Most seeded rows are hand-entered; a Hyperpure row carries its statement
      // origin, so the walkthrough shows a supply cost that arrived on its own
      // beside the ones a person typed.
      source_system: seed.sourceSystem ?? null,
      source_ref: seed.sourceRef ?? null,
      shared_cost: seed.sharedCost ?? false,
    }),
  )

  /**
   * The settlement columns for one seeded day, chosen by how old it is.
   *
   * Deliberately covers every state the surface can show:
   *
   *   yesterday      **Daily** — read today, commission not stated until the week ends
   *   two days ago   **Settled** — the weekly payout statement, and it adds up
   *   three days ago **Disputed** — paid, and the figures do not add up to the payment
   *   older          **Typed** — the owner's own entry, which is the control
   *
   * The revised pair is set on the settled day only, so "this figure moved when the
   * week paid" is demonstrable rather than merely described. The superseded pair goes
   * with it: a synced day archives what the owner had typed before it was taken over.
   */
  /**
   * The measured figures for a seeded day, as a row on its own table.
   *
   * All four demonstrable states appear on purpose, assigned by age, so one
   * scroll of the walkthrough shows a day read today with its commission still
   * undetermined, a settled week that grew when it paid, a disputed week, and an
   * ordinary settled day. There is no "typed by the owner" state any more: typing
   * a Zomato figure is exactly what this change removed, so every figure here has
   * an origin that is not a person.
   */
  function figureFor(
    outletId: string,
    daysAgo: number,
    index: number,
    revenuePaise: number,
    commissionPaise: number | null,
  ): Tables<'aggregator_channel_days'> | null {
    const base = {
      id: `ac000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outlet_id: outletId,
      channel: 'zomato',
      business_date: businessDate(daysAgo),
      revenue_paise: revenuePaise,
      commission_paise: commissionPaise,
      net_paise:
        commissionPaise === null ? null : ((revenuePaise - commissionPaise) as number | null),
      source_ref: `cycle-${businessDate(daysAgo)}`,
      as_of_at: instantAt(businessDate(daysAgo), '23:00'),
      settlement_state: 'settled',
      origin: 'settlement',
      superseded_revenue_paise: null as number | null,
      superseded_commission_paise: null as number | null,
      superseded_at: null as string | null,
      provisional_revenue_paise: null as number | null,
      provisional_commission_paise: null as number | null,
      revised_at: null as string | null,
      created_at: instantAt(businessDate(daysAgo), '23:00'),
      updated_at: instantAt(businessDate(daysAgo), '23:00'),
    }

    if (daysAgo === 1) {
      // Read today: the revenue is exact and the commission is not stated yet.
      return {
        ...base,
        commission_paise: null,
        settlement_state: 'provisional',
        origin: 'daily_reader',
      }
    }
    if (daysAgo === 2) {
      return {
        ...base,
        // It grew when the week paid, which is the cancellation-refund case: an
        // order rejected after the kitchen cooked it is refunded a share and paid,
        // and the live figure never showed it.
        provisional_revenue_paise: revenuePaise - 7_915,
        provisional_commission_paise: commissionPaise,
        revised_at: new Date().toISOString(),
        superseded_revenue_paise: revenuePaise - 21_500,
        superseded_commission_paise: commissionPaise,
        superseded_at: new Date().toISOString(),
      }
    }
    if (daysAgo === 3) {
      return {
        ...base,
        settlement_state: 'disputed',
        superseded_revenue_paise: revenuePaise - 15_000,
        superseded_commission_paise: commissionPaise,
        superseded_at: new Date().toISOString(),
      }
    }
    return base
  }

  const manualLedgerDays: Tables<'manual_ledger_days'>[] = manualLedgerDaySeeds.map(
    (seed, index) => ({
      id: `dd000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outlet_id: DEMO_OUTLET_ID,
      business_date: businessDate(seed.daysAgo),
      opening_cash_paise: seed.openingCashPaise,
      cash_revenue_paise: seed.cashRevenuePaise,
      upi_revenue_paise: seed.upiRevenuePaise,
      cash_added_paise: seed.cashAddedPaise ?? 0,
      cash_added_reason: seed.cashAddedReason ?? null,
      cash_removed_paise: seed.cashRemovedPaise ?? 0,
      cash_removed_reason: seed.cashRemovedReason ?? null,
      counted_cash_paise: seed.countedCashPaise,
      note: seed.note ?? null,
      recorded_by: OWNER_ID,
      created_at: instantAt(businessDate(seed.daysAgo), '23:00'),
      updated_at: instantAt(businessDate(seed.daysAgo), '23:00'),
      // One day carries a manager's correction, so the "recorded by X, last
      // corrected by Y" reading appears in the walkthrough rather than only in a
      // test (design D6).
      updated_by: seed.correctedByManager ? MANAGER_ID : null,
    }),
  )

  // The measured figures, on their own table, keyed to the same dates. A day and
  // its figure are two rows now, so the "day nobody recorded" the sync writes has
  // somewhere to live and the drawer count is never invented to hold a figure.
  const aggregatorChannelDays: Tables<'aggregator_channel_days'>[] = manualLedgerDaySeeds
    .map((seed, index) =>
      figureFor(
        DEMO_OUTLET_ID,
        seed.daysAgo,
        index,
        seed.zomatoRevenuePaise,
        seed.zomatoCommissionPaise,
      ),
    )
    .filter((row): row is Tables<'aggregator_channel_days'> => row !== null)

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
    // A withdrawn expense stops counting, here as everywhere else. Leaving it in
    // would make the demo's drawer disagree with the surface reading it, which
    // is precisely the drift this guard exists to catch.
    const cashExpenses = manualLedgerExpenses
      .filter(
        (expense) =>
          expense.business_date === row.business_date &&
          expense.is_cash &&
          expense.voided_at === null,
      )
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

  // -- The drawer (#11) -----------------------------------------------------
  //
  // Four observations at the demo outlet, each earning its place by being a
  // state the surface renders differently. Built here rather than in a fixture
  // file because every instant is relative to `today`: a drawer whose counts sit
  // at fixed dates stops demonstrating a running balance the day after it is
  // written.

  const drawerObs = (n: number) => `dc000000-0000-4000-a000-${String(n).padStart(12, '0')}`
  const drawerOut = (n: number) => `dd000000-0000-4000-a000-${String(n).padStart(12, '0')}`

  const observation = (
    n: number,
    fields: {
      daysAgo: number
      time: string
      recordedTime?: string
      anchor?: boolean
      openingPaise?: number
      expectedPaise?: number
      countedPaise: number
      note?: string
      onSite?: boolean
      awayReason?: string
    },
  ): Tables<'drawer_observations'> => {
    const countedAt = instantAt(businessDate(fields.daysAgo), fields.time)
    const recordedAt = instantAt(businessDate(fields.daysAgo), fields.recordedTime ?? fields.time)
    const anchor = fields.anchor ?? false
    const expected = anchor ? null : (fields.expectedPaise ?? 0)
    return {
      id: drawerObs(n),
      outlet_id: DEMO_OUTLET_ID,
      counted_at: countedAt,
      recorded_at: recordedAt,
      is_anchor: anchor,
      // All three null together on the anchor, which has no interval at all.
      opening_paise: anchor ? null : (fields.openingPaise ?? 0),
      expected_paise: expected,
      difference_paise: expected === null ? null : fields.countedPaise - expected,
      counted_total_paise: fields.countedPaise,
      is_approximate: fields.recordedTime !== undefined,
      tolerance_minutes: 15,
      recorded_by: MANAGER_ID,
      corrected_by: null,
      recorded_lat: null,
      recorded_lng: null,
      recorded_accuracy_m: null,
      recorded_distance_m: null,
      recorded_on_site: fields.onSite ?? true,
      away_reason: fields.awayReason ?? null,
      note: fields.note ?? null,
      created_at: recordedAt,
      updated_at: recordedAt,
    }
  }

  const drawerObservations: Tables<'drawer_observations'>[] = [
    // 1. The anchor. No opening, no expected total, no difference — the drawer
    //    begins at what was counted, and the ledger marks every earlier date
    //    `not tracked yet` rather than inventing a balance for it.
    observation(1, {
      daysAgo: 4,
      time: '22:30',
      anchor: true,
      countedPaise: 145000,
      note: 'the books open here',
    }),
    // 2. An ordinary night that balanced, with a collection.
    observation(2, {
      daysAgo: 3,
      time: '22:20',
      openingPaise: 145000,
      expectedPaise: 895000,
      countedPaise: 895000,
    }),
    // 3. Counted at 22:15, typed at 23:04 — approximate, and 854 rupees short,
    //    which is exactly the three cash bills between 22:04 and 22:12. The
    //    surface reports that coincidence as a fact and proposes no instant.
    observation(3, {
      daysAgo: 2,
      time: '22:15',
      recordedTime: '23:04',
      openingPaise: 145000,
      expectedPaise: 895000,
      countedPaise: 809600,
      onSite: false,
      awayReason: 'counted at the counter, entered after getting home',
    }),
    // 4. A genuine 500 rupee shortfall, matching no run of bills. The surface
    //    says so and offers nothing.
    observation(4, {
      daysAgo: 1,
      time: '22:00',
      openingPaise: 145000,
      expectedPaise: 900000,
      countedPaise: 850000,
    }),
  ]

  const cashOutRow = (
    n: number,
    fields: {
      daysAgo: number
      time: string
      kind: 'collection' | 'spend'
      amountPaise: number
      observation?: number
      reason?: string
    },
  ): Tables<'drawer_cash_out'> => ({
    id: drawerOut(n),
    outlet_id: DEMO_OUTLET_ID,
    kind: fields.kind,
    amount_paise: fields.amountPaise,
    occurred_at: instantAt(businessDate(fields.daysAgo), fields.time),
    recorded_by: MANAGER_ID,
    observation_id: fields.observation ? drawerObs(fields.observation) : null,
    reason: fields.reason ?? null,
    recorded_lat: null,
    recorded_lng: null,
    recorded_accuracy_m: null,
    recorded_distance_m: null,
    recorded_on_site: true,
    away_reason: null,
    created_at: instantAt(businessDate(fields.daysAgo), fields.time),
  })

  const drawerCashOut: Tables<'drawer_cash_out'>[] = [
    cashOutRow(1, {
      daysAgo: 3,
      time: '22:20',
      kind: 'collection',
      amountPaise: 750000,
      observation: 2,
    }),
    cashOutRow(2, {
      daysAgo: 2,
      time: '22:15',
      kind: 'collection',
      amountPaise: 700000,
      observation: 3,
    }),
    // A NEGATIVE collection: the drawer was thin, so the collector put 1,000
    // rupees back rather than taking anything out. Same table, same kind, no
    // reason — the sign is the whole difference (design D5).
    cashOutRow(3, {
      daysAgo: 1,
      time: '22:00',
      kind: 'collection',
      amountPaise: -100000,
      observation: 4,
    }),
    // A spend: drawer cash that bought something. It moves the drawer and stays
    // out of the month's operating expenses, which is the entire reason it is not
    // an expense row.
    cashOutRow(4, {
      daysAgo: 2,
      time: '18:40',
      kind: 'spend',
      amountPaise: 4000000,
      reason: 'Chest freezer for the prep counter',
    }),
  ]

  const ledgerDayVerifications: Tables<'ledger_day_verifications'>[] = [
    {
      id: 'df000000-0000-4000-a000-000000000001',
      outlet_id: DEMO_OUTLET_ID,
      business_date: businessDate(3),
      verified_by: OWNER_ID,
      verified_at: instantAt(businessDate(2), '09:15'),
      note: 'checked against the counter',
    },
  ]

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
    billPayments,
    orderPayments,
    orders,
    orderItems,
    orderNumbers,
    billingCommands,
    billingQueueSeeds,
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
    aggregatorChannelDays,
    drawerObservations,
    drawerCashOut,
    drawerObservationAdjustments: [],
    ledgerDayVerifications,
    drawerAcknowledgements: [],
  }
}
