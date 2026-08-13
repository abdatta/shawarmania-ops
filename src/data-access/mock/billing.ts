import { billTotals, classifySync, lineTotalPaise, PAYMENT_EDIT_WINDOW_MS } from '@/domain'

import {
  BillingActionError,
  BILLING_PAYMENT_METHODS,
  type BillDraft,
  type BillingAttentionItem,
  type BillingAdapter,
  type BillingBill,
  type BillingOrder,
  type CounterBiller,
  type CounterShift,
  type CounterState,
  type PaymentAllocation,
  type QueuedBill,
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
import type { DemoStore } from './store'

/**
 * The mock counter: an in-memory queue that behaves the way the real one is
 * specified to, and is honest about being none of its durability.
 *
 * **This is not the outbox.** `src/outbox/` stays deliberately empty until
 * `counter-devices-and-offline` (#9), which brings IndexedDB, retry and real
 * exactly-once delivery. What this reproduces is the queue's *observable
 * states* — a bill waiting, a count climbing, an indicator escalating, a number
 * appearing only once the bill has landed — so the offline experience can be
 * reviewed before the machinery behind it exists.
 *
 * Four clauses of `openspec/specs/counter-billing/spec.md` are mirrored here on
 * purpose, each beside the sentence it comes from:
 *
 *  - a bill's identity is its **client-generated UUID**, and the same id twice
 *    stores one bill;
 *  - **bill numbers are assigned on send**, per outlet, sequentially — never by
 *    the client and never on enqueue;
 *  - a **cancelled** bill consumes no number, so the sequence has no gap;
 *  - a settled bill is **append-only**, which is why there is no update method
 *    anywhere below.
 *
 * Connectivity is the browser's own: online it drains, offline it accumulates.
 * A demo-only "pretend to be offline" control would be UI that ships and then
 * has to be removed, and it would reach the escalated state a different way from
 * the way a real tablet reaches it.
 */

/** How long a bill takes to "reach the server" after local acceptance. */
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
 * What the queue holds: the bill as the counter made it, and what the screen
 * needs to say about it. The draft rides along because **an unsent bill is not
 * in the database** — it exists only here until it lands, which is why
 * cancelling one has nothing to clean up and burns no number.
 */
interface QueueEntry {
  queued: QueuedBill
  draft: BillDraft
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
  const acceptedPaymentTimes = new Map<string, number>()
  /** Queue entries by client id — the mock's stand-in for the outbox's key. */
  const queue = new Map<string, QueueEntry>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let tick: ReturnType<typeof setInterval> | null = null
  let paymentClockOffsetMs = 0
  const paymentNow = () => Date.now() + paymentClockOffsetMs

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
    for (const draft of store.billingQueueSeeds) {
      const totals = billTotals(
        draft.lines.map((line) => ({
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
        })),
      )
      queue.set(draft.clientId, {
        draft: structuredClone(draft),
        queued: {
          clientId: draft.clientId,
          totalPaise: totals.totalPaise,
          businessDate: draft.businessDate,
          queuedAt: Date.now() - 30_000,
        },
      })
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

  function openShiftRow(): Tables<'shifts'> | undefined {
    return store.shifts.find((row) => row.closed_at === null)
  }

  function buildSnapshot(): CounterState {
    // The queue holds what has **not** gone. A delivered bill leaves it, because
    // by then it is a row in `bills` and an outbox that never empties is not an
    // outbox — it is a log with a misleading name.
    const queued = [...queue.values()]
      .map((entry) => entry.queued)
      .sort((a, b) => a.queuedAt - b.queuedAt)
    const row = openShiftRow()

    return {
      shift: row ? toShift(row) : null,
      queued,
      sync: {
        pending: queued.length,
        kind: classifySync({
          pending: queued.length,
          oldestQueuedAt: queued[0]?.queuedAt ?? null,
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
   * Keep re-emitting while bills wait, so the indicator can escalate on age as
   * well as on count — a single bill stuck for two minutes is the case a
   * count-only rule would never notice.
   *
   * Only while something is actually watching. An interval that outlived the
   * screen it feeds would tick for the life of the tab, holding the whole queue
   * alive behind it.
   */
  function syncTicker() {
    const waiting = queue.size > 0 && listeners.size > 0
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
    for (const [clientId, timer] of timers) {
      clearTimeout(timer)
      timers.delete(clientId)
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
      businessDate: row.business_date,
      orderedAt: row.ordered_at,
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
      voidReason: row.void_reason,
      voidedAt: row.voided_at,
      voidedBy: row.voided_by ? { id: row.voided_by, name: actorName(row.voided_by) } : null,
    }
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

  function replaceOrderLines(orderId: string, lines: BillDraft['lines']) {
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

  /**
   * Deliver one queued bill: insert it, number it as the server would, and
   * snapshot its lines.
   *
   * This is the only place a bill row is created, and the only place a number is
   * spent — so a bill cancelled inside the undo window never existed and left no
   * gap in the outlet's sequence.
   */
  function send(clientId: string) {
    // Cleared in every path, including the ones that give up: a timer entry left
    // behind would make `drain` skip this bill for ever, because it would look
    // like one that is already on its way.
    timers.delete(clientId)

    const entry = queue.get(clientId)
    if (!entry || !isOnline()) return

    const { draft } = entry
    // Always present: `settleBill` refuses a draft whose shift is not open, and
    // a closed shift stays on the store rather than being removed — a bill that
    // outlived its shift still has to be attributed to whoever rang it.
    const shift = store.shifts.find((row) => row.id === draft.shiftId)
    if (!shift) throw new Error(`Queued bill ${draft.clientId} has no shift to attribute to.`)

    const totals = billTotals(
      draft.lines.map((line) => ({
        unitPricePaise: line.unitPricePaise,
        quantity: line.quantity,
      })),
    )
    const payments = requireExactPayments(draft.payments, totals.totalPaise)

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
      created_at: new Date(entry.queued.queuedAt).toISOString(),
      ordered_at: new Date(entry.queued.queuedAt).toISOString(),
      paid_at: new Date(entry.queued.queuedAt).toISOString(),
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

    queue.delete(clientId)
    emit()
    syncTicker()
  }

  /** Try to send everything still waiting — what reconnecting does. */
  function drain() {
    if (!isOnline()) return
    for (const [clientId] of queue) {
      if (timers.has(clientId)) continue
      timers.set(
        clientId,
        setTimeout(() => send(clientId), SEND_LATENCY_MS),
      )
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
      if (listeners.size === 1) watchConnectivity(true)
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
      if (queue.has(draft.clientId) || store.bills.some((row) => row.id === draft.clientId)) {
        throw new BillingActionError('duplicate', 'That bill has already been recorded.')
      }

      const totals = billTotals(
        draft.lines.map((line) => ({
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
        })),
      )
      requireExactPayments(draft.payments, totals.totalPaise)

      queue.set(draft.clientId, {
        draft: structuredClone(draft),
        queued: {
          clientId: draft.clientId,
          totalPaise: totals.totalPaise,
          businessDate: draft.businessDate,
          queuedAt: paymentNow(),
        },
      })
      acceptedPaymentTimes.set(draft.clientId, paymentNow())

      drain()
      emit()
      syncTicker()
    },

    async correctBillPayment(billId, expectedRevision, paymentsInput) {
      requireTabletOperator()
      const queued = queue.get(billId)
      const row = store.bills.find((bill) => bill.id === billId)
      const paidAt = queued ? queued.queued.queuedAt : row ? Date.parse(row.paid_at) : Number.NaN
      const totalPaise = queued?.queued.totalPaise ?? row?.total_paise
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
      const draft = queued!.draft
      return {
        id: billId,
        outletId: draft.outletId,
        billNumber: 0,
        orderNumber: null,
        businessDate: draft.businessDate,
        orderedAt: new Date(paidAt).toISOString(),
        paidAt: new Date(paidAt).toISOString(),
        paymentBusinessDate: draft.businessDate,
        payments,
        paymentRevision: revisions.length,
        paymentEditableUntil: new Date(paidAt + PAYMENT_EDIT_WINDOW_MS).toISOString(),
        paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
        status: 'settled',
        billerName: actorName(openShiftRow()?.biller_profile_id ?? null) ?? 'Counter operator',
        customerName: draft.customerName?.trim() || null,
        customerPhone: draft.customerPhone?.trim() || null,
        lines: draft.lines,
        totalPaise,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
      }
    },

    async saveOrder(input) {
      const shift = requireOpenShift()
      if (shift.id !== input.shiftId || shift.outlet_id !== input.outletId) {
        throw new BillingActionError('no_shift', 'This order does not belong to the open shift.')
      }
      if (input.lines.length === 0) {
        throw new BillingActionError('empty_order', 'There is nothing on this order.')
      }
      if (store.orders.some((order) => order.id === input.clientId)) {
        throw new BillingActionError('duplicate', 'That order has already been saved.')
      }
      const totals = billTotals(
        input.lines.map((line) => ({
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
        })),
      )
      const counterKey = `${input.outletId}:${input.businessDate}`
      const orderNumber = (store.orderNumbers.get(counterKey) ?? 0) + 1
      store.orderNumbers.set(counterKey, orderNumber)
      const now = new Date().toISOString()
      const row: Tables<'orders'> = {
        id: input.clientId,
        outlet_id: input.outletId,
        device_id: shift.counter_device_id,
        order_number: orderNumber,
        business_date: input.businessDate,
        ordered_at: now,
        created_at: now,
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
      emit()
      return orderView(row)
    },

    async reviseOrder(orderId, input) {
      const shift = requireOpenShift()
      const row = store.orders.find((order) => order.id === orderId)
      if (!row || row.device_id !== shift.counter_device_id) {
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      }
      if (row.status !== 'open') {
        const by = actorName(row.cancelled_by)
        throw new BillingActionError(
          'order_cancelled',
          row.status === 'cancelled'
            ? `Order ${row.order_number} was cancelled${by ? ` by ${by}` : ''}.`
            : `Order ${row.order_number} is no longer open.`,
        )
      }
      if (input.lines.length === 0)
        throw new BillingActionError('empty_order', 'There is nothing on this order.')
      const totals = billTotals(
        input.lines.map((line) => ({
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
        })),
      )
      row.changed_at = new Date().toISOString()
      row.changed_by = shift.biller_profile_id
      row.changed_shift_id = shift.id
      row.customer_id = input.customerId ?? null
      row.customer_name = input.customerName?.trim() || null
      row.customer_phone = input.customerPhone?.trim() || null
      row.subtotal_paise = totals.subtotalPaise
      row.discount_paise = 0
      row.tax_paise = 0
      row.total_paise = totals.totalPaise
      replaceOrderLines(row.id, input.lines)
      emit()
      return orderView(row)
    },

    async listOpenOrders(outletId) {
      const shift = requireOpenShift()
      if (shift.outlet_id !== outletId) return []
      return store.orders
        .filter(
          (order) =>
            order.outlet_id === outletId &&
            order.device_id === shift.counter_device_id &&
            order.status === 'open',
        )
        .sort((a, b) => a.ordered_at.localeCompare(b.ordered_at))
        .map(orderView)
    },

    async payOrder(orderId, paymentsInput) {
      const shift = requireOpenShift()
      const row = store.orders.find((order) => order.id === orderId)
      if (!row || row.device_id !== shift.counter_device_id) {
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      }
      if (row.status === 'cancelled') {
        const by = actorName(row.cancelled_by)
        throw new BillingActionError(
          'order_cancelled',
          `Order ${row.order_number} was cancelled${by ? ` by ${by}` : ''}.`,
        )
      }
      if (row.status !== 'open')
        throw new BillingActionError('order_closed', `Order ${row.order_number} is already paid.`)
      const payments = requireExactPayments(paymentsInput, row.total_paise)
      const nextNumber = (store.billNumbers.get(row.outlet_id) ?? 0) + 1
      store.billNumbers.set(row.outlet_id, nextNumber)
      const paidAt = new Date(paymentNow()).toISOString()
      const billId = crypto.randomUUID()
      const bill: Tables<'bills'> = {
        id: billId,
        outlet_id: row.outlet_id,
        bill_number: nextNumber,
        biller_profile_id: shift.biller_profile_id,
        counter_device_id: shift.counter_device_id,
        shift_id: shift.id,
        counter_shift_id: null,
        order_id: row.id,
        business_date: row.business_date,
        created_at: paidAt,
        ordered_at: row.ordered_at,
        paid_at: paidAt,
        payment_business_date: shift.business_date,
        synced_at: paidAt,
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
        void_reason: null,
        voided_at: null,
        voided_by: null,
      }
      store.bills.push(bill)
      store.billPayments.set(billId, payments)
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
      row.status = 'paid'
      row.bill_id = billId
      row.paid_at = paidAt
      row.paid_by = shift.biller_profile_id
      row.paid_shift_id = shift.id
      emit()
      return billView(bill)
    },

    async cancelOrder(orderId, reason) {
      const shift = requireOpenShift()
      const row = store.orders.find((order) => order.id === orderId)
      if (!row || row.device_id !== shift.counter_device_id)
        throw new BillingActionError('not_found', 'That order is not on this tablet.')
      if (row.status !== 'open')
        throw new BillingActionError('order_closed', `Order ${row.order_number} is no longer open.`)
      row.status = 'cancelled'
      row.cancel_reason = requireReason(reason)
      row.cancelled_at = new Date().toISOString()
      row.cancelled_by = shift.biller_profile_id
      row.cancelled_device_id = shift.counter_device_id
      row.cancelled_shift_id = shift.id
      emit()
      return orderView(row)
    },

    async listShiftHistory(shiftId) {
      const shift = store.shifts.find((candidate) => candidate.id === shiftId)
      const serverBills = store.bills
        .filter(
          (bill) =>
            bill.shift_id === shiftId &&
            (!shift || bill.business_date === shift.business_date) &&
            (!shift || bill.counter_device_id === shift.counter_device_id),
        )
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
        .map(billView)
      const queuedBills: BillingBill[] = [...queue.values()]
        .filter((entry) => entry.draft.shiftId === shiftId)
        .map((entry) => {
          const payments =
            paymentCorrections.get(entry.draft.clientId)?.at(-1) ?? entry.draft.payments
          return {
            id: entry.draft.clientId,
            outletId: entry.draft.outletId,
            billNumber: 0,
            orderNumber: null,
            businessDate: entry.draft.businessDate,
            orderedAt: new Date(entry.queued.queuedAt).toISOString(),
            paidAt: new Date(entry.queued.queuedAt).toISOString(),
            paymentBusinessDate: entry.draft.businessDate,
            payments,
            paymentRevision: paymentCorrections.get(entry.draft.clientId)?.length ?? 0,
            paymentEditableUntil: new Date(
              entry.queued.queuedAt + PAYMENT_EDIT_WINDOW_MS,
            ).toISOString(),
            paymentMethod: payments.length > 1 ? ('mixed' as const) : payments[0]!.method,
            status: 'settled' as const,
            billerName: actorName(openShiftRow()?.biller_profile_id ?? null) ?? 'Counter operator',
            customerName: entry.draft.customerName?.trim() || null,
            customerPhone: entry.draft.customerPhone?.trim() || null,
            lines: entry.draft.lines,
            totalPaise: entry.queued.totalPaise,
            voidReason: null,
            voidedAt: null,
            voidedBy: null,
          }
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
      row.void_reason = requireReason(reason)
      row.voided_at = new Date().toISOString()
      row.voided_by = context.userId
      return billView(row)
    },

    async listManagerOpenOrders(outletId) {
      requireManager(outletId)
      return store.orders
        .filter((order) => order.outlet_id === outletId && order.status === 'open')
        .sort((a, b) => a.ordered_at.localeCompare(b.ordered_at))
        .map(orderView)
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
