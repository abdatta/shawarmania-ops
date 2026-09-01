import {
  billTotals,
  instantOnBusinessDay,
  lineTotalPaise,
  normalizeCategory,
  resolveBusinessDate,
  shiftBusinessDate,
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
  DEMO_MORNING_SHIFT_ID,
  DEMO_MORNING_BILLER_ID,
  DEMO_OPEN_SHIFT_ID,
  type BillSeed,
} from './fixtures/billing'
import { manualLedgerDaySeeds, manualLedgerExpenseSeeds } from './fixtures/retirement-history'
import { menuCategoryFixtures, menuItemFixtures } from './fixtures/menu'
import { expenseSeeds, OPENING_CASH_PAISE } from './fixtures/operations'
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
 * Ledger's figures must be the rows the other surfaces wrote. Anyone looking at
 * two screens in a row notices figures that do not correspond, which is the
 * classic way a demo stops being convincing (docs/DEMO_MODE.md).
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
  /**
   * Owned by the billing adapter, and **the live shift table rather than the
   * retired one**.
   *
   * `public.shifts` is the pre-tablet model. Since the billing transaction
   * contract, `bills.shift_id` "points at the retired pre-tablet shift model and
   * remains only for synthetic demo history", and every counter write goes
   * through the command RPC under `counter_shift_id`. A demo built on the old
   * table cannot express `expires_at` or `ended_reason`, so it can show neither a
   * shift reaching the outlet's cutover nor a deliberately finished day — and it
   * was putting its own ids into command columns that reference this table,
   * which production's foreign keys would refuse.
   */
  shifts: Tables<'counter_shifts'>[]
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
  /** Owned by the expenses adapter and read by the drawer, ledger and insights. */
  expenses: Tables<'expenses'>[]
  /** Business-wide suggestions, shared by both expense records. */
  expenseCategories: Tables<'expense_categories'>[]
  /** Owner curation history. */
  expenseCategoryOperations: Tables<'expense_category_operations'>[]
  /** What was in the drawer when the day started. `cash-is-counted-not-closed`
   *  (#11) replaces this with a per-outlet opening anchor, after which every
   *  opening is the previous observation's carry-forward. */
  readonly openingCashPaise: number
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

function outletById(id: string) {
  const outlet = outletFixtures.find((candidate) => candidate.id === id)
  if (!outlet) throw new Error(`The demo outlet fixture ${id} is missing.`)
  return outlet
}

/** `19:24` on a business date, as an instant. Demo data, so IST is assumed. */
function instantAt(businessDate: string, time: string): string {
  return new Date(`${businessDate}T${time}:00+05:30`).toISOString()
}

/**
 * When a shift opened on `businessDate` expires — the outlet's own cutover on
 * the following calendar day.
 *
 * This is `app_next_cutover` in TypeScript, deliberately: the database computes
 * `((app_business_date(ts, cutover) + 1)::timestamp + cutover) at time zone
 * 'Asia/Kolkata'`, and a demo that expired its shifts by any other arithmetic
 * would be demonstrating a rule the real counter does not follow.
 *
 * Exported because the handshake opens shifts too, and a second copy of this sum
 * is how the seeded shift and a confirmed one would drift apart.
 */
export function nextCutover(businessDate: string, outletId: string): string {
  const cutover = outletById(outletId).business_day_cutover
  return instantOnBusinessDay(shiftBusinessDate(businessDate, 1), cutover, cutover)
}

/**
 * The same instant, or now, whichever is earlier.
 *
 * The seeds describe a whole trading day whatever time the demo is opened, so a
 * row on today's business date can carry a time that has not arrived. Readers
 * that filter by `business_date` never noticed; the drawer reads by instant and
 * correctly ignores money not yet taken, and the two then disagree about the same
 * cash. Production cannot produce a future instant at all.
 */
function notLaterThanNow(instant: string): string {
  const now = new Date().toISOString()
  return instant > now ? now : instant
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

  const shifts: Tables<'counter_shifts'>[] = [
    {
      id: DEMO_OPEN_SHIFT_ID,
      outlet_id: DEMO_OUTLET_ID,
      person_id: DEMO_BILLER_ID,
      device_id: DEMO_COUNTER_DEVICE_ID,
      business_date: today,
      opened_at: instantAt(today, '11:00'),
      // Resolved the way `app_next_cutover` resolves it, so a demo opened at
      // 00:30 holds a shift that expires at the cutover it is still short of
      // rather than one that expired before the walkthrough began.
      expires_at: nextCutover(today, DEMO_OUTLET_ID),
      // Open on arrival: the counter's gate is ringing and settling an order,
      // and a walkthrough should land able to do it rather than at the request
      // screen. Ending it, handing over and finishing the day are all walkable
      // from there, and reset puts this back.
      ended_at: null,
      ended_reason: null,
    },
    {
      // **The morning operator, who left from their phone at 11:00.**
      //
      // Ended the ordinary way — `operator` — at the same instant Priya's shift
      // opens, which is what a handover looks like in the data. It exists so the
      // demo can hold an after-departure attribution exception that is actually
      // true: the flag says a sale was recorded after its operator left, and
      // that needs an operator who left.
      id: DEMO_MORNING_SHIFT_ID,
      outlet_id: DEMO_OUTLET_ID,
      person_id: DEMO_MORNING_BILLER_ID,
      device_id: DEMO_COUNTER_DEVICE_ID,
      business_date: today,
      opened_at: instantAt(today, '07:00'),
      expires_at: nextCutover(today, DEMO_OUTLET_ID),
      ended_at: instantAt(today, '11:00'),
      ended_reason: 'operator',
    },
    {
      // Kanchrapara's, ended. Its bills need a shift to be attributed to, and
      // nobody is standing at that counter during a demo — an open shift at an
      // outlet no persona occupies would be a second counter the walkthrough
      // never reaches. It ended the ordinary way, which is what `operator` says.
      id: DEMO_KANCHRAPARA_SHIFT_ID,
      outlet_id: DEMO_SECOND_OUTLET_ID,
      person_id: DEMO_KANCHRAPARA_BILLER_ID,
      device_id: DEMO_KANCHRAPARA_DEVICE_ID,
      business_date: today,
      opened_at: instantAt(today, '11:00'),
      expires_at: nextCutover(today, DEMO_SECOND_OUTLET_ID),
      ended_at: instantAt(today, '21:30'),
      ended_reason: 'operator',
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
      // The departed operator, never the one who came next. A flagged bill that
      // read "by Demo Biller" would be demonstrating the exact inheritance the
      // after-departure contract exists to prevent.
      biller_profile_id: seed.recordedAfterDeparture
        ? DEMO_MORNING_BILLER_ID
        : billerForOutlet(outletId),
      counter_device_id: deviceForOutlet(outletId),
      // As production writes them: the live counter shift, and nothing in the
      // retired column. Every demo bill is within four days of today, so none of
      // them is the pre-tablet history `shift_id` was left alive to hold.
      shift_id: null,
      // A sale the tablet captured in the gap after a remote departure stays
      // under the shift that was live when the tablet last knew — never under
      // the operator who came next.
      counter_shift_id: seed.recordedAfterDeparture
        ? DEMO_MORNING_SHIFT_ID
        : shiftForOutlet(outletId),
      order_id: null,
      business_date: date,
      created_at: createdAt,
      ordered_at: createdAt,
      paid_at: createdAt,
      payment_business_date: date,
      recorded_after_shift_end: seed.recordedAfterDeparture === true,
      attribution_shift_ended_at: seed.recordedAfterDeparture ? instantAt(date, '11:00') : null,
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
   * **Nothing in the demo may claim to have happened later than now.**
   *
   * The seeds describe a whole trading evening on today's business date — bills
   * out to 20:40 — and the fixture stamps them at those times whatever the clock
   * says. That was invisible while every reader filtered by `business_date`:
   * Billing history counted all nine of today's bills either way.
   *
   * The drawer reads by **instant**, and it was right to exclude a bill stamped
   * two hours from now, because cash that has not been taken is not in the
   * drawer. So the two surfaces disagreed by ₹2,130 — Billing showing ₹3,711 of
   * cash today against the drawer's ₹1,899 since the last count — and the drawer
   * was the honest one.
   *
   * Production cannot produce this: `pay_billing_order` bounds `paid_at` to
   * within 300 seconds of the command's own `created_at`. So the fixture is what
   * is wrong, and this is where it stops being wrong.
   *
   * Rows already in the past are untouched. A row from the future is pulled back
   * to just before now, keeping seed order and staying distinct, so a bill still
   * follows the bill before it.
   */
  const clampFutureInstants = () => {
    const nowMs = Date.now()
    const future = bills
      .filter((bill) => Date.parse(bill.paid_at ?? bill.created_at) > nowMs)
      .sort((a, b) => (a.paid_at ?? a.created_at).localeCompare(b.paid_at ?? b.created_at))

    // Latest first, so the last seeded bill lands closest to now and the order
    // the seeds describe survives the move.
    future.reverse().forEach((bill, offset) => {
      const at = new Date(nowMs - (offset + 1) * 60_000).toISOString()
      const syncedLater = bill.synced_at > (bill.paid_at ?? bill.created_at)
      bill.created_at = at
      bill.ordered_at = at
      bill.paid_at = at
      // A bill that arrived late keeps its own arrival instant; every other one
      // landed when it was rung, and `synced_at` before `paid_at` would be a
      // bill delivered before it existed.
      if (!syncedLater) bill.synced_at = at
    })
  }
  clampFutureInstants()

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
    recorded_after_shift_end: false,
    attribution_shift_ended_at: null,
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

  // ── Expenses and the drawer ──────────────────────────────────────────────

  const expenses: Tables<'expenses'>[] = expenseSeeds.map((seed, index) => ({
    id: `db000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
    outlet_id: seed.outletId ?? DEMO_OUTLET_ID,
    business_date: businessDate(seed.daysAgo),
    category: seed.category,
    amount_paise: seed.amountPaise,
    is_cash: seed.paymentMethod === 'cash',
    description: seed.description ?? null,
    created_at: notLaterThanNow(instantAt(businessDate(seed.daysAgo), seed.time)),
    // The fixture knows the time, so it states it. That is what puts a demo
    // expense on one side or the other of a mid-day count rather than leaving
    // the drawer to fall back on when the row was written (#11).
    //
    // Clamped for the reason the bills are: an expense stamped later this evening
    // is counted by every reader that filters on `business_date` and correctly
    // ignored by the drawer, which reads by instant — and two surfaces
    // disagreeing about the same money is how a demo stops being believed.
    occurred_at: notLaterThanNow(instantAt(businessDate(seed.daysAgo), seed.time)),
    recorded_by: MANAGER_ID,
    recorded_away: false,
    shared_cost: false,
    source_system: null,
    source_ref: null,
    updated_at: notLaterThanNow(instantAt(businessDate(seed.daysAgo), seed.time)),
    updated_by: null,
    voided_at: null,
    voided_by: null,
    voided_reason: null,
  }))

  // The richer expense history that used to be the notebook's expense half is
  // now part of the one promoted expense record.
  const promotedExpenseSeeds: Tables<'expenses'>[] = manualLedgerExpenseSeeds.map(
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
  expenses.push(...promotedExpenseSeeds)

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
      // **Null, because that is what production holds.** The runner does not
      // send `as_of_at`, so every real row has it empty and the freshness
      // stamp falls back to `updated_at`. Seeding it here once hid exactly
      // that: the chip rendered on the demo and on nothing real. The settled
      // day below sets it, so both branches stay demonstrable.
      as_of_at: null as string | null,
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
        // The one row whose operator statement carried its own currency, so
        // the demo walks the preferred branch as well as the fallback.
        as_of_at: instantAt(businessDate(daysAgo), '23:00'),
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
  for (const row of expenses) {
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

  // -- The drawer (#11) -----------------------------------------------------
  //
  // **Every derived figure here is computed from this store's own bills,
  // expenses and cash movements, exactly as the adapter computes them.** The
  // first version hardcoded round numbers from `design.md`'s worked example and
  // three of the four observations disagreed with the bills the same demo shows
  // in Billing and in the Ledger — one by ₹45,366. It also reported an
  // opening-chain break of ₹354 that nobody had designed: an artefact of every
  // observation storing the same opening instead of chaining from the count
  // before it.
  //
  // So only two things are chosen by hand: **when** each count happened, and
  // **how far out** it was. Everything else is derived, which is what makes the
  // figures on this page agree with the figures two screens away. The drift check
  // below re-derives them and throws if they ever stop agreeing.

  const drawerObs = (n: number) => `dc000000-0000-4000-a000-${String(n).padStart(12, '0')}`
  const drawerOut = (n: number) => `dd000000-0000-4000-a000-${String(n).padStart(12, '0')}`

  /** Cash actually received in `(from, to]`, from the latest effective allocations. */
  const drawerCashIn = (from: string | null, to: string): number => {
    let total = 0
    for (const bill of bills) {
      if (bill.outlet_id !== DEMO_OUTLET_ID || bill.status !== 'settled') continue
      const at = bill.paid_at ?? bill.created_at
      // Half-open at the start, closed at the end (design D2).
      if ((from !== null && at <= from) || at > to) continue
      total += (billPayments.get(bill.id) ?? [])
        .filter((allocation) => allocation.method === 'cash')
        .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
    }
    return total
  }

  /** Cash expenses in `(from, to]`, by occurrence instant. */
  const drawerCashExpenses = (from: string | null, to: string): number =>
    expenses
      .filter((row) => row.outlet_id === DEMO_OUTLET_ID && row.is_cash)
      .filter((row) => {
        const at = row.occurred_at ?? row.created_at
        return (from === null || at > from) && at <= to
      })
      .reduce((sum, row) => sum + row.amount_paise, 0)

  const drawerObservations: Tables<'drawer_observations'>[] = []
  const drawerCashOut: Tables<'drawer_cash_out'>[] = []

  /**
   * The counts, as *decisions* rather than as figures.
   *
   * `outBy` is how far the drawer was from what the arithmetic expected, so the
   * state each row demonstrates survives any change to the bills around it:
   * nought matches, a negative is short, a positive is over.
   */
  const countPlan = [
    // The first ordinary count follows the carried notebook anchor below.
    { daysAgo: 4, time: '22:30', outBy: 0, collectPaise: 0 },
    // An ordinary night that balanced, with a collection taken off the top. The
    // drawer stays deliberately stocked: the last night of this month pays
    // ₹14,500 of wages in cash, and a drawer emptied here could not.
    { daysAgo: 3, time: '22:20', outBy: 0, collectPaise: 50000 },
    // Counted at 22:15 and typed at 23:04 — approximate, recorded away, and
    // genuinely short. Nothing explains it, which is the case the surface must
    // refuse to explain away.
    {
      daysAgo: 2,
      time: '22:15',
      recordedTime: '23:04',
      outBy: -50000,
      collectPaise: 40000,
      onSite: false,
      awayReason: 'counted at the counter, entered after getting home',
    },
    // A thin drawer topped up: the collection is NEGATIVE, which is cash added.
    // Same table, same kind, no reason — the sign is the whole difference.
    //
    // It also carries the one note in the month, which is what a note is for:
    // recording what the counter found without claiming it explains the ₹200.
    // The carried row used to hold the only note here, and its note in
    // production is the notebook's own — usually nothing.
    {
      daysAgo: 1,
      time: '22:00',
      outBy: -20000,
      collectPaise: -100000,
      note: 'Counted twice. Two ₹100 notes short both times.',
    },
  ] as const

  // A spend, on the carried legacy day and so before the first interval the
  // drawer settles. It sits in no settled interval's arithmetic and demonstrates
  // only what it is for: drawer cash that bought something and stays out of the
  // month's operating figure. It moved back a day when the carried notebook
  // count became the anchor; left where it was it would have landed inside the
  // first settled interval and needed a ₹65,000 drawer to survive.
  drawerCashOut.push({
    id: drawerOut(90),
    outlet_id: DEMO_OUTLET_ID,
    kind: 'spend',
    amount_paise: 4000000,
    occurred_at: instantAt(businessDate(7), '18:40'),
    recorded_by: MANAGER_ID,
    observation_id: null,
    reason: 'Chest freezer for the prep counter',
    recorded_lat: null,
    recorded_lng: null,
    recorded_accuracy_m: null,
    recorded_distance_m: null,
    recorded_on_site: true,
    away_reason: null,
    created_at: instantAt(businessDate(7), '18:40'),
  })

  // A date before the demo's first bill, carried through the same observation
  // reader as yesterday. The source recorded the business date and the count,
  // never an hour, so the surface shows that date and no time of day. **The
  // boundary instant below is storage machinery and is a day later than the
  // business date by construction** — the reader resolves the date through the
  // outlet's cutover rather than formatting this, which is what keeps a carried
  // row off by nothing instead of off by one.
  const legacyBoundary = new Date(
    new Date(`${businessDate(6)}T04:00:00+05:30`).getTime() - 1,
  ).toISOString()
  drawerObservations.push({
    id: drawerObs(0),
    outlet_id: DEMO_OUTLET_ID,
    counted_at: legacyBoundary,
    recorded_at: legacyBoundary,
    is_anchor: true,
    is_legacy_imprecise: true,
    opening_paise: null,
    expected_paise: null,
    difference_paise: null,
    // The notebook's last count, in the same family as the rest of its demo
    // month (₹15,000 to ₹25,700). It has to carry the drawer through the days
    // that follow, whose cash expenses now sit in this same record: the last of
    // them pays ₹14,500 of wages in cash, which a ₹1,450 drawer could not.
    counted_total_paise: 2_570_000,
    is_approximate: false,
    tolerance_minutes: 0,
    recorded_by: MANAGER_ID,
    corrected_by: null,
    recorded_lat: null,
    recorded_lng: null,
    recorded_accuracy_m: null,
    recorded_distance_m: null,
    recorded_on_site: false,
    away_reason: 'Carried from the manual ledger; recording location and hour were not captured.',
    // Null, like almost every carried row in production: the notebook's own note
    // is what lands here, and the date is on the row itself now.
    note: null,
    created_at: legacyBoundary,
    updated_at: legacyBoundary,
  })

  countPlan.forEach((plan, index) => {
    const countedAt = instantAt(businessDate(plan.daysAgo), plan.time)
    const recordedTime = 'recordedTime' in plan ? plan.recordedTime : undefined
    const recordedAt = instantAt(businessDate(plan.daysAgo), recordedTime ?? plan.time)
    // The carried notebook count is seeded above and is the anchor, so every
    // plan below opens on the one before it. There is no anchor branch here any
    // more: the books open at the notebook's last count, not at the first count
    // this app took.
    const previous = drawerObservations.at(-1)
    if (!previous) {
      throw new Error('Demo fixture drift: the carried notebook count must be seeded first.')
    }

    // `next opening = counted − that observation's OWN cash out` (design D3),
    // read from the link rather than a time window.
    const openingPaise =
      previous.counted_total_paise -
      drawerCashOut
        .filter((movement) => movement.observation_id === previous.id)
        .reduce((sum, movement) => sum + movement.amount_paise, 0)

    // The previous observation's own cash out is already inside `openingPaise`,
    // and this observation's own collection does not exist yet — which is the
    // same rule the drift check below has to state explicitly: an observation's
    // own cash out is in neither its expected total nor its counted total.
    const cashOutInInterval = drawerCashOut
      .filter((movement) => movement.observation_id !== previous.id)
      .filter(
        (movement) =>
          movement.occurred_at > previous.counted_at && movement.occurred_at <= countedAt,
      )
      .reduce((sum, movement) => sum + movement.amount_paise, 0)

    const expectedPaise =
      openingPaise +
      drawerCashIn(previous.counted_at, countedAt) -
      drawerCashExpenses(previous.counted_at, countedAt) -
      cashOutInInterval

    const countedPaise = expectedPaise + plan.outBy

    const id = drawerObs(index + 1)
    drawerObservations.push({
      id,
      outlet_id: DEMO_OUTLET_ID,
      counted_at: countedAt,
      recorded_at: recordedAt,
      is_anchor: false,
      is_legacy_imprecise: false,
      opening_paise: openingPaise,
      expected_paise: expectedPaise,
      difference_paise: countedPaise - expectedPaise,
      counted_total_paise: countedPaise,
      is_approximate: recordedTime !== undefined,
      tolerance_minutes: 15,
      recorded_by: MANAGER_ID,
      corrected_by: null,
      recorded_lat: null,
      recorded_lng: null,
      recorded_accuracy_m: null,
      recorded_distance_m: null,
      recorded_on_site: 'onSite' in plan ? plan.onSite : true,
      away_reason: 'awayReason' in plan ? plan.awayReason : null,
      note: 'note' in plan ? plan.note : null,
      created_at: recordedAt,
      updated_at: recordedAt,
    })

    if (plan.collectPaise !== 0) {
      drawerCashOut.push({
        id: drawerOut(index + 1),
        outlet_id: DEMO_OUTLET_ID,
        kind: 'collection',
        amount_paise: plan.collectPaise,
        occurred_at: countedAt,
        recorded_by: MANAGER_ID,
        observation_id: id,
        reason: null,
        recorded_lat: null,
        recorded_lng: null,
        recorded_accuracy_m: null,
        recorded_distance_m: null,
        recorded_on_site: 'onSite' in plan ? plan.onSite : true,
        away_reason: 'awayReason' in plan ? plan.awayReason : null,
        created_at: countedAt,
      })
    }
  })

  // The newest observation demonstrates the light-touch correction path: a
  // manager entered it, then the owner fixed the figure before anything later
  // could anchor on it. There is deliberately no old-value trail for this
  // path; the corrected_by attribution is the only durable evidence that a
  // different account last touched the row.
  const newestDrawerObservation = drawerObservations.at(-1)
  if (!newestDrawerObservation) throw new Error('Demo fixture drift: no drawer observation exists.')
  newestDrawerObservation.corrected_by = OWNER_ID
  newestDrawerObservation.updated_at = instantAt(businessDate(1), '22:12')

  // An older observation demonstrates the load-bearing correction path. The
  // observation remains unchanged so later openings keep their original
  // anchor; the separate row is what the surface reads as correction history.
  const adjustedDrawerObservation = drawerObservations.find((row) => row.id === drawerObs(2))
  if (!adjustedDrawerObservation) {
    throw new Error('Demo fixture drift: adjustment target observation is missing.')
  }
  const drawerObservationAdjustments: Tables<'drawer_observation_adjustments'>[] = [
    {
      id: 'de000000-0000-4000-a000-000000000001',
      observation_id: adjustedDrawerObservation.id,
      outlet_id: DEMO_OUTLET_ID,
      original_counted_total_paise: adjustedDrawerObservation.counted_total_paise,
      corrected_counted_total_paise: adjustedDrawerObservation.counted_total_paise + 20_000,
      reason: 'Recounted after finding a ₹200 note',
      adjusted_by: OWNER_ID,
      adjusted_at: instantAt(businessDate(2), '09:20'),
    },
  ]
  // The live command records the same last-correcting account on the
  // observation after appending the immutable adjustment row. Keep demo data
  // shaped like that result so every reader sees one correction story.
  adjustedDrawerObservation.corrected_by = OWNER_ID

  /**
   * The drift check, mirroring the manual ledger's.
   *
   * The figures above are derived, so this can only fail if somebody edits a
   * derived column by hand or changes a bill without re-deriving. That is
   * precisely the failure worth catching loudly: a demo whose drawer disagrees
   * with its own bills is a demo that stops being believed, and a silent ₹45,366
   * is how that happens.
   */
  drawerObservations.forEach((row, index) => {
    const previous = drawerObservations[index - 1]
    if (row.is_anchor || !previous) {
      if (row.opening_paise !== null || row.expected_paise !== null) {
        throw new Error('Demo fixture drift: an anchor observation carries arithmetic.')
      }
      return
    }

    const ownOfPrevious = drawerCashOut
      .filter((movement) => movement.observation_id === previous.id)
      .reduce((sum, movement) => sum + movement.amount_paise, 0)
    const opening = previous.counted_total_paise - ownOfPrevious
    if (opening !== row.opening_paise) {
      throw new Error(
        `Demo fixture drift: ${row.counted_at} opens at ${row.opening_paise} but ` +
          `${previous.counted_at} carries ${opening}. Fix the fixture, not this check.`,
      )
    }

    // **Neither observation's own cash out belongs in this term.** The previous
    // one's is already in the opening, and THIS one's is in neither its expected
    // total nor its counted total — it reduces the next opening instead. Missing
    // the second exclusion is what made this check disagree with the generation
    // above by exactly one collection.
    const cashOutInInterval = drawerCashOut
      .filter(
        (movement) => movement.observation_id !== previous.id && movement.observation_id !== row.id,
      )
      .filter(
        (movement) =>
          movement.occurred_at > previous.counted_at && movement.occurred_at <= row.counted_at,
      )
      .reduce((sum, movement) => sum + movement.amount_paise, 0)
    const expected =
      opening +
      drawerCashIn(previous.counted_at, row.counted_at) -
      drawerCashExpenses(previous.counted_at, row.counted_at) -
      cashOutInInterval

    if (expected !== row.expected_paise) {
      throw new Error(
        `Demo fixture drift: ${row.counted_at} expects ${row.expected_paise} but the store's ` +
          `own bills, expenses and cash movements come to ${expected}.`,
      )
    }
    if (row.difference_paise !== row.counted_total_paise - expected) {
      throw new Error(`Demo fixture drift: ${row.counted_at} difference is not counted − expected.`)
    }
  })

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
    expenses,
    expenseCategories,
    expenseCategoryOperations,
    openingCashPaise: OPENING_CASH_PAISE,
    aggregatorChannelDays,
    drawerObservations,
    drawerCashOut,
    drawerObservationAdjustments,
    ledgerDayVerifications,
    drawerAcknowledgements: [],
  }
}
