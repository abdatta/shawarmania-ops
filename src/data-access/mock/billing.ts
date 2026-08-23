import { billTotals, classifySync, lineTotalPaise, PAYMENT_EDIT_WINDOW_MS, provisionalToken } from '@/domain'

import {
  BillingActionError,
  BILLING_PAYMENT_METHODS,
  type BillDraft,
  type BillLineDraft,
  type BillingAdapter,
  type BillingAttentionItem,
  type BillingBill,
  type BillingOrder,
  type CounterBiller,
  type CounterShift,
  type CounterState,
  type PaymentAllocation,
  type QueuedBill,
  type SaveOrderInput,
} from '../adapters'
import type { Tables } from '../database.types'
import { liveAssignments } from '../adapters'
import { accountFixtures, assignmentFixtures } from './fixtures/accounts'

/**
 * Can this person hold a shift at this counter? A live `biller` assignment at
 * this outlet, which since multi-outlet-people is the question the database
 * asks too — `app_profile_has(biller_profile_id, 'biller', outlet_id)`.
 */
function billsAt(personId: string, outletId: string): boolean {
  return liveAssignments(assignmentFixtures[personId] ?? []).some(
    (assignment) => assignment.role === 'biller' && assignment.outletId === outletId,
  )
}
import {
  DEMO_BILLER_ID,
  DEMO_BILLER_PIN,
  DEMO_COUNTER_DEVICE_ID,
} from './fixtures/billing'
import { DEMO_OUTLET_ID, type DemoStore } from './store'

/**
 * The mock counter: an in-memory command queue that behaves the way the real
 * outbox is specified to, and is honest about being none of its durability.
 *
 * **Every tablet command queues uniformly** — save, revise, cancel, prepare,
 * un-pay, cancel-after-paid, pay-order and the direct bill alike — because that
 * is what the live adapter does at the IndexedDB boundary: the command becomes
 * durable locally, the screen sees its own effect immediately through a
 * projection over the queue, and the simulated ~400ms send is the only thing
 * that mints permanent rows and numbers.
 *
 * Four clauses of `openspec/specs/counter-billing/spec.md` are mirrored here on
 * purpose, each beside the sentence it comes from:
 *
 *  - a command's identity is its **client-generated UUID**, and the same id
 *    twice is refused rather than applied twice;
 *  - **numbers are assigned on delivery**, per outlet, sequentially — never by
 *    the accepting screen;
 *  - a **cancelled** order or bill consumes no number, so the sequence has no
 *    gap;
 *  - a settled bill is **append-only** apart from the two reasoned counter-kind
 *    unwinds, which stamp their structured kind at delivery exactly as the
 *    database does.
 *
 * Guards run at acceptance against the **projected** state — store rows plus
 * every not-yet-delivered command — so the demo cannot walk into a refusal
 * production enforces, even while a matching command is still in flight.
 */

/** How long a command takes to "reach the server" after local acceptance. */
const SEND_LATENCY_MS = 400

/** How often the state is re-emitted while anything waits, for the age-based escalation. */
const TICK_MS = 1000

function nameOf(profileId: string): string {
  return accountFixtures.find((account) => account.id === profileId)?.full_name ?? 'Unknown biller'
}

function toShift(row: Tables<'shifts'>): CounterShift {
  return {
    id: row.id,
    outletId: row.outlet_id,
    billerProfileId: row.biller_profile_id,
    billerName: nameOf(row.biller_profile_id),
    businessDate: row.business_date,
    openedAt: row.opened_at,
  }
}

/**
 * One accepted-but-undelivered tablet command: everything needed both to show
 * its effect before delivery and to apply it to the store once the simulated
 * send lands.
 */
interface PendingCommand {
  commandId: string
  type:
    | 'create_order'
    | 'revise_order'
    | 'cancel_order'
    | 'pay_order'
    | 'pay_now'
    | 'set_order_preparation'
    | 'void_order_payment'
    | 'cancel_paid_order'
  /** When the counter accepted it — drives ordering, windows and escalation. */
  acceptedAtMs: number
  /** Mutate the store. Runs once, at delivery. Numbers are spent here only. */
  apply: () => void
}

export interface MockBillingContext {
  role: 'super_admin' | 'franchise_admin' | 'biller' | 'employee'
  userId: string
  outletIds: readonly string[]
}

export function createMockBillingAdapter(
  store: DemoStore,
  context: MockBillingContext = {
    role: 'biller',
    userId: DEMO_BILLER_ID,
    outletIds: [store.shifts.find((shift) => shift.closed_at === null)?.outlet_id ?? ''],
  },
): BillingAdapter {
  const listeners = new Set<() => void>()
  const paymentCorrections = new Map<string, PaymentAllocation[][]>()
  /** When this tablet accepted a payment — the grace windows measure from here. */
  const acceptedPaymentTimes = new Map<string, number>()
  /** Undelivered commands by client id — the mock's stand-in for the outbox. */
  const pending = new Map<string, PendingCommand>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let tick: ReturnType<typeof setInterval> | null = null
  let paymentClockOffsetMs = 0
  const paymentNow = () => Date.now() + paymentClockOffsetMs

  /** Side-data the projections and deliveries need, keyed by command id. */
  const pendingPayNowDrafts = new Map<string, BillDraft>()
  const pendingOrderInputs = new Map<string, SaveOrderInput>()
  const pendingRevisions = new Map<string, { orderId: string; shiftId: string; input: SaveOrderInput }>()
  const pendingCancellations = new Map<string, { orderId: string; shiftId: string; reason: string }>()
  const pendingPreparations = new Map<string, { orderId: string; prepared: boolean }>()
  const pendingOrderPayments = new Map<
    string,
    {
      orderId: string
      shiftId: string
      billId: string
      payments: PaymentAllocation[]
      paidAt: string
      paymentBusinessDate: string
    }
  >()
  const pendingUnwinds = new Map<
    string,
    { orderId: string; billId: string; shiftId: string; reason: string }
  >()

  const sortedPending = () => [...pending.values()].sort((a, b) => a.acceptedAtMs - b.acceptedAtMs)

  function compareShiftBills(left: BillingBill, right: BillingBill) {
    const leftAcceptedAt = acceptedPaymentTimes.get(left.id)
    const rightAcceptedAt = acceptedPaymentTimes.get(right.id)
    if (leftAcceptedAt !== undefined || rightAcceptedAt !== undefined) {
      if (leftAcceptedAt === undefined) return 1
      if (rightAcceptedAt === undefined) return -1
      if (leftAcceptedAt !== rightAcceptedAt) return rightAcceptedAt - leftAcceptedAt
    }
    return right.paidAt.localeCompare(left.paidAt)
  }

  if (context.role === 'biller') {
    for (const seedDraft of store.billingQueueSeeds) {
      const draftCopy = structuredClone(seedDraft)
      // Seeded thirty seconds old: the queue a walkthrough arrives to find has
      // been waiting, and its indicator says so honestly. Deliberately **not**
      // registered in `acceptedPaymentTimes`: that map records payments this
      // session accepted, and a pre-session bill must not hold the day's
      // close-shift gate hostage to a window the walkthrough never opened.
      pending.set(draftCopy.clientId, {
        commandId: draftCopy.clientId,
        type: 'pay_now',
        acceptedAtMs: Date.now() - 30_000,
        apply: () => applyPayNow(draftCopy),
      })
      pendingPayNowDrafts.set(draftCopy.clientId, draftCopy)
    }
  }

  function openShiftRow(): Tables<'shifts'> | undefined {
    return store.shifts.find((row) => row.closed_at === null)
  }

  function buildSnapshot(): CounterState {
    // The queue holds what has **not** gone. A delivered command leaves it,
    // because by then its effect is a row in the store and an outbox that never
    // empties is not an outbox — it is a log with a misleading name.
    const waiting = sortedPending()
    // The chrome's queue card is about money waiting to land; other commands
    // count toward `pending` without pretending to be bills.
    const queuedBills: QueuedBill[] = waiting
      .filter((command) => command.type === 'pay_now')
      .map((command) => {
        const draft = pendingPayNowDrafts.get(command.commandId)
        return {
          clientId: command.commandId,
          totalPaise: draft
            ? billTotals(
                draft.lines.map((line) => ({
                  unitPricePaise: line.unitPricePaise,
                  quantity: line.quantity,
                })),
              ).totalPaise
            : 0,
          businessDate: draft?.businessDate ?? store.today,
          queuedAt: command.acceptedAtMs,
        }
      })
      .sort((a, b) => a.queuedAt - b.queuedAt)
    const row = openShiftRow()

    return {
      shift: row ? toShift(row) : null,
      queued: queuedBills,
      sync: {
        pending: waiting.length,
        kind: classifySync({
          pending: waiting.length,
          oldestQueuedAt: waiting[0]?.acceptedAtMs ?? null,
          now: Date.now(),
        }),
      },
    }
  }

  function emit() {
    snapshot = buildSnapshot()
    for (const listener of listeners) listener()
  }

  /**
   * Keep re-emitting while commands wait, so the indicator can escalate on age
   * as well as on count — a single command stuck for two minutes is the case a
   * count-only rule would never notice.
   *
   * Only while something is actually watching. An interval that outlived the
   * screen it feeds would tick for the life of the tab, holding the whole queue
   * alive behind it.
   */
  function syncTicker() {
    const waiting = pending.size > 0 && listeners.size > 0
    if (waiting && tick === null) {
      tick = setInterval(emit, TICK_MS)
    } else if (!waiting && tick !== null) {
      clearInterval(tick)
      tick = null
    }
  }

  /**
   * Connectivity is watched only while somebody is subscribed, and the handlers
   * come off again when the last of them leaves. A demo session that is
   * navigated away from must not leave listeners on `window` — four role
   * switches would otherwise accumulate eight.
   */
  const onOnline = () => {
    drain()
    emit()
  }
  const onOffline = () => {
    // Whatever had not gone stops trying. The counter carries on regardless;
    // that is the entire point of the queue.
    for (const [commandId, timer] of timers) {
      clearTimeout(timer)
      timers.delete(commandId)
    }
    emit()
    syncTicker()
  }

  function watchConnectivity(on: boolean) {
    if (typeof window === 'undefined') return
    if (on) {
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
    } else {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }

  function isOnline(): boolean {
    // `navigator.onLine` reports link state rather than reachability, which is
    // a weak signal — and exactly the right strength for a mock whose only job
    // is to reach three visual states the way a real tablet reaches them.
    return typeof navigator === 'undefined' || navigator.onLine !== false
  }

  function actorName(id: string | null): string | null {
    if (!id) return null
    return accountFixtures.find((account) => account.id === id)?.full_name ?? 'Former team member'
  }

  function orderView(row: Tables<'orders'>): BillingOrder {
    return {
      id: row.id,
      outletId: row.outlet_id,
      deviceId: row.device_id,
      orderNumber: row.order_number,
      // Delivered orders carry their permanent number; only queued ones speak
      // of a local reference — matching the live adapter exactly.
      localReference: null,
      businessDate: row.business_date,
      orderedAt: row.ordered_at,
      preparedAt: row.prepared_at,
      status: row.status,
      creatorId: row.created_by,
      creatorName: actorName(row.created_by) ?? 'Unknown operator',
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      lines: store.orderItems
        .filter((line) => line.order_id === row.id)
        .map((line) => ({
          menuItemId: line.menu_item_id ?? line.id,
          itemName: line.item_name,
          unitPricePaise: line.unit_price_paise,
          quantity: line.quantity,
        })),
      totalPaise: row.total_paise,
      cancelReason: row.cancel_reason,
      cancelledAt: row.cancelled_at,
      cancelledByName: actorName(row.cancelled_by),
      billId: row.bill_id,
    }
  }

  function billView(row: Tables<'bills'>): BillingBill {
    const order = row.order_id
      ? store.orders.find((candidate) => candidate.id === row.order_id)
      : null
    const payments =
      paymentCorrections.get(row.id)?.at(-1) ??
      store.billPayments.get(row.id) ??
      (row.payment_method ? [{ method: row.payment_method, amountPaise: row.total_paise }] : [])
    if (payments.length === 0) throw new Error(`Bill ${row.id} has no payment allocations.`)
    const acceptedAt = acceptedPaymentTimes.get(row.id)
    return {
      id: row.id,
      outletId: row.outlet_id,
      billNumber: row.bill_number,
      orderNumber: order?.order_number ?? null,
      businessDate: row.business_date,
      orderedAt: row.ordered_at,
      paidAt: row.paid_at,
      paymentBusinessDate: row.payment_business_date,
      payments,
      paymentRevision: paymentCorrections.get(row.id)?.length ?? 0,
      paymentEditableUntil:
        acceptedAt !== undefined &&
        context.role === 'biller' &&
        row.status === 'settled' &&
        openShiftRow()?.counter_device_id === row.counter_device_id &&
        acceptedAt + PAYMENT_EDIT_WINDOW_MS > paymentNow()
          ? new Date(acceptedAt + PAYMENT_EDIT_WINDOW_MS).toISOString()
          : null,
      paymentMethod: payments.length === 1 ? payments[0]!.method : 'mixed',
      status: row.status,
      billerName: actorName(row.biller_profile_id) ?? 'Counter operator',
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      lines: store.billItems
        .filter((line) => line.bill_id === row.id)
        .map((line) => ({
          menuItemId: line.menu_item_id ?? line.id,
          itemName: line.item_name,
          unitPricePaise: line.unit_price_paise,
          quantity: line.quantity,
        })),
      totalPaise: row.total_paise,
      voidKind: row.void_kind,
      voidReason: row.void_reason,
      voidedAt: row.voided_at,
      voidedBy: row.voided_by ? { id: row.voided_by, name: actorName(row.voided_by) } : null,
    }
  }

  function referenceLabel(order: Pick<BillingOrder, 'localReference' | 'orderNumber'>): string {
    return order.localReference ?? `#${order.orderNumber}`
  }

  function requireOpenShift() {
    const shift = openShiftRow()
    if (!shift) throw new BillingActionError('no_shift', 'No shift is open on this tablet.')
    return shift
  }

  function requireReason(reason: string) {
    const clean = reason.trim()
    if (!clean) throw new BillingActionError('reason_required', 'Add a reason before continuing.')
    return clean
  }

  function requireExactPayments(
    payments: PaymentAllocation[],
    totalPaise: number,
  ): PaymentAllocation[] {
    const clean = structuredClone(payments)
    if (
      clean.length === 0 ||
      new Set(clean.map((payment) => payment.method)).size !== clean.length ||
      clean.some(
        (payment) => !Number.isSafeInteger(payment.amountPaise) || payment.amountPaise <= 0,
      ) ||
      clean.reduce((sum, payment) => sum + payment.amountPaise, 0) !== totalPaise
    ) {
      throw new BillingActionError(
        'payment_mismatch',
        'The payment split must exactly match the bill total.',
      )
    }
    return clean
  }

  function requireManager(outletId: string) {
    if (
      !['super_admin', 'franchise_admin'].includes(context.role) ||
      (context.role !== 'super_admin' && !context.outletIds.includes(outletId))
    ) {
      throw new BillingActionError('not_permitted', 'You cannot manage billing at this outlet.')
    }
  }

  function requireTabletOperator() {
    if (context.role !== 'biller') {
      throw new BillingActionError(
        'not_permitted',
        'Only the originating tablet can resolve this item.',
      )
    }
    return requireOpenShift()
  }

  function replaceOrderLines(orderId: string, lines: BillLineDraft[]) {
    store.orderItems = store.orderItems.filter((line) => line.order_id !== orderId)
    lines.forEach((line, index) =>
      store.orderItems.push({
        id: `${orderId}-${index}`,
        order_id: orderId,
        menu_item_id: line.menuItemId,
        item_name: line.itemName,
        unit_price_paise: line.unitPricePaise,
        quantity: line.quantity,
        line_total_paise: lineTotalPaise(line.unitPricePaise, line.quantity),
      }),
    )
  }

  function totalsOf(lines: BillLineDraft[]) {
    return billTotals(
      lines.map((line) => ({ unitPricePaise: line.unitPricePaise, quantity: line.quantity })),
    )
  }

  // ── Delivery effects ────────────────────────────────────────────────────────
  //
  // Each mutates the store exactly once, at simulated delivery. This is the
  // only place rows are created and numbers are spent — so a command cancelled
  // before delivery never existed and left no gap in the outlet's sequences.

  function applyPayNow(draft: BillDraft) {
    const shift = store.shifts.find((row) => row.id === draft.shiftId)
    if (!shift) throw new Error(`Queued bill ${draft.clientId} has no shift to attribute to.`)

    const totals = totalsOf(draft.lines)
    const payments = requireExactPayments(draft.payments, totals.totalPaise)
    const acceptedAt = new Date(
      acceptedPaymentTimes.get(draft.clientId) ?? Date.now(),
    ).toISOString()

    const next = (store.billNumbers.get(draft.outletId) ?? 0) + 1
    store.billNumbers.set(draft.outletId, next)

    store.bills.push({
      id: draft.clientId,
      outlet_id: draft.outletId,
      bill_number: next,
      biller_profile_id: shift.biller_profile_id,
      counter_device_id: shift.counter_device_id,
      shift_id: draft.shiftId,
      counter_shift_id: null,
      order_id: null,
      business_date: draft.businessDate,
      created_at: acceptedAt,
      ordered_at: acceptedAt,
      paid_at: acceptedAt,
      payment_business_date: draft.businessDate,
      synced_at: new Date().toISOString(),
      customer_id: null,
      customer_name: draft.customerName?.trim() || null,
      customer_phone: draft.customerPhone?.trim() || null,
      payment_method: payments.length === 1 ? payments[0]!.method : null,
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
    store.billPayments.set(
      draft.clientId,
      paymentCorrections.get(draft.clientId)?.at(-1) ?? payments,
    )

    for (const [index, line] of draft.lines.entries()) {
      store.billItems.push({
        id: `${draft.clientId}-${index}`,
        bill_id: draft.clientId,
        menu_item_id: line.menuItemId,
        // The snapshot the counter took when the line was created, carried
        // through untouched — never re-read from the live menu.
        item_name: line.itemName,
        unit_price_paise: line.unitPricePaise,
        quantity: line.quantity,
        line_total_paise: lineTotalPaise(line.unitPricePaise, line.quantity),
      })
    }
    pendingPayNowDrafts.delete(draft.clientId)
  }

  function applyCreateOrder(input: SaveOrderInput) {
    const shift = store.shifts.find((row) => row.id === input.shiftId)
    if (!shift) throw new Error(`Queued order ${input.clientId} has no shift to attribute to.`)
    const totals = totalsOf(input.lines)
    const counterKey = `${input.outletId}:${input.businessDate}`
    // The number is minted here and nowhere else.
    const orderNumber = (store.orderNumbers.get(counterKey) ?? 0) + 1
    store.orderNumbers.set(counterKey, orderNumber)
    const orderedAt = new Date(
      acceptedPaymentTimes.get(input.clientId) ?? Date.now(),
    ).toISOString()
    const row: Tables<'orders'> = {
      id: input.clientId,
      outlet_id: input.outletId,
      device_id: shift.counter_device_id,
      order_number: orderNumber,
      business_date: input.businessDate,
      ordered_at: orderedAt,
      created_at: orderedAt,
      created_by: shift.biller_profile_id,
      created_shift_id: shift.id,
      changed_at: null,
      changed_by: null,
      changed_shift_id: null,
      customer_id: input.customerId ?? null,
      customer_name: input.customerName?.trim() || null,
      customer_phone: input.customerPhone?.trim() || null,
      pricing_mode: 'no_tax',
      subtotal_paise: totals.subtotalPaise,
      discount_paise: 0,
      tax_paise: 0,
      total_paise: totals.totalPaise,
      prepared_at: null,
      status: 'open',
      bill_id: null,
      paid_at: null,
      paid_by: null,
      paid_shift_id: null,
      cancel_reason: null,
      cancelled_at: null,
      cancelled_by: null,
      cancelled_device_id: null,
      cancelled_shift_id: null,
    }
    store.orders.push(row)
    replaceOrderLines(row.id, input.lines)
  }

  function applyReviseOrder(record: { orderId: string; shiftId: string; input: SaveOrderInput }) {
    const row = store.orders.find((candidate) => candidate.id === record.orderId)
    if (!row || row.status !== 'open') return
    const actor = store.shifts.find((candidate) => candidate.id === record.shiftId)
    const totals = totalsOf(record.input.lines)
    row.changed_at = new Date().toISOString()
    row.changed_by = actor?.biller_profile_id ?? row.created_by
    row.changed_shift_id = actor?.id ?? row.created_shift_id
    row.customer_id = record.input.customerId ?? null
    row.customer_name = record.input.customerName?.trim() || null
    row.customer_phone = record.input.customerPhone?.trim() || null
    row.subtotal_paise = totals.subtotalPaise
    row.discount_paise = 0
    row.tax_paise = 0
    row.total_paise = totals.totalPaise
    replaceOrderLines(row.id, record.input.lines)
  }

  function applyCancelOrder(record: {
    orderId: string
    shiftId: string
    reason: string
  }) {
    const row = store.orders.find((candidate) => candidate.id === record.orderId)
    if (!row || row.status !== 'open') return
    const actor = store.shifts.find((candidate) => candidate.id === record.shiftId)
    row.status = 'cancelled'
    row.cancel_reason = record.reason
    row.cancelled_at = new Date().toISOString()
    row.cancelled_by = actor?.biller_profile_id ?? row.created_by
    row.cancelled_device_id = actor?.counter_device_id ?? row.device_id
    row.cancelled_shift_id = actor?.id ?? null
  }

  function applySetOrderPreparation(orderId: string, prepared: boolean) {
    const row = store.orders.find((candidate) => candidate.id === orderId)
    if (!row || (row.status !== 'open' && !(row.status === 'paid' && prepared))) return
    row.prepared_at = prepared ? new Date().toISOString() : null
  }

  function applyPayOrder(payment: {
    orderId: string
    shiftId: string
    billId: string
    payments: PaymentAllocation[]
    paidAt: string
    paymentBusinessDate: string
  }) {
    const row = store.orders.find((candidate) => candidate.id === payment.orderId)
    if (!row || row.status !== 'open') return
    const shift = store.shifts.find((candidate) => candidate.id === payment.shiftId)
    if (!shift) throw new Error(`Queued payment ${payment.billId} has no shift to attribute to.`)
    const nextNumber = (store.billNumbers.get(row.outlet_id) ?? 0) + 1
    store.billNumbers.set(row.outlet_id, nextNumber)
    const bill: Tables<'bills'> = {
      id: payment.billId,
      outlet_id: row.outlet_id,
      bill_number: nextNumber,
      biller_profile_id: shift.biller_profile_id,
      counter_device_id: shift.counter_device_id,
      shift_id: shift.id,
      counter_shift_id: null,
      order_id: row.id,
      business_date: row.business_date,
      created_at: payment.paidAt,
      ordered_at: row.ordered_at,
      paid_at: payment.paidAt,
      payment_business_date: payment.paymentBusinessDate,
      synced_at: payment.paidAt,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      payment_method:
        payment.payments.length === 1 ? payment.payments[0]!.method : null,
      pricing_mode: 'no_tax',
      status: 'settled',
      subtotal_paise: row.subtotal_paise,
      discount_paise: 0,
      tax_paise: 0,
      total_paise: row.total_paise,
      void_kind: null,
      void_reason: null,
      voided_at: null,
      voided_by: null,
    }
    store.bills.push(bill)
    store.billPayments.set(payment.billId, payment.payments)
    store.orderItems
      .filter((line) => line.order_id === row.id)
      .forEach((line, index) =>
        store.billItems.push({
          id: `${payment.billId}-${index}`,
          bill_id: payment.billId,
          menu_item_id: line.menu_item_id,
          item_name: line.item_name,
          unit_price_paise: line.unit_price_paise,
          quantity: line.quantity,
          line_total_paise: line.line_total_paise,
        }),
      )
    row.status = 'paid'
    row.bill_id = payment.billId
    row.paid_at = payment.paidAt
    row.paid_by = shift.biller_profile_id
    row.paid_shift_id = shift.id
  }

  /** The shared spine of both unwinds: void the bill with its structured kind and reason. */
  function voidBillRow(
    billId: string,
    kind: 'counter_unpay' | 'cancelled_after_paid',
    reason: string,
  ) {
    const bill = store.bills.find((candidate) => candidate.id === billId)
    if (!bill || bill.status !== 'settled') return
    bill.status = 'void'
    // Stamped at write time, never inferred at read time — the same rule the
    // database applies.
    bill.void_kind = kind
    bill.void_reason = reason
    bill.voided_at = new Date().toISOString()
    // Command-context voids stamp the acting shift operator, exactly as the
    // database stamps the person behind the tablet's device session.
    bill.voided_by = openShiftRow()?.biller_profile_id ?? bill.biller_profile_id
  }

  function reopenPaidOrder(orderId: string) {
    const row = store.orders.find((candidate) => candidate.id === orderId)
    if (!row || row.status !== 'paid') return
    row.status = 'open'
    row.bill_id = null
    row.paid_at = null
    row.paid_by = null
    row.paid_shift_id = null
    // `prepared_at` untouched: the card returns to whichever section it came from.
  }

  function cancelPaidOrderRow(orderId: string, shiftId: string, reason: string) {
    const row = store.orders.find((candidate) => candidate.id === orderId)
    if (!row || row.status !== 'paid') return
    const actor = store.shifts.find((candidate) => candidate.id === shiftId)
    row.status = 'cancelled'
    row.bill_id = null
    row.paid_at = null
    row.paid_by = null
    row.paid_shift_id = null
    row.cancel_reason = reason
    row.cancelled_at = new Date().toISOString()
    row.cancelled_by = actor?.biller_profile_id ?? row.created_by
    row.cancelled_device_id = actor?.counter_device_id ?? row.device_id
    row.cancelled_shift_id = actor?.id ?? null
  }

  // ── Projection ──────────────────────────────────────────────────────────────

  /**
   * Is this order still on the counter's pipeline? Open orders always are; a
   * **paid but not yet prepared** order is too — it stays in Preparing wearing
   * its Paid marker until preparation lands it in Bills.
   */
  function inPipeline(order: Pick<BillingOrder, 'status' | 'preparedAt'>): boolean {
    return order.status === 'open' || (order.status === 'paid' && order.preparedAt === null)
  }

  /**
   * Store rows plus every undelivered command, replayed in acceptance order.
   * Deliberately **unfiltered**: guard messages need to see a cancelled order
   * by name, so the pipeline filter belongs to the listing call sites.
   * Reads never see a half-applied compound: between an accepted un-pay and its
   * delivery there is one open order, not a paid ghost and an open double.
   */
  function projectedOrders(outletId: string): BillingOrder[] {
    const overlaid = new Map<string, BillingOrder>()
    for (const row of store.orders) {
      if (row.outlet_id === outletId) overlaid.set(row.id, orderView(row))
    }
    for (const command of sortedPending()) {
      switch (command.type) {
        case 'create_order': {
          const input = pendingOrderInputs.get(command.commandId)
          if (!input || input.outletId !== outletId) break
          const creatorShift =
            store.shifts.find((row) => row.id === input.shiftId) ?? openShiftRow()
          overlaid.set(input.clientId, {
            id: input.clientId,
            outletId: input.outletId,
            deviceId: creatorShift?.counter_device_id ?? DEMO_COUNTER_DEVICE_ID,
            orderNumber: 0,
            localReference: `Local · ${provisionalToken(input.clientId)}`,
            businessDate: input.businessDate,
            orderedAt: new Date(command.acceptedAtMs).toISOString(),
            preparedAt: null,
            status: 'open',
            creatorId: creatorShift?.biller_profile_id ?? '',
            creatorName:
              actorName(creatorShift?.biller_profile_id ?? null) ?? 'Counter operator',
            customerName: input.customerName?.trim() || null,
            customerPhone: input.customerPhone?.trim() || null,
            lines: structuredClone(input.lines),
            totalPaise: totalsOf(input.lines).totalPaise,
            cancelReason: null,
            cancelledAt: null,
            cancelledByName: null,
            billId: null,
          })
          break
        }
        case 'revise_order': {
          const record = pendingRevisions.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (!current || !record) break
          overlaid.set(record.orderId, {
            ...current,
            customerName: record.input.customerName?.trim() || null,
            customerPhone: record.input.customerPhone?.trim() || null,
            lines: structuredClone(record.input.lines),
            totalPaise: totalsOf(record.input.lines).totalPaise,
          })
          break
        }
        case 'set_order_preparation': {
          const record = pendingPreparations.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (current && record) {
            overlaid.set(record.orderId, {
              ...current,
              preparedAt: record.prepared ? new Date(command.acceptedAtMs).toISOString() : null,
            })
          }
          break
        }
        case 'pay_order': {
          const record = pendingOrderPayments.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (current && record) {
            overlaid.set(record.orderId, {
              ...current,
              status: 'paid',
              billId: record.billId,
            })
          }
          break
        }
        case 'void_order_payment': {
          const record = pendingUnwinds.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (current && record) {
            overlaid.set(record.orderId, {
              ...current,
              status: 'open',
              billId: null,
              cancelReason: null,
              cancelledAt: null,
              cancelledByName: null,
            })
          }
          break
        }
        case 'cancel_paid_order': {
          const record = pendingUnwinds.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (current && record) {
            overlaid.set(record.orderId, {
              ...current,
              status: 'cancelled',
              billId: null,
              cancelReason: record.reason,
            })
          }
          break
        }
        case 'cancel_order': {
          const record = pendingCancellations.get(command.commandId)
          const current = record ? overlaid.get(record.orderId) : undefined
          if (current && record) {
            overlaid.set(record.orderId, {
              ...current,
              status: 'cancelled',
              cancelReason: record.reason,
            })
          }
          break
        }
        default:
          break
      }
    }
    return [...overlaid.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt))
  }

  /**
   * When this tablet took a given payment, for the grace-window guards. The
   * five-minute clock measures from acceptance — the moment the money changed
   * hands — never from any rendered timer or delivery event.
   */
  function paidAtOf(billId: string): number | null {
    const orderPayment = pendingOrderPayments.get(billId)
    if (orderPayment) return Date.parse(orderPayment.paidAt)
    const direct = pending.get(billId)
    if (direct && direct.type === 'pay_now') return direct.acceptedAtMs
    const row = store.bills.find((bill) => bill.id === billId)
    if (!row) return null
    return acceptedPaymentTimes.get(billId) ?? Date.parse(row.paid_at)
  }

  /** Accept a command onto the queue and start its simulated send. */
  function accept(command: PendingCommand) {
    pending.set(command.commandId, command)
    drain()
    emit()
    syncTicker()
  }

  /**
   * Deliver one accepted command: apply it, spend whatever numbers it spends,
   * and leave the queue. Runs once — a command that has gone cannot go again.
   */
  function send(commandId: string) {
    timers.delete(commandId)
    const command = pending.get(commandId)
    if (!command || !isOnline()) return
    pending.delete(commandId)
    command.apply()
    emit()
    syncTicker()
  }

  /** Try to send everything still waiting — what reconnecting does. */
  function drain() {
    if (!isOnline()) return
    for (const [commandId] of pending) {
      if (timers.has(commandId)) continue
      timers.set(
        commandId,
        setTimeout(() => send(commandId), SEND_LATENCY_MS),
      )
    }
  }

  // Rebuilt only when something actually changes, so `useSyncExternalStore`
  // sees a stable snapshot and does not loop.
  let snapshot: CounterState = buildSnapshot()
  const attention = new Map<string, BillingAttentionItem>(
    store.billingCommands
      .filter((command) => command.result_category === 'permanent_refusal' && command.device_id)
      .map((command) => [
        command.id,
        {
          reference: command.id,
          commandType: command.command_type,
          resultCategory: command.result_category,
          receivedAt: command.received_at,
          ageMs: Math.max(0, Date.now() - new Date(command.received_at).getTime()),
          deviceId: command.device_id!,
          refusedTrace:
            'The server refused this payment. Check the details, then correct or discard it.',
          state: 'needs_attention' as const,
          linkedCorrectionId: null,
          resolvedAt: null,
          resolvedBy: null,
          discardReason: null,
        },
      ]),
  )

  /** A provisional bill view for an accepted-but-undelivered payment. */
  function provisionalBillView(
    billId: string,
    content: {
      outletId: string
      businessDate: string
      paymentBusinessDate: string
      paidAt: string
      orderedAt: string | null
      payments: PaymentAllocation[]
      customerName: string | null
      customerPhone: string | null
      lines: BillLineDraft[]
      totalPaise: number
      orderNumber: number | null
      billerName: string
    },
  ): BillingBill {
    const revisions = paymentCorrections.get(billId)
    const payments = revisions?.at(-1) ?? content.payments
    return {
      id: billId,
      outletId: content.outletId,
      billNumber: 0,
      orderNumber: content.orderNumber,
      businessDate: content.businessDate,
      orderedAt: content.orderedAt ?? content.paidAt,
      paidAt: content.paidAt,
      paymentBusinessDate: content.paymentBusinessDate,
      payments,
      paymentRevision: revisions?.length ?? 0,
      paymentEditableUntil: new Date(
        Date.parse(content.paidAt) + PAYMENT_EDIT_WINDOW_MS,
      ).toISOString(),
      paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
      status: 'settled',
      billerName: content.billerName,
      customerName: content.customerName,
      customerPhone: content.customerPhone,
      lines: content.lines,
      totalPaise: content.totalPaise,
      voidKind: null,
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
    }
  }

  return {
    advanceDemoPaymentClock(milliseconds) {
      paymentClockOffsetMs += Math.max(0, milliseconds)
      emit()
    },
    getCounterState() {
      return snapshot
    },

    subscribeCounter(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        watchConnectivity(true)
        // Draining here, not on a network event, is what lets a freshly opened
        // counter finish work that was already waiting — including the seeded
        // pending bill, which delivers without anything pretending to reconnect.
        drain()
      }
      syncTicker()

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          watchConnectivity(false)
          syncTicker()
        }
      }
    },

    async listBillers(outletId: string): Promise<CounterBiller[]> {
      return accountFixtures
        .filter((account) => account.is_active && billsAt(account.id, outletId))
        .map((account) => ({ profileId: account.id, fullName: account.full_name }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
    },

    async openShift({ outletId, billerProfileId, pin }) {
      const biller = accountFixtures.find(
        (account) =>
          account.id === billerProfileId && account.is_active && billsAt(account.id, outletId),
      )

      // One refusal for both failures, deliberately. Telling a wrong PIN apart
      // from an unknown biller would confirm which names are real, on a device
      // that lives on a counter anyone can reach across.
      if (!biller || pin !== DEMO_BILLER_PIN) {
        throw new BillingActionError('unlock_failed', 'That did not unlock. Check the PIN.')
      }

      if (openShiftRow()) {
        throw new BillingActionError(
          'shift_open',
          'A shift is already open. Close it before opening another.',
        )
      }

      const row: Tables<'shifts'> = {
        id: `d6000000-0000-4000-b000-${String(store.shifts.length + 1).padStart(12, '0')}`,
        outlet_id: outletId,
        biller_profile_id: billerProfileId,
        counter_device_id: DEMO_COUNTER_DEVICE_ID,
        business_date: store.today,
        opened_at: new Date().toISOString(),
        closed_at: null,
      }
      store.shifts.push(row)
      emit()
      return toShift(row)
    },

    async closeShift(shiftId: string) {
      const row = store.shifts.find((candidate) => candidate.id === shiftId)
      if (!row || row.closed_at !== null) {
        throw new BillingActionError('no_shift', 'That shift is not open.')
      }
      if (pending.size > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          `${pending.size} billing action${pending.size === 1 ? ' is' : 's are'} still unresolved on this tablet.`,
        )
      }
      const latestPaidAt = Math.max(0, ...acceptedPaymentTimes.values())
      if (latestPaidAt + PAYMENT_EDIT_WINDOW_MS > paymentNow()) {
        throw new BillingActionError(
          'unresolved_operations',
          'A recent payment can still be edited. Wait for its five-minute window, then finish the day.',
        )
      }
      row.closed_at = new Date().toISOString()
      emit()
    },

    async settleBill(draft: BillDraft) {
      const shift = store.shifts.find((row) => row.id === draft.shiftId && row.closed_at === null)
      if (!shift) {
        throw new BillingActionError(
          'no_shift',
          'No shift is open, so there is nobody to attribute this bill to.',
        )
      }
      if (draft.lines.length === 0) {
        throw new BillingActionError('empty_bill', 'There is nothing on this bill.')
      }

      // Idempotent by client identity: the same id twice stores one bill, and
      // the second attempt is reported as a duplicate rather than creating a
      // second row (spec: counter writes are idempotent by client identity).
      if (pending.has(draft.clientId) || store.bills.some((row) => row.id === draft.clientId)) {
        throw new BillingActionError('duplicate', 'That bill has already been recorded.')
      }

      requireExactPayments(draft.payments, totalsOf(draft.lines).totalPaise)

      const draftCopy = structuredClone(draft)
      pendingPayNowDrafts.set(draft.clientId, draftCopy)
      acceptedPaymentTimes.set(draft.clientId, paymentNow())
      accept({
        commandId: draft.clientId,
        type: 'pay_now',
        acceptedAtMs: paymentNow(),
        apply: () => applyPayNow(draftCopy),
      })
    },

    async correctBillPayment(billId, expectedRevision, paymentsInput) {
      requireTabletOperator()
      const pendingCommand = pending.get(billId)
      const row = store.bills.find((bill) => bill.id === billId)
      const paidAt = pendingCommand
        ? pendingCommand.acceptedAtMs
        : row
          ? Date.parse(row.paid_at)
          : Number.NaN
      const directDraft = pendingPayNowDrafts.get(billId)
      const orderPayment = pendingOrderPayments.get(billId)
      const totalPaise = directDraft
        ? totalsOf(directDraft.lines).totalPaise
        : orderPayment
          ? (projectedOrders(openShiftRow()?.outlet_id ?? '')
              .find((order) => order.id === orderPayment.orderId)
              ?.totalPaise ??
            store.orders.find((order) => order.id === orderPayment.orderId)?.total_paise)
          : row?.total_paise
      if (!Number.isFinite(paidAt) || totalPaise === undefined) {
        throw new BillingActionError('not_found', 'That bill was not found on this tablet.')
      }
      if (paidAt + PAYMENT_EDIT_WINDOW_MS <= paymentNow()) {
        throw new BillingActionError(
          'payment_edit_expired',
          'That payment can no longer be edited.',
        )
      }
      const revisions = paymentCorrections.get(billId) ?? []
      if (revisions.length !== expectedRevision) {
        throw new BillingActionError(
          'stale_revision',
          'That payment changed; reopen it and try again.',
        )
      }
      const payments = requireExactPayments(paymentsInput, totalPaise)
      revisions.push(payments)
      paymentCorrections.set(billId, revisions)
      if (row) store.billPayments.set(billId, payments)
      emit()
      if (row) return billView(row)
      const source = directDraft
      const order = orderPayment
        ? projectedOrders(openShiftRow()?.outlet_id ?? '').find(
            (candidate) => candidate.id === orderPayment.orderId,
          )
        : null
      return provisionalBillView(billId, {
        outletId: source?.outletId ?? order?.outletId ?? DEMO_OUTLET_ID,
        businessDate: source?.businessDate ?? order?.businessDate ?? store.today,
        paymentBusinessDate: source?.businessDate ?? order?.businessDate ?? store.today,
        paidAt: new Date(paidAt).toISOString(),
        orderedAt: order?.orderedAt ?? null,
        payments,
        customerName: source?.customerName?.trim() || order?.customerName || null,
        customerPhone: source?.customerPhone?.trim() || order?.customerPhone || null,
        lines: source?.lines ?? order?.lines ?? [],
        totalPaise,
        orderNumber: order?.orderNumber ?? null,
        billerName: actorName(openShiftRow()?.biller_profile_id ?? null) ?? 'Counter operator',
      })
    },

    async saveOrder(input) {
      const shift = requireOpenShift()
      if (shift.id !== input.shiftId || shift.outlet_id !== input.outletId) {
        throw new BillingActionError('no_shift', 'This order does not belong to the open shift.')
      }
      if (input.lines.length === 0) {
        throw new BillingActionError('empty_order', 'There is nothing on this order.')
      }
      if (
        pending.has(input.clientId) ||
        store.orders.some((order) => order.id === input.clientId)
      ) {
        throw new BillingActionError('duplicate', 'That order has already been saved.')
      }
      const inputCopy = structuredClone(input)
      const acceptedAtMs = Date.now()
      pendingOrderInputs.set(input.clientId, inputCopy)
      accept({
        commandId: input.clientId,
        type: 'create_order',
        acceptedAtMs,
        apply: () => applyCreateOrder(inputCopy),
      })
      // The provisional shape the live adapter returns: no number yet, a local
      // reference instead — the wording matches production exactly.
      return {
        id: input.clientId,
        outletId: input.outletId,
        deviceId: shift.counter_device_id,
        orderNumber: 0,
        localReference: `Local · ${provisionalToken(input.clientId)}`,
        businessDate: input.businessDate,
        orderedAt: new Date(acceptedAtMs).toISOString(),
        preparedAt: null,
        status: 'open',
        creatorId: shift.biller_profile_id,
        creatorName: actorName(shift.biller_profile_id) ?? 'Counter operator',
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        lines: structuredClone(input.lines),
        totalPaise: totalsOf(input.lines).totalPaise,
        cancelReason: null,
        cancelledAt: null,
        cancelledByName: null,
        billId: null,
      }
    },

    async reviseOrder(orderId, input) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.counter_device_id) {
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      }
      if (projected.status !== 'open') {
        const by = projected.cancelledByName
        throw new BillingActionError(
          'order_cancelled',
          projected.status === 'cancelled'
            ? `Order ${referenceLabel(projected)} was cancelled${by ? ` by ${by}` : ''}.`
            : `Order ${referenceLabel(projected)} is no longer open.`,
        )
      }
      if (input.lines.length === 0)
        throw new BillingActionError('empty_order', 'There is nothing on this order.')
      const commandId = crypto.randomUUID()
      const inputCopy = structuredClone({
        ...input,
        clientId: orderId,
        outletId: projected.outletId,
        shiftId: shift.id,
        businessDate: projected.businessDate,
      })
      pendingRevisions.set(commandId, { orderId, shiftId: shift.id, input: inputCopy })
      accept({
        commandId,
        type: 'revise_order',
        acceptedAtMs: Date.now(),
        apply: () => applyReviseOrder({ orderId, shiftId: shift.id, input: inputCopy }),
      })
      return {
        ...projected,
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        lines: structuredClone(input.lines),
        totalPaise: totalsOf(input.lines).totalPaise,
      }
    },

    async listOpenOrders(outletId) {
      const shift = requireOpenShift()
      if (shift.outlet_id !== outletId) return []
      // Whole-outlet scope, like the live adapters have always served: another
      // tablet's pipeline work is this counter's work too.
      return projectedOrders(outletId).filter(inPipeline)
    },

    async markOrderPrepared(orderId, prepared) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.counter_device_id) {
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      }
      // The same guards the database applies at delivery, evaluated against the
      // projected state: only an open order moves, and a paid order may still
      // be marked prepared — but never reprepared, because the bills border is
      // terminal in that direction.
      if (projected.status === 'paid' && !prepared) {
        throw new BillingActionError(
          'not_open',
          'This order is paid, so it cannot go back to preparing. Take the payment back first.',
        )
      }
      if (projected.status === 'cancelled') {
        const by = projected.cancelledByName
        throw new BillingActionError(
          'not_open',
          `Order ${referenceLabel(projected)} was cancelled${by ? ` by ${by}` : ''}.`,
        )
      }
      if (projected.status !== 'open' && !(projected.status === 'paid' && prepared)) {
        throw new BillingActionError('not_open', `Order ${referenceLabel(projected)} is not open.`)
      }
      const commandId = crypto.randomUUID()
      pendingPreparations.set(commandId, { orderId, prepared })
      accept({
        commandId,
        type: 'set_order_preparation',
        acceptedAtMs: Date.now(),
        apply: () => applySetOrderPreparation(orderId, prepared),
      })
      return {
        ...projected,
        preparedAt: prepared ? new Date(Date.now()).toISOString() : null,
      }
    },

    async unpayOrder(orderId, billId, reason) {
      const shift = requireOpenShift()
      const cleanReason = requireReason(reason)
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (
        !projected ||
        projected.deviceId !== shift.counter_device_id ||
        projected.billId !== billId
      ) {
        throw new BillingActionError('not_found', 'That payment is not on this tablet.')
      }
      const paidAtMs = paidAtOf(billId)
      if (paidAtMs === null) {
        throw new BillingActionError('not_found', 'That payment is not on this tablet.')
      }
      if (paidAtMs + PAYMENT_EDIT_WINDOW_MS <= paymentNow()) {
        throw new BillingActionError(
          'window_expired',
          'That payment can no longer be taken back. Ask the manager to void it.',
        )
      }
      const commandId = crypto.randomUUID()
      pendingUnwinds.set(commandId, { orderId, billId, shiftId: shift.id, reason: cleanReason })
      acceptedPaymentTimes.delete(billId)
      accept({
        commandId,
        type: 'void_order_payment',
        acceptedAtMs: Date.now(),
        apply: () => {
          voidBillRow(billId, 'counter_unpay', cleanReason)
          reopenPaidOrder(orderId)
        },
      })
      return {
        ...projected,
        status: 'open',
        billId: null,
        cancelReason: null,
        cancelledAt: null,
        cancelledByName: null,
      }
    },

    async cancelPaidOrder(orderId, reason) {
      const shift = requireOpenShift()
      const cleanReason = requireReason(reason)
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.counter_device_id || !projected.billId) {
        throw new BillingActionError(
          'not_found',
          'That paid order is not one this tablet can cancel.',
        )
      }
      const billId = projected.billId
      const paidAtMs = paidAtOf(billId)
      if (paidAtMs === null) {
        throw new BillingActionError('not_found', 'That payment is not on this tablet.')
      }
      if (paidAtMs + PAYMENT_EDIT_WINDOW_MS <= paymentNow()) {
        throw new BillingActionError(
          'window_expired',
          'That payment can no longer be undone. Ask the manager to void it.',
        )
      }
      const commandId = crypto.randomUUID()
      pendingUnwinds.set(commandId, { orderId, billId, shiftId: shift.id, reason: cleanReason })
      acceptedPaymentTimes.delete(billId)
      accept({
        commandId,
        type: 'cancel_paid_order',
        acceptedAtMs: Date.now(),
        apply: () => {
          voidBillRow(billId, 'cancelled_after_paid', cleanReason)
          cancelPaidOrderRow(orderId, shift.id, cleanReason)
        },
      })
      return {
        ...projected,
        status: 'cancelled',
        billId: null,
        cancelReason: cleanReason,
        cancelledAt: new Date().toISOString(),
        cancelledByName: actorName(shift.biller_profile_id),
      }
    },

    async payOrder(orderId, paymentsInput) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.counter_device_id) {
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      }
      if (projected.status === 'cancelled') {
        const by = projected.cancelledByName
        throw new BillingActionError(
          'order_cancelled',
          `Order ${referenceLabel(projected)} was cancelled${by ? ` by ${by}` : ''}.`,
        )
      }
      if (projected.status !== 'open')
        throw new BillingActionError(
          'order_closed',
          `Order ${referenceLabel(projected)} is already paid.`,
        )
      const payments = requireExactPayments(paymentsInput, projected.totalPaise)
      const billId = crypto.randomUUID()
      const paidAt = new Date(paymentNow()).toISOString()
      const record = {
        orderId,
        shiftId: shift.id,
        billId,
        payments,
        paidAt,
        paymentBusinessDate: shift.business_date,
      }
      pendingOrderPayments.set(billId, record)
      acceptedPaymentTimes.set(billId, paymentNow())
      accept({
        commandId: billId,
        type: 'pay_order',
        acceptedAtMs: paymentNow(),
        apply: () => applyPayOrder(record),
      })
      return provisionalBillView(billId, {
        outletId: projected.outletId,
        businessDate: projected.businessDate,
        paymentBusinessDate: record.paymentBusinessDate,
        paidAt,
        orderedAt: projected.orderedAt,
        payments,
        customerName: projected.customerName,
        customerPhone: projected.customerPhone,
        lines: projected.lines,
        totalPaise: projected.totalPaise,
        orderNumber: projected.orderNumber,
        billerName: projected.creatorName,
      })
    },

    async cancelOrder(orderId, reason) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.counter_device_id)
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      if (projected.status !== 'open')
        throw new BillingActionError(
          'order_closed',
          `Order ${referenceLabel(projected)} is no longer open.`,
        )
      const cleanReason = requireReason(reason)
      const commandId = crypto.randomUUID()
      pendingCancellations.set(commandId, { orderId, shiftId: shift.id, reason: cleanReason })
      accept({
        commandId,
        type: 'cancel_order',
        acceptedAtMs: Date.now(),
        apply: () => applyCancelOrder({ orderId, shiftId: shift.id, reason: cleanReason }),
      })
      return {
        ...projected,
        status: 'cancelled',
        cancelReason: cleanReason,
        cancelledAt: new Date().toISOString(),
        cancelledByName: actorName(shift.biller_profile_id),
      }
    },

    async listShiftHistory(shiftId) {
      const shift = store.shifts.find((candidate) => candidate.id === shiftId)
      const unwoundBillIds = new Set(
        sortedPending()
          .filter(
            (command) =>
              command.type === 'void_order_payment' || command.type === 'cancel_paid_order',
          )
          .flatMap((command) => {
            const record = pendingUnwinds.get(command.commandId)
            return record ? [record.billId] : []
          }),
      )
      const serverBills = store.bills
        .filter(
          (bill) =>
            bill.shift_id === shiftId &&
            !unwoundBillIds.has(bill.id) &&
            (!shift || bill.business_date === shift.business_date) &&
            (!shift || bill.counter_device_id === shift.counter_device_id),
        )
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
        .map(billView)
      const queuedBills: BillingBill[] = sortedPending()
        .filter(
          (command) =>
            (command.type === 'pay_now' &&
              pendingPayNowDrafts.get(command.commandId)?.shiftId === shiftId) ||
            (command.type === 'pay_order' &&
              pendingOrderPayments.get(command.commandId)?.shiftId === shiftId),
        )
        .map((command) => {
          if (command.type === 'pay_now') {
            const draft = pendingPayNowDrafts.get(command.commandId)!
            return provisionalBillView(command.commandId, {
              outletId: draft.outletId,
              businessDate: draft.businessDate,
              paymentBusinessDate: draft.businessDate,
              paidAt: new Date(command.acceptedAtMs).toISOString(),
              orderedAt: null,
              payments: draft.payments,
              customerName: draft.customerName?.trim() || null,
              customerPhone: draft.customerPhone?.trim() || null,
              lines: draft.lines,
              totalPaise: totalsOf(draft.lines).totalPaise,
              orderNumber: null,
              billerName:
                actorName(openShiftRow()?.biller_profile_id ?? null) ?? 'Counter operator',
            })
          }
          const record = pendingOrderPayments.get(command.commandId)!
          const order = projectedOrders(shift?.outlet_id ?? '').find(
            (candidate) => candidate.id === record.orderId,
          )
          return provisionalBillView(command.commandId, {
            outletId: order?.outletId ?? shift?.outlet_id ?? '',
            businessDate: order?.businessDate ?? shift?.business_date ?? store.today,
            paymentBusinessDate: record.paymentBusinessDate,
            paidAt: record.paidAt,
            orderedAt: order?.orderedAt ?? null,
            payments: record.payments,
            customerName: order?.customerName ?? null,
            customerPhone: order?.customerPhone ?? null,
            lines: order?.lines ?? [],
            totalPaise: order?.totalPaise ?? 0,
            orderNumber: order?.orderNumber ?? null,
            billerName: order?.creatorName ?? 'Counter operator',
          })
        })
      const billsById = new Map(serverBills.map((bill) => [bill.id, bill]))
      for (const bill of queuedBills) billsById.set(bill.id, bill)
      // The fabricated scenario spans a full trading day, including times later
      // than the viewer's real clock. Keep payments accepted during this demo
      // session first so the bill and its five-minute edit action appear where
      // the operator just acted, then preserve normal paid-at ordering.
      const bills = [...billsById.values()].sort(compareShiftBills)
      const totals = BILLING_PAYMENT_METHODS.map((method) => ({
        method,
        totalPaise: bills
          .filter((bill) => bill.status === 'settled')
          .flatMap((bill) => bill.payments)
          .filter((payment) => payment.method === method)
          .reduce((sum, payment) => sum + payment.amountPaise, 0),
      }))
      return { bills, totals }
    },

    async listManagerHistory(filters) {
      requireManager(filters.outletId)
      return store.bills
        .filter((bill) => bill.outlet_id === filters.outletId)
        .filter((bill) => !filters.businessDate || bill.business_date === filters.businessDate)
        .filter(
          (bill) => !filters.status || filters.status === 'all' || bill.status === filters.status,
        )
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
        .map(billView)
        .filter(
          (bill) =>
            !filters.paymentMethod ||
            filters.paymentMethod === 'all' ||
            bill.payments.some((payment) => payment.method === filters.paymentMethod),
        )
    },

    async getBill(billId) {
      const row = store.bills.find((bill) => bill.id === billId)
      if (!row) return null
      if (context.role !== 'biller') requireManager(row.outlet_id)
      return billView(row)
    },

    async voidBill(billId, reason) {
      const row = store.bills.find((bill) => bill.id === billId)
      if (!row) throw new BillingActionError('not_found', 'That bill was not found.')
      requireManager(row.outlet_id)
      if (row.status === 'void') return billView(row)
      row.status = 'void'
      row.void_kind = 'manager_void'
      row.void_reason = requireReason(reason)
      row.voided_at = new Date().toISOString()
      row.voided_by = context.userId
      emit()
      return billView(row)
    },

    async listManagerOpenOrders(outletId) {
      requireManager(outletId)
      return projectedOrders(outletId).filter(inPipeline)
    },

    async managerCancelOrder(orderId, reason) {
      const row = store.orders.find((order) => order.id === orderId)
      if (!row) throw new BillingActionError('not_found', 'That order was not found.')
      requireManager(row.outlet_id)
      if (row.status !== 'open')
        throw new BillingActionError('order_closed', `Order ${row.order_number} is no longer open.`)
      row.status = 'cancelled'
      row.cancel_reason = requireReason(reason)
      row.cancelled_at = new Date().toISOString()
      row.cancelled_by = context.userId
      row.cancelled_device_id = null
      row.cancelled_shift_id = null
      emit()
      return orderView(row)
    },

    async listAttention() {
      const shift = requireTabletOperator()
      return [...attention.values()].filter((item) => item.deviceId === shift.counter_device_id)
    },

    async correctAttention(reference, correctionId) {
      const shift = requireTabletOperator()
      const item = attention.get(reference)
      if (!item || item.deviceId !== shift.counter_device_id)
        throw new BillingActionError('not_found', 'That item is not on this tablet.')
      if (item.state !== 'needs_attention')
        throw new BillingActionError('resolved', 'That item is already resolved.')
      const updated = {
        ...item,
        state: 'corrected' as const,
        linkedCorrectionId: correctionId,
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.biller_profile_id,
      }
      attention.set(reference, updated)
      return updated
    },

    async discardAttention(reference, reason) {
      const shift = requireTabletOperator()
      const item = attention.get(reference)
      if (!item || item.deviceId !== shift.counter_device_id)
        throw new BillingActionError('not_found', 'That item is not on this tablet.')
      if (item.state !== 'needs_attention')
        throw new BillingActionError('resolved', 'That item is already resolved.')
      const updated = {
        ...item,
        state: 'discarded' as const,
        discardReason: requireReason(reason),
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.biller_profile_id,
      }
      attention.set(reference, updated)
      return updated
    },

    async listDeliveryDiagnostics(outletId) {
      requireManager(outletId)
      return store.billingCommands
        .filter(
          (command) => command.outlet_id === outletId && command.result_category !== 'applied',
        )
        .map((command) => ({
          reference: command.id,
          commandType: command.command_type,
          resultCategory: command.result_category,
          receivedAt: command.received_at,
          ageMs: Math.max(0, Date.now() - new Date(command.received_at).getTime()),
        }))
    },
  }
}
