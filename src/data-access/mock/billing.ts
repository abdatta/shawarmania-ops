import {
  billTotals,
  classifySync,
  lineTotalPaise,
  PAYMENT_EDIT_WINDOW_MS,
  provisionalToken,
} from '@/domain'

import {
  BillingActionError,
  BILLING_PAYMENT_METHODS,
  type BillDraft,
  type BillLineDraft,
  type BillingAdapter,
  type BillingAttentionItem,
  type BillingAttributionOutcome,
  type BillingAttributionReview,
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
import { DEMO_BILLER_ID, DEMO_BILLER_PIN, DEMO_COUNTER_DEVICE_ID } from './fixtures/billing'
import { DEMO_OUTLET_ID, nextCutover, type DemoStore } from './store'

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

function toShift(row: Tables<'counter_shifts'>): CounterShift {
  return {
    id: row.id,
    outletId: row.outlet_id,
    billerProfileId: row.person_id,
    billerName: nameOf(row.person_id),
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

/** Mirrors the live adapter: a refusal names its order, or it does not. */
function mockRefusedOrderNumber(result: unknown): number | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const named = (result as { orderNumber?: unknown }).orderNumber
  return typeof named === 'number' && Number.isFinite(named) ? named : null
}

export function createMockBillingAdapter(
  store: DemoStore,
  context: MockBillingContext = {
    role: 'biller',
    userId: DEMO_BILLER_ID,
    outletIds: [store.shifts.find((shift) => shift.ended_at === null)?.outlet_id ?? ''],
  },
): BillingAdapter {
  const listeners = new Set<() => void>()
  const paymentCorrections = new Map<string, PaymentAllocation[][]>()
  const attributionReviews = new Map<string, BillingAttributionReview>()
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
  const pendingRevisions = new Map<
    string,
    { orderId: string; shiftId: string; input: SaveOrderInput }
  >()
  const pendingCancellations = new Map<
    string,
    { orderId: string; shiftId: string; reason: string }
  >()
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
    { orderId: string; billId: string | null; shiftId: string; reason: string }
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

  /**
   * The shift this counter is running, scoped to the outlets the caller reaches.
   *
   * Unscoped it returned *any* open shift in the store, which was correct only
   * while exactly one could exist. A walkthrough can now end a shift, hand over
   * and open another, and both outlets carry shift rows — so an unscoped read
   * would let Kanchrapara's counter answer for Kalyani's, which is the one
   * question outlet isolation exists to refuse.
   */
  function openShiftRow(): Tables<'counter_shifts'> | undefined {
    return store.shifts.find(
      (row) => row.ended_at === null && context.outletIds.includes(row.outlet_id),
    )
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
      paidAt: row.paid_at,
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
      orderId: row.order_id,
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
        openShiftRow()?.device_id === row.counter_device_id &&
        acceptedAt + PAYMENT_EDIT_WINDOW_MS > paymentNow()
          ? new Date(acceptedAt + PAYMENT_EDIT_WINDOW_MS).toISOString()
          : null,
      paymentMethod: payments.length === 1 ? payments[0]!.method : 'mixed',
      status: row.status,
      billerName: actorName(row.biller_profile_id) ?? 'Counter operator',
      billerId: row.biller_profile_id,
      recordedAfterShiftEnd: row.recorded_after_shift_end,
      attributionShiftEndedAt: row.attribution_shift_ended_at,
      attributionReview: attributionReviews.get(row.id) ?? null,
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
      biller_profile_id: shift.person_id,
      counter_device_id: shift.device_id,
      shift_id: null,
      counter_shift_id: draft.shiftId,
      order_id: null,
      business_date: draft.businessDate,
      created_at: acceptedAt,
      ordered_at: acceptedAt,
      paid_at: acceptedAt,
      payment_business_date: draft.businessDate,
      recorded_after_shift_end: false,
      attribution_shift_ended_at: null,
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
    const orderedAt = new Date(acceptedPaymentTimes.get(input.clientId) ?? Date.now()).toISOString()
    const row: Tables<'orders'> = {
      id: input.clientId,
      outlet_id: input.outletId,
      device_id: shift.device_id,
      order_number: orderNumber,
      business_date: input.businessDate,
      ordered_at: orderedAt,
      created_at: orderedAt,
      created_by: shift.person_id,
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
    row.changed_by = actor?.person_id ?? row.created_by
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

  function applyCancelOrder(record: { orderId: string; shiftId: string; reason: string }) {
    const row = store.orders.find((candidate) => candidate.id === record.orderId)
    if (!row || row.status !== 'open') return
    const actor = store.shifts.find((candidate) => candidate.id === record.shiftId)
    row.status = 'cancelled'
    row.cancel_reason = record.reason
    row.cancelled_at = new Date().toISOString()
    row.cancelled_by = actor?.person_id ?? row.created_by
    row.cancelled_device_id = actor?.device_id ?? row.device_id
    row.cancelled_shift_id = actor?.id ?? null
  }

  function applySetOrderPreparation(orderId: string, prepared: boolean) {
    const row = store.orders.find((candidate) => candidate.id === orderId)
    if (!row || (row.status !== 'open' && !(row.status === 'paid' && prepared))) return
    row.prepared_at = prepared ? new Date().toISOString() : null
    // Settling the upfront payer: money is already held against this order,
    // and preparation was the last thing its bill waited for.
    if (prepared && row.status === 'paid') {
      const held = store.orderPayments.get(row.id)
      if (held) {
        store.orderPayments.delete(row.id)
        materialiseBill(row, held.payments, held.paidAt, held.shiftId)
      }
    }
  }

  /** Create the settled bill a fully-prepared-and-paid order has earned. */
  function materialiseBill(
    row: Tables<'orders'>,
    payments: PaymentAllocation[],
    paidAt: string,
    shiftId: string,
    billId: string = crypto.randomUUID(),
  ) {
    const shift = store.shifts.find((candidate) => candidate.id === shiftId)
    if (!shift) throw new Error(`Settling order ${row.id} has no shift to attribute to.`)
    const nextNumber = (store.billNumbers.get(row.outlet_id) ?? 0) + 1
    store.billNumbers.set(row.outlet_id, nextNumber)
    const bill: Tables<'bills'> = {
      id: billId,
      outlet_id: row.outlet_id,
      bill_number: nextNumber,
      biller_profile_id: row.paid_by ?? shift.person_id,
      counter_device_id: shift.device_id,
      shift_id: null,
      counter_shift_id: shift.id,
      order_id: row.id,
      business_date: row.business_date,
      created_at: paidAt,
      ordered_at: row.ordered_at,
      paid_at: paidAt,
      payment_business_date: shift.business_date,
      recorded_after_shift_end: false,
      attribution_shift_ended_at: null,
      synced_at: new Date().toISOString(),
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      payment_method: payments.length === 1 ? payments[0]!.method : null,
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
    store.billPayments.set(billId, payments)
    // The edit window runs from the money's own clock — for an upfront payer
    // that is when they handed the cash over, not when the kitchen finished.
    acceptedPaymentTimes.set(billId, Date.parse(paidAt))
    store.orderItems
      .filter((line) => line.order_id === row.id)
      .forEach((line, index) =>
        store.billItems.push({
          id: `${billId}-${index}`,
          bill_id: billId,
          menu_item_id: line.menu_item_id,
          item_name: line.item_name,
          unit_price_paise: line.unit_price_paise,
          quantity: line.quantity,
          line_total_paise: line.line_total_paise,
        }),
      )
    row.bill_id = billId
    return billId
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
    row.status = 'paid'
    row.paid_at = payment.paidAt
    row.paid_by = shift.person_id
    row.paid_shift_id = shift.id
    if (row.prepared_at !== null) {
      // Prepared already: the order crosses into Bills at once, keeping the
      // id the provisional view was built from.
      materialiseBill(row, payment.payments, payment.paidAt, shift.id, payment.billId)
    } else {
      // The upfront payer: hold the money against the order. No bill exists
      // until preparation lands — Bills holds only prepared-and-paid work.
      store.orderPayments.set(row.id, {
        payments: payment.payments,
        paidAt: payment.paidAt,
        shiftId: shift.id,
      })
    }
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
    bill.voided_by = openShiftRow()?.person_id ?? bill.biller_profile_id
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
    row.cancelled_by = actor?.person_id ?? row.created_by
    row.cancelled_device_id = actor?.device_id ?? row.device_id
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
            deviceId: creatorShift?.device_id ?? DEMO_COUNTER_DEVICE_ID,
            orderNumber: 0,
            localReference: `Local · ${provisionalToken(input.clientId)}`,
            businessDate: input.businessDate,
            orderedAt: new Date(command.acceptedAtMs).toISOString(),
            preparedAt: null,
            status: 'open',
            creatorId: creatorShift?.person_id ?? '',
            creatorName: actorName(creatorShift?.person_id ?? null) ?? 'Counter operator',
            customerName: input.customerName?.trim() || null,
            customerPhone: input.customerPhone?.trim() || null,
            lines: structuredClone(input.lines),
            totalPaise: totalsOf(input.lines).totalPaise,
            cancelReason: null,
            cancelledAt: null,
            cancelledByName: null,
            paidAt: null,
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
              // A bill exists only when the order was already prepared; the
              // upfront payer holds its money without one until preparation
              // settles it at delivery. Once delivered the command leaves the
              // pending set and the row's own truth shows through.
              billId: current.preparedAt !== null ? record.billId : null,
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
          // `pay_now` settles a walk-up without ever creating an order, so null
          // here is the truthful answer rather than a gap in the demo.
          orderNumber: mockRefusedOrderNumber(command.result),
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
      orderId: string | null
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
      orderId: content.orderId,
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

      const row: Tables<'counter_shifts'> = {
        id: `d6000000-0000-4000-b000-${String(store.shifts.length + 1).padStart(12, '0')}`,
        outlet_id: outletId,
        person_id: billerProfileId,
        device_id: DEMO_COUNTER_DEVICE_ID,
        business_date: store.today,
        opened_at: new Date().toISOString(),
        expires_at: nextCutover(store.today, outletId),
        ended_at: null,
        ended_reason: null,
      }
      store.shifts.push(row)
      emit()
      return toShift(row)
    },

    async inspectFinishDay(shiftId: string) {
      const row = store.shifts.find((candidate) => candidate.id === shiftId)
      if (!row || row.ended_at !== null) {
        throw new BillingActionError('no_shift', 'That shift is not open.')
      }
      drain()
      const needsAttentionCount = [...attention.values()].filter(
        (item) => item.state === 'needs_attention',
      ).length
      const unsentCount = pending.size
      const openOrderCount = projectedOrders(row.outlet_id).filter(
        (order) => order.status === 'open',
      ).length
      const latestPaidAt = Math.max(0, ...acceptedPaymentTimes.values())
      const editablePaymentCount = latestPaidAt + PAYMENT_EDIT_WINDOW_MS > paymentNow() ? 1 : 0
      return {
        unsentCount,
        needsAttentionCount,
        openOrderCount,
        editablePaymentCount,
        serverReachable: isOnline(),
        attributionExceptionCount: store.bills.filter(
          (bill) => bill.recorded_after_shift_end && bill.business_date === row.business_date,
        ).length,
        canFinish:
          isOnline() && unsentCount === 0 && needsAttentionCount === 0 && openOrderCount === 0,
      }
    },

    async closeShift(shiftId: string) {
      const row = store.shifts.find((candidate) => candidate.id === shiftId)
      if (!row || row.ended_at !== null) {
        throw new BillingActionError('no_shift', 'That shift is not open.')
      }
      if (pending.size > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          `${pending.size} billing action${pending.size === 1 ? ' is' : 's are'} still unresolved on this tablet.`,
        )
      }
      // `day_finished` rather than `operator`: the tablet deliberately completed
      // its trading date, which is a different fact from the person walking away
      // — and since #50 it is the one that refuses later work outright.
      row.ended_at = new Date().toISOString()
      row.ended_reason = 'day_finished'
      emit()
    },

    async settleBill(draft: BillDraft) {
      const shift = store.shifts.find((row) => row.id === draft.shiftId && row.ended_at === null)
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
          ? (projectedOrders(openShiftRow()?.outlet_id ?? '').find(
              (order) => order.id === orderPayment.orderId,
            )?.totalPaise ??
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
        orderId: orderPayment?.orderId ?? null,
        orderNumber: order?.orderNumber ?? null,
        billerName: actorName(openShiftRow()?.person_id ?? null) ?? 'Counter operator',
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
        deviceId: shift.device_id,
        orderNumber: 0,
        localReference: `Local · ${provisionalToken(input.clientId)}`,
        businessDate: input.businessDate,
        orderedAt: new Date(acceptedAtMs).toISOString(),
        preparedAt: null,
        status: 'open',
        creatorId: shift.person_id,
        creatorName: actorName(shift.person_id) ?? 'Counter operator',
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        lines: structuredClone(input.lines),
        totalPaise: totalsOf(input.lines).totalPaise,
        cancelReason: null,
        cancelledAt: null,
        cancelledByName: null,
        paidAt: null,
        billId: null,
      }
    },

    async reviseOrder(orderId, input) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.device_id) {
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
      if (!projected || projected.deviceId !== shift.device_id) {
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
      if (!projected || projected.deviceId !== shift.device_id || projected.billId !== billId) {
        throw new BillingActionError('not_found', 'That payment is not on this tablet.')
      }
      // The window runs from the money's own clock: a settled bill's stored
      // paid_at, or the moment an upfront payer's cash was handed over.
      const paidAtMs = billId !== null ? paidAtOf(billId) : Date.parse(projected.paidAt ?? '')
      if (!Number.isFinite(paidAtMs) || paidAtMs === null || Number.isNaN(paidAtMs)) {
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
      if (billId !== null) acceptedPaymentTimes.delete(billId)
      accept({
        commandId,
        type: 'void_order_payment',
        acceptedAtMs: Date.now(),
        apply: () => {
          if (billId !== null) voidBillRow(billId, 'counter_unpay', cleanReason)
          store.orderPayments.delete(orderId)
          reopenPaidOrder(orderId)
        },
      })
      return {
        ...projected,
        status: 'open',
        paidAt: null,
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
      if (!projected || projected.deviceId !== shift.device_id) {
        throw new BillingActionError(
          'not_found',
          'That paid order is not one this tablet can cancel.',
        )
      }
      const billId = projected.billId
      const paidAtMs = billId !== null ? paidAtOf(billId) : Date.parse(projected.paidAt ?? '')
      if (paidAtMs === null || Number.isNaN(paidAtMs)) {
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
      if (billId !== null) acceptedPaymentTimes.delete(billId)
      accept({
        commandId,
        type: 'cancel_paid_order',
        acceptedAtMs: Date.now(),
        apply: () => {
          if (billId !== null) voidBillRow(billId, 'cancelled_after_paid', cleanReason)
          store.orderPayments.delete(orderId)
          cancelPaidOrderRow(orderId, shift.id, cleanReason)
        },
      })
      return {
        ...projected,
        status: 'cancelled',
        billId: null,
        cancelReason: cleanReason,
        cancelledAt: new Date().toISOString(),
        cancelledByName: actorName(shift.person_id),
      }
    },

    async payOrder(orderId, paymentsInput) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.device_id) {
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
      if (projected.preparedAt !== null) acceptedPaymentTimes.set(billId, paymentNow())
      accept({
        commandId: billId,
        type: 'pay_order',
        acceptedAtMs: paymentNow(),
        apply: () => applyPayOrder(record),
      })
      // An unprepared order has no bill yet — its money is held until
      // preparation settles it. The surface reads the null and lets the card
      // keep wearing its Paid marker in Preparing instead of flying left.
      if (projected.preparedAt === null) return null
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
        orderId: projected.id,
        orderNumber: projected.orderNumber,
        billerName: projected.creatorName,
      })
    },

    async cancelOrder(orderId, reason) {
      const shift = requireOpenShift()
      const projected = projectedOrders(shift.outlet_id).find((order) => order.id === orderId)
      if (!projected || projected.deviceId !== shift.device_id)
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
        cancelledByName: actorName(shift.person_id),
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
            bill.counter_shift_id === shiftId &&
            !unwoundBillIds.has(bill.id) &&
            (!shift || bill.business_date === shift.business_date) &&
            (!shift || bill.counter_device_id === shift.device_id),
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
              orderId: null,
              orderNumber: null,
              billerName: actorName(openShiftRow()?.person_id ?? null) ?? 'Counter operator',
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
            orderId: record.orderId,
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

    async reviewAttribution(
      billId: string,
      outcome: BillingAttributionOutcome,
      resolvedOperatorId?: string | null,
      reason?: string | null,
    ) {
      const bill = store.bills.find((candidate) => candidate.id === billId)
      if (!bill?.recorded_after_shift_end) {
        throw new BillingActionError('not_found', 'That attribution exception is not available.')
      }
      requireManager(bill.outlet_id)
      if (attributionReviews.has(billId)) {
        throw new BillingActionError('already_reviewed', 'This attribution was already reviewed.')
      }
      const resolved =
        outcome === 'confirmed_original' ? bill.biller_profile_id : (resolvedOperatorId ?? null)
      const cleanReason = outcome === 'operator_unknown' ? reason?.trim() || null : null
      if (outcome === 'operator_unknown' && !cleanReason) {
        throw new BillingActionError('reason_required', 'Say why the operator is unknown.')
      }
      const review: BillingAttributionReview = {
        id: `review-${billId}`,
        outcome,
        resolvedOperatorId: resolved,
        resolvedOperatorName: resolved ? actorName(resolved) : null,
        reason: cleanReason,
        reviewedBy: context.userId,
        reviewedByName: actorName(context.userId) ?? 'Manager',
        reviewedAt: new Date().toISOString(),
      }
      attributionReviews.set(billId, review)
      emit()
      return review
    },

    async listAttention() {
      const shift = requireTabletOperator()
      return [...attention.values()].filter((item) => item.deviceId === shift.device_id)
    },

    async correctAttention(reference, correctionId) {
      const shift = requireTabletOperator()
      const item = attention.get(reference)
      if (!item || item.deviceId !== shift.device_id)
        throw new BillingActionError('not_found', 'That item is not on this tablet.')
      if (item.state !== 'needs_attention')
        throw new BillingActionError('resolved', 'That item is already resolved.')
      const updated = {
        ...item,
        state: 'corrected' as const,
        linkedCorrectionId: correctionId,
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.person_id,
      }
      attention.set(reference, updated)
      return updated
    },

    async discardAttention(reference, reason) {
      const shift = requireTabletOperator()
      const item = attention.get(reference)
      if (!item || item.deviceId !== shift.device_id)
        throw new BillingActionError('not_found', 'That item is not on this tablet.')
      if (item.state !== 'needs_attention')
        throw new BillingActionError('resolved', 'That item is already resolved.')
      const updated = {
        ...item,
        state: 'discarded' as const,
        discardReason: requireReason(reason),
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.person_id,
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
          orderNumber: mockRefusedOrderNumber(command.result),
        }))
    },
  }
}
