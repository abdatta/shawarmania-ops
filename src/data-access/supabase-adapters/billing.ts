import { liveQuery, type Subscription } from 'dexie'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  createBillingCommand,
  type BillingCommand,
  type BillingPaymentAllocation,
  type OrderContentPayload,
} from '../../../shared/billing-command'
import {
  BILLING_PAYMENT_METHODS,
  BillingActionError,
  type BillDraft,
  type BillDiscountDraft,
  type BillLineDraft,
  type BillingAdapter,
  type BillingAttentionItem,
  type BillingAttributionOutcome,
  type BillingAttributionReview,
  type BillingBill,
  type BillingCommandAdapter,
  type BillingDeliveryDiagnostic,
  type BillingOrder,
  type CounterState,
  type PaymentAllocation,
  type SaveOrderInput,
} from '../adapters'
import type { Database, Tables } from '../database.types'
import {
  AWAITING_ORDER_NUMBER,
  billTotals,
  classifySync,
  lineTotalPaise,
  ticketEditDeadlineMs,
  type TicketEditFacts,
} from '@/domain'
import { receiptLink } from '@/lib/receipt-link'
import { newUuid } from '@/lib/uuid'
import {
  BillingDeliveryDatabase,
  BillingDeliveryStore,
  BillingDeliveryStoreError,
  BillingDrainCoordinator,
  BillingUnsentReporter,
  counterResumeStopAt,
  drainCounterExpenses,
  forgetRememberedCustomers,
  listCounterExpenses,
  type BillingDeliveryEnvelopeRecord,
  type BillingLockManager,
  type CounterResumeCoordinator,
} from '@/outbox'
import type { CounterDeviceSession } from '@/session/counter-session'

import { createSupabaseBillingCommandAdapter } from './billing-command'

/**
 * The order number a refusal names, if it names one. Rows written before the
 * naming migration carry none, so this is a widening read and never a schema
 * assumption.
 */
function refusedOrderNumber(result: unknown): number | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const named = (result as { orderNumber?: unknown }).orderNumber
  return typeof named === 'number' && Number.isFinite(named) ? named : null
}

type OrderReadRow = Tables<'orders'> & {
  order_items: Tables<'order_items'>[]
  order_discounts: Tables<'order_discounts'>[]
  creator: { full_name: string } | { full_name: string }[] | null
  canceller: { full_name: string } | { full_name: string }[] | null
}

type BillReadRow = Tables<'bills'> & {
  bill_items: Tables<'bill_items'>[]
  bill_discounts: Tables<'bill_discounts'>[]
  // A **to-one** embed, because `bill_public_links.bill_id` is its primary key
  // referencing `bills`. PostgREST returns one object rather than an array for
  // that shape, so this goes through `joined()` like every other to-one here —
  // typed both ways because the client's own types describe it as either.
  bill_public_links: PublicLinkReadRow | PublicLinkReadRow[] | null
  bill_payments: Tables<'bill_payments'>[]
  // `prepared_at` rides along because the bill's edit window is derived from
  // it as well as from `paid_at` (#55).
  order:
    | { order_number: number; prepared_at: string | null }
    | { order_number: number; prepared_at: string | null }[]
    | null
  biller: { full_name: string } | { full_name: string }[] | null
  voider: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  attribution_reviews: ReviewReadRow[] | ReviewReadRow | null
}

/**
 * The ticket's edit window as a bill carries it (#55).
 *
 * `paymentEditableUntil` is null while the window has not started, which is the
 * unprepared order's case and not the same thing as "not editable" —
 * `paymentEditable` is the field that answers that. Both come from the one
 * domain function, which computes the expression `billing_edit_window_end`
 * computes in the database: a screen that disagrees with the server is how a
 * refusal arrives with no warning.
 */
function editWindowOf(facts: TicketEditFacts): { paymentEditableUntil: string | null } {
  const deadline = ticketEditDeadlineMs(facts)
  return { paymentEditableUntil: deadline === null ? null : new Date(deadline).toISOString() }
}

type PublicLinkReadRow = { token: string; revoked_at: string | null }

type ReviewReadRow = Tables<'billing_attribution_reviews'> & {
  resolved_operator: { full_name: string } | { full_name: string }[] | null
  reviewer: { full_name: string } | { full_name: string }[] | null
}

type EffectivePaymentRow = {
  bill_id: string
  outlet_id: string
  method: PaymentAllocation['method']
  amount_paise: number
  revision: number
}

function joined<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function lineView(row: Tables<'order_items'> | Tables<'bill_items'>): BillLineDraft {
  return {
    menuItemId: row.menu_item_id ?? '',
    itemName: row.item_name,
    unitPricePaise: row.unit_price_paise,
    quantity: row.quantity,
    // Without these three a line read back from the server has no discount, so
    // the bill detail shows none and reopening an order for edit loses it.
    discountPaise: row.discount_paise,
    discountPercentBp: row.discount_percent_bp,
    categoryName: row.category_name,
  }
}

function orderView(row: OrderReadRow, historicalDeviceLabel: string | null): BillingOrder {
  return {
    id: row.id,
    outletId: row.outlet_id,
    deviceId: row.device_id,
    orderNumber: row.order_number,
    businessDate: row.business_date,
    orderedAt: row.ordered_at,
    preparedAt: row.prepared_at,
    status: row.status,
    creatorId: row.created_by,
    creatorName: joined(row.creator)?.full_name ?? 'Counter operator',
    deviceLabel: historicalDeviceLabel,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines: row.order_items.map(lineView),
    discounts: (row.order_discounts ?? []).map((discount) => ({
      basis: discount.basis,
      valueBp: discount.value_bp,
      valuePaise: discount.value_paise,
      amountPaise: discount.amount_paise,
    })),
    roundingPaise: row.rounding_paise,
    totalPaise: row.total_paise,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    cancelledByName: joined(row.canceller)?.full_name ?? null,
    paidAt: row.paid_at,
    billId: row.bill_id,
  }
}

/**
 * The same refusal the database gives for an order this tablet does not own,
 * given in place and before a command exists.
 *
 * Ownership has always been the database's to enforce, and it still is. What
 * changes with several tablets at one outlet is **when** the operator finds
 * out. The pipeline is outlet-wide, so a neighbouring tablet's order has always
 * been on screen; while an outlet had one tablet there was no neighbour, and
 * once there is, a refusal that only arrives from the server arrives late --
 * and offline it does not arrive at all until the queue drains, by which time
 * the operator has moved on and the command is waiting to fail.
 *
 * So the refusal is local, and it captures nothing. That is the whole of what
 * `offline-billing-resumption` requires of a resumed tablet: it is handed a
 * remembered pipeline holding work it may not touch, with no server to ask.
 *
 * It names the till where it can, because "this order is not yours" is not
 * actionable and "it was taken on the takeaway counter" is.
 */
function requireOwnOrder(order: BillingOrder, deviceId: string): void {
  if (order.deviceId === deviceId) return
  throw new BillingActionError(
    'not_this_tablet',
    `That order was taken on ${order.deviceLabel ?? 'another counter'}, so it can only be changed there.`,
  )
}

function billView(
  row: BillReadRow,
  effective: readonly EffectivePaymentRow[],
  paymentEditable: boolean,
  historicalDeviceLabel: string | null,
): BillingBill {
  const voider = joined(row.voider)
  const review = joined(row.attribution_reviews)
  const publicLink = joined(row.bill_public_links)
  const effectiveForBill = effective.filter((payment) => payment.bill_id === row.id)
  const payments =
    effectiveForBill.length > 0
      ? effectiveForBill.map((payment) => ({
          method: payment.method,
          amountPaise: payment.amount_paise,
        }))
      : row.bill_payments.length > 0
        ? row.bill_payments.map((payment) => ({
            method: payment.method,
            amountPaise: payment.amount_paise,
          }))
        : row.payment_method
          ? [{ method: row.payment_method, amountPaise: row.total_paise }]
          : []
  if (payments.length === 0) {
    throw new BillingActionError(
      'invalid_bill_data',
      'This bill has no payment allocation and cannot be shown as Cash or UPI.',
    )
  }
  return {
    id: row.id,
    outletId: row.outlet_id,
    billNumber: row.bill_number,
    orderId: row.order_id,
    orderNumber: joined(row.order)?.order_number ?? null,
    businessDate: row.business_date,
    orderedAt: row.ordered_at,
    paidAt: row.paid_at,
    paymentBusinessDate: row.payment_business_date,
    payments,
    paymentRevision: Math.max(0, ...effectiveForBill.map((payment) => payment.revision)),
    paymentEditable,
    ...editWindowOf({
      paidAt: row.paid_at,
      preparedAt: joined(row.order)?.prepared_at ?? null,
      // Nullable, and the null is the direct sale rather than an unprepared
      // order. Reading it the other way would hand every direct bill an
      // unbounded window.
      settlesAnOrder: row.order_id !== null,
    }),
    paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
    status: row.status,
    billerName: joined(row.biller)?.full_name ?? 'Counter operator',
    tillLabel: historicalDeviceLabel,
    billerId: row.biller_profile_id,
    recordedAfterShiftEnd: row.recorded_after_shift_end,
    attributionShiftEndedAt: row.attribution_shift_ended_at,
    attributionReview: review
      ? {
          id: review.id,
          outcome: review.outcome as BillingAttributionOutcome,
          resolvedOperatorId: review.resolved_operator_id,
          resolvedOperatorName: joined(review.resolved_operator)?.full_name ?? null,
          reason: review.reason,
          reviewedBy: review.reviewed_by,
          reviewedByName: joined(review.reviewer)?.full_name ?? 'Manager',
          reviewedAt: review.reviewed_at,
        }
      : null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines: row.bill_items.map(lineView),
    discounts: (row.bill_discounts ?? []).map((discount) => ({
      basis: discount.basis,
      valueBp: discount.value_bp,
      valuePaise: discount.value_paise,
      amountPaise: discount.amount_paise,
    })),
    roundingPaise: row.rounding_paise,
    totalPaise: row.total_paise,
    voidKind: row.void_kind,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: voider ? { id: voider.id, name: voider.full_name } : null,
    // A revoked link is not offered for sharing again. It resolves for nobody,
    // and re-sending a killed URL would be handing out a refusal.
    receiptUrl: receiptLink(publicLink && publicLink.revoked_at === null ? publicLink.token : null),
  }
}

function requirePayments(
  payments: readonly PaymentAllocation[],
  totalPaise: number,
): BillingPaymentAllocation[] {
  const seen = new Set<string>()
  const valid = payments.every(
    (payment) =>
      BILLING_PAYMENT_METHODS.includes(payment.method) &&
      Number.isInteger(payment.amountPaise) &&
      payment.amountPaise > 0 &&
      !seen.has(payment.method) &&
      Boolean(seen.add(payment.method)),
  )
  if (!valid || payments.reduce((sum, payment) => sum + payment.amountPaise, 0) !== totalPaise) {
    throw new BillingActionError(
      'invalid_payment',
      'Use one or more exact Cash or UPI amounts that add up to the bill total.',
    )
  }
  return payments.map(({ method, amountPaise }) => ({ method, amountPaise }))
}

/**
 * The discount a set of lines and bill-level records comes to, together.
 *
 * Every discount is already resolved to paise against the gross base of its own
 * scope by the time it reaches here, so this only adds them up. The cap at the
 * subtotal is `billTotals`', because the cap belongs with the identity it
 * protects rather than with the summing.
 */
function discountTotalPaise(
  lines: readonly BillLineDraft[],
  discounts: readonly BillDiscountDraft[],
): number {
  return (
    lines.reduce((sum, line) => sum + (line.discountPaise ?? 0), 0) +
    discounts.reduce((sum, discount) => sum + discount.amountPaise, 0)
  )
}

function orderPayload(
  orderId: string,
  businessDate: string,
  lines: readonly BillLineDraft[],
  customer: {
    customerId?: string | null
    customerName?: string | null
    customerPhone?: string | null
  },
  discounts: readonly BillDiscountDraft[] = [],
): OrderContentPayload {
  const totals = billTotals(lines, { discountPaise: discountTotalPaise(lines, discounts) })
  return {
    orderId,
    businessDate,
    customerId: customer.customerId ?? null,
    customerName: customer.customerName?.trim() || null,
    customerPhone: customer.customerPhone?.trim() || null,
    ...totals,
    pricingMode: 'no_tax',
    lines: lines.map((line) => ({
      id: newUuid(),
      menuItemId: line.menuItemId || null,
      itemName: line.itemName,
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      lineTotalPaise: lineTotalPaise(line.unitPricePaise, line.quantity),
      discountPaise: line.discountPaise ?? 0,
      discountPercentBp: line.discountPercentBp ?? null,
      categoryName: line.categoryName ?? null,
    })),
    discounts: discounts.map((discount) => ({ ...discount })),
  }
}

function actionError(cause: unknown, fallback: string): BillingActionError {
  if (cause instanceof BillingActionError) return cause
  if (cause instanceof BillingDeliveryStoreError) {
    return new BillingActionError(cause.code, cause.message)
  }
  return new BillingActionError('failed', fallback)
}

async function requireAccepted(
  commands: BillingCommandAdapter,
  command: BillingCommand,
  fallback: string,
) {
  try {
    const result = await commands.execute(command)
    if (result.status === 'accepted' || result.status === 'replay') return result
    throw new BillingActionError(result.status, fallback)
  } catch (cause) {
    if (cause instanceof BillingActionError) throw cause
    throw new BillingActionError('unavailable', fallback)
  }
}

/**
 * How many pending order ids the pipeline read will name before it gives up on
 * narrowing and asks for everything.
 *
 * A uuid costs 37 characters inside `id.in.(…)`, and a request past the
 * gateway's URI limit comes back 414 — the rail simply stops loading. A tablet
 * that has been offline long enough to queue this many orders therefore pays
 * the old unbounded read, which is slow and correct, rather than a cheap one
 * that fails outright.
 */
export const ENVELOPE_ID_QUERY_LIMIT = 100

/**
 * The order an undelivered command is about, when it is about one. A bill-only
 * command — `pay_now`, `correct_bill_payment`, `void_bill` — and the end-of-day
 * confirmation name no order.
 */
function envelopeOrderId(command: BillingCommand): string | null {
  switch (command.type) {
    case 'create_order':
    case 'revise_order':
    case 'cancel_order':
    case 'manager_cancel_order':
    case 'pay_order':
    case 'set_order_preparation':
    case 'void_order_payment':
    case 'cancel_paid_order':
      return command.payload.orderId
    default:
      return null
  }
}

/**
 * What the rail holds, asked of the server instead of asked of the rows it
 * already sent.
 *
 * `counter-billing` keeps an order on the rail until it is BOTH prepared and
 * paid, which is exactly the predicate `inPipeline` applies after the read — so
 * asking for it here changes nothing on screen. What it changes is the wire:
 * `paid` is terminal, so without this the read carries every order the outlet
 * has ever sold, and grows for as long as the outlet trades.
 *
 * **The envelope ids are the correctness half, not an optimisation.**
 * `projectOrders` only overlays rows the query returned, so an order that is
 * paid AND prepared — off the rail, and therefore outside the predicate — would
 * never be fetched for an undelivered `void_order_payment` or reprepare to
 * reopen. The overlay's `if (current)` guard would drop the unwind silently and
 * the card would never come back. Naming those ids is what keeps that visible.
 *
 * Returns null when there is nothing safe to narrow to, and the caller sends
 * the unnarrowed read.
 */
function pipelineFilter(envelopes: readonly BillingDeliveryEnvelopeRecord[] | null): string | null {
  const touched = [
    ...new Set(
      (envelopes ?? [])
        .map((envelope) => envelopeOrderId(envelope.command))
        .filter((id): id is string => id !== null),
    ),
  ]
  if (touched.length > ENVELOPE_ID_QUERY_LIMIT) return null
  const clauses = ['status.eq.open', 'and(status.eq.paid,prepared_at.is.null)']
  if (touched.length > 0) clauses.push(`id.in.(${touched.join(',')})`)
  return clauses.join(',')
}

/**
 * Billing's live adapter. Tablet writes cross the IndexedDB commit boundary and
 * return immediately; the one drain leader delivers them later. Manager writes
 * are online personal-device commands and never create a second local outbox.
 */
export function createSupabaseBillingAdapter(
  client: SupabaseClient<Database>,
  counterSession: CounterDeviceSession | null = null,
  resumeCoordinator?: CounterResumeCoordinator,
): BillingAdapter {
  const commands = createSupabaseBillingCommandAdapter(client)
  const orderCache = new Map<string, BillingOrder>()
  const localBillCache = new Map<string, BillingBill>()
  const database = counterSession ? new BillingDeliveryDatabase() : null
  const store = database ? new BillingDeliveryStore(database) : null
  const listeners = new Set<() => void>()
  let deliverySubscription: Subscription | null = null
  let drain: BillingDrainCoordinator | null = null
  let reporter: BillingUnsentReporter | null = null
  let deliveryReachable: boolean | null = null
  let oldestQueuedAt: number | null = null
  let tabletRemoved = false
  let state: CounterState = {
    shift: counterSession?.shift
      ? {
          id: counterSession.shift.id,
          outletId: counterSession.shift.outletId,
          billerProfileId: counterSession.shift.personId,
          billerName: 'Counter operator',
          businessDate: counterSession.shift.businessDate,
          openedAt: counterSession.shift.openedAt,
        }
      : null,
    queued: [],
    sync: { kind: 'synced', pending: 0 },
  }

  for (const order of counterSession?.offlineResume?.pipeline ?? []) {
    orderCache.set(order.id, structuredClone(order))
  }

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  /**
   * One temporal lookup for a whole page. The database checks each event's
   * authority before returning only the label effective at its own instant.
   */
  async function deviceLabelsFor(
    eventKind: 'bill' | 'order',
    eventIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map()
    const { data, error } = await client.rpc('billing_event_device_labels', {
      p_event_kind: eventKind,
      p_event_ids: [...eventIds],
    })
    if (error) throw actionError(error, 'Could not load historical counter names.')
    return new Map((data ?? []).map((row) => [row.event_id, row.label]))
  }

  function requireTablet() {
    if (!counterSession || !store) {
      throw new BillingActionError('not_permitted', 'This action belongs on the counter tablet.')
    }
    if (!counterSession.shift) {
      throw new BillingActionError('no_shift', 'Open a shift before taking billing work.')
    }
    if (tabletRemoved) {
      throw new BillingActionError(
        'removed_tablet',
        'This tablet has been removed. Its unsent evidence remains here, but it cannot take more work.',
      )
    }
    if (
      state.shift === null ||
      state.shift.id !== counterSession.shift.id ||
      Math.min(
        Date.parse(counterSession.shift.expiresAt),
        counterSession.offlineResume
          ? counterResumeStopAt(counterSession.offlineResume)
          : Number.POSITIVE_INFINITY,
      ) <= Date.now()
    ) {
      throw new BillingActionError(
        'no_shift',
        'This shift has ended. Approve a fresh shift before taking more billing work.',
      )
    }
    return { session: counterSession, shift: counterSession.shift, store }
  }

  function requireCurrentScope(outletId: string, shiftId: string, businessDate: string) {
    const tablet = requireTablet()
    if (
      outletId !== tablet.session.device.outletId ||
      shiftId !== tablet.shift.id ||
      businessDate !== tablet.shift.businessDate
    ) {
      throw new BillingActionError(
        'not_permitted',
        'That work does not belong to this tablet’s live outlet and business date.',
      )
    }
    return tablet
  }

  function deliverySync(pending: number, hasAttention = false): CounterState['sync'] {
    return {
      pending,
      kind:
        pending > 0 && (deliveryReachable === false || hasAttention)
          ? 'stalled'
          : classifySync({ pending, oldestQueuedAt, now: Date.now() }),
    }
  }

  async function previousInChain(chainId: string): Promise<string[]> {
    if (!database) return []
    const rows = await database.envelopes
      .where('[chainId+createdAtMs]')
      .between([chainId, Number.MIN_SAFE_INTEGER], [chainId, Number.MAX_SAFE_INTEGER])
      .sortBy('createdAtMs')
    return rows.length > 0 ? [rows.at(-1)!.commandId] : []
  }

  async function accept(
    command: BillingCommand,
    outletId: string,
    businessDate: string,
    chainId: string,
    dependsOnCommandIds: readonly string[] = [],
  ): Promise<void> {
    const tablet = requireTablet()
    const nowMs = Date.now()
    await tablet.store.accept({
      command,
      tabletId: tablet.session.device.deviceId,
      outletId,
      businessDate,
      chainId,
      dependsOnCommandIds: [...(await previousInChain(chainId)), ...dependsOnCommandIds],
      eligibleAtMs: nowMs,
      nowMs,
    })
  }

  /**
   * Is this order still on the counter's pipeline? Open orders always are; a
   * **paid but not yet prepared** order is too — it stays in Preparing wearing
   * its Paid marker until preparation lands it in Bills. A paid and prepared
   * order is fully done, and a cancelled one never was pipeline work.
   */
  function inPipeline(order: Pick<BillingOrder, 'status' | 'preparedAt'>): boolean {
    return order.status === 'open' || (order.status === 'paid' && order.preparedAt === null)
  }

  /**
   * What this tablet believes about its orders: the server's rows with every
   * locally accepted-but-not-yet-delivered command replayed over them.
   *
   * Named, and taking both sides as arguments, because the payment guard has to
   * reach the same verdict as the screen. While this lived inside `readOrders`,
   * `payOrder` validated against a bare server row instead, and two readers of
   * the same order believing different things is what let a paid order be paid
   * again.
   */
  function projectOrders(
    serverOrders: readonly BillingOrder[],
    envelopes: readonly BillingDeliveryEnvelopeRecord[],
  ): BillingOrder[] {
    const overlaid = new Map(serverOrders.map((order) => [order.id, order]))
    for (const envelope of envelopes) {
      switch (envelope.command.type) {
        case 'create_order': {
          const payload = envelope.command.payload
          overlaid.set(payload.orderId, {
            id: payload.orderId,
            outletId: envelope.outletId,
            deviceId: envelope.tabletId,
            orderNumber: AWAITING_ORDER_NUMBER,
            businessDate: payload.businessDate,
            orderedAt: envelope.command.createdAt,
            preparedAt: null,
            status: 'open',
            creatorId: counterSession?.shift?.personId ?? '',
            creatorName: 'Counter operator',
            // Locally created, so it is this tablet's by construction. The
            // pipeline names only a tablet that is NOT this one, so there is
            // nothing to say here; the label arrives on the first server read.
            deviceLabel: null,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
            lines: payload.lines.map((line) => ({
              menuItemId: line.menuItemId ?? '',
              itemName: line.itemName,
              unitPricePaise: line.unitPricePaise,
              quantity: line.quantity,
              discountPaise: line.discountPaise,
              discountPercentBp: line.discountPercentBp,
              categoryName: line.categoryName,
            })),
            discounts: payload.discounts.map((discount) => ({ ...discount })),
            roundingPaise: payload.roundingPaise,
            totalPaise: payload.totalPaise,
            cancelReason: null,
            cancelledAt: null,
            cancelledByName: null,
            paidAt: null,
            billId: null,
          })
          break
        }
        case 'revise_order': {
          const payload = envelope.command.payload
          const current = overlaid.get(payload.orderId)
          if (current) {
            overlaid.set(payload.orderId, {
              ...current,
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              lines: payload.lines.map((line) => ({
                menuItemId: line.menuItemId ?? '',
                itemName: line.itemName,
                unitPricePaise: line.unitPricePaise,
                quantity: line.quantity,
              })),
              totalPaise: payload.totalPaise,
            })
          }
          break
        }
        case 'set_order_preparation': {
          const current = overlaid.get(envelope.command.payload.orderId)
          if (current) {
            overlaid.set(envelope.command.payload.orderId, {
              ...current,
              preparedAt: envelope.command.payload.prepared ? envelope.command.createdAt : null,
            })
          }
          break
        }
        case 'pay_order': {
          // Paid locally: the card leaves Unpaid Prepared Orders, but a paid
          // and still-unprepared order stays in Preparing under its PAID
          // marker rather than vanishing from the rail.
          const current = overlaid.get(envelope.command.payload.orderId)
          if (current) {
            overlaid.set(envelope.command.payload.orderId, {
              ...current,
              status: 'paid',
              paidAt: envelope.command.payload.paidAt,
              billId: envelope.command.payload.billId,
            })
          }
          break
        }
        case 'void_order_payment': {
          // The unwind reopens the order before the server has seen either
          // half, so a read between them shows one open order — not a paid
          // ghost and an open double.
          const current = overlaid.get(envelope.command.payload.orderId)
          if (current) {
            overlaid.set(envelope.command.payload.orderId, {
              ...current,
              status: 'open',
              paidAt: null,
              billId: null,
              cancelReason: null,
              cancelledAt: null,
              cancelledByName: null,
            })
          }
          break
        }
        case 'cancel_paid_order': {
          const current = overlaid.get(envelope.command.payload.orderId)
          if (current) {
            overlaid.set(envelope.command.payload.orderId, {
              ...current,
              status: 'cancelled',
              billId: null,
            })
          }
          break
        }
        case 'cancel_order':
          overlaid.delete(envelope.command.payload.orderId)
          break
        default:
          break
      }
    }
    return [...overlaid.values()]
  }

  /**
   * The envelopes a projection replays, oldest first. `needs_attention` stays
   * excluded: a refused command did not happen.
   */
  async function projectableEnvelopes(
    outletId: string,
  ): Promise<BillingDeliveryEnvelopeRecord[] | null> {
    if (!database || !counterSession) return null
    return (await database.envelopes.where('outletId').equals(outletId).toArray())
      .filter((envelope) => envelope.state !== 'needs_attention')
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  /** A name for an order in a refusal, before the server has numbered it. */
  function orderLabel(order: BillingOrder): string {
    return order.orderNumber > 0 ? `Order ${order.orderNumber}` : 'That order'
  }

  /**
   * One order as this tablet believes it, not as the server last wrote it.
   *
   * `readOrder` returns the bare row. Guards built on it disagreed with the
   * screen beside them, which is how an order the counter had already paid
   * could be paid a second time. Envelopes are read first here for the same
   * reason `readOrders` reads them first.
   */
  async function projectOrder(orderId: string): Promise<BillingOrder | null> {
    const local = counterSession ? await projectableEnvelopes(counterSession.device.outletId) : null
    const base = orderCache.get(orderId) ?? (await readOrder(orderId))
    if (!base) return null
    if (!local) return base
    return projectOrders([base], local).find((order) => order.id === orderId) ?? null
  }

  async function readOrders(outletId: string, pipelineOnly: boolean): Promise<BillingOrder[]> {
    // The outbox is read BEFORE the server snapshot, and the order is the whole
    // point. Acceptance writes the server row and then deletes the envelope, so
    // reading the envelopes first means at least one of the two always holds a
    // just-accepted fact. Read the server first, as this did, and a command
    // accepted between the two reads is in neither: the snapshot predates it
    // and the envelope is already gone. That is how a paid order came back onto
    // the counter wearing a Pay button.
    const local = await projectableEnvelopes(outletId)

    let query = client
      .from('orders')
      .select(
        '*, order_items(*), order_discounts(*), creator:profiles!orders_created_by_fkey(full_name), canceller:profiles!orders_cancelled_by_fkey(full_name)',
      )
      .eq('outlet_id', outletId)
      .order('ordered_at', { ascending: false })
    // The server is asked for the rail, plus whatever a pending command is
    // about. `inPipeline` still decides below: a row fetched only because an
    // envelope named it must still leave if the overlay leaves it prepared and
    // paid.
    if (pipelineOnly) {
      const filter = pipelineFilter(local)
      // The fallback is the read this replaced, not an unfiltered one: a tablet
      // deep enough offline to reach the limit should pay yesterday's price,
      // not more than it.
      query = filter ? query.or(filter) : query.in('status', ['open', 'paid'])
    }
    const { data, error } = await query
    let orders: BillingOrder[]
    if (error) {
      if (!counterSession?.shift) throw actionError(error, 'Could not load open orders.')
      orders = [...orderCache.values()].filter(
        (order) => order.outletId === outletId && (!pipelineOnly || inPipeline(order)),
      )
    } else {
      const rows = data as unknown as OrderReadRow[]
      const labels = await deviceLabelsFor(
        'order',
        rows.map((row) => row.id),
      )
      orders = rows.map((row) => orderView(row, labels.get(row.id) ?? null))
      if (pipelineOnly) resumeCoordinator?.notePipeline(outletId, orders)
      for (const [id, cached] of orderCache) {
        if (cached.outletId === outletId) orderCache.delete(id)
      }
      for (const order of orders) orderCache.set(order.id, order)
    }

    if (local) orders = projectOrders(orders, local)

    for (const order of orders) orderCache.set(order.id, order)
    return orders.filter((order) => !pipelineOnly || inPipeline(order))
  }

  async function readOrder(orderId: string): Promise<BillingOrder | null> {
    const { data, error } = await client
      .from('orders')
      .select(
        '*, order_items(*), order_discounts(*), creator:profiles!orders_created_by_fkey(full_name), canceller:profiles!orders_cancelled_by_fkey(full_name)',
      )
      .eq('id', orderId)
      .maybeSingle()
    if (error) throw actionError(error, 'Could not load that order.')
    if (!data) return null
    const row = data as unknown as OrderReadRow
    const labels = await deviceLabelsFor('order', [row.id])
    const order = orderView(row, labels.get(row.id) ?? null)
    orderCache.set(order.id, order)
    return order
  }

  async function readBills(filters: {
    id?: string
    outletId?: string
    counterShiftId?: string
    businessDate?: string
    status?: Tables<'bills'>['status']
    limit?: number
  }): Promise<BillingBill[]> {
    let query = client
      .from('bills')
      .select(
        '*, bill_items(*), bill_discounts(*), bill_public_links(token, revoked_at), bill_payments(*), order:orders!bills_order_id_fkey(order_number, prepared_at), biller:profiles!bills_biller_profile_id_fkey(full_name), voider:profiles!bills_voided_by_fkey(id, full_name), attribution_reviews:billing_attribution_reviews(*, resolved_operator:profiles!billing_attribution_reviews_resolved_operator_id_fkey(full_name), reviewer:profiles!billing_attribution_reviews_reviewed_by_fkey(full_name))',
      )
    if (filters.id) query = query.eq('id', filters.id)
    if (filters.outletId) query = query.eq('outlet_id', filters.outletId)
    if (filters.counterShiftId) query = query.eq('counter_shift_id', filters.counterShiftId)
    if (filters.businessDate) {
      query = query.eq('business_date', filters.businessDate)
    }
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.limit) query = query.limit(filters.limit)
    const { data, error } = await query.order('paid_at', { ascending: false })
    if (error) throw actionError(error, 'Could not load bills.')
    const rows = data as unknown as BillReadRow[]
    const ids = rows.map((row) => row.id)
    let effective: EffectivePaymentRow[] = []
    let deviceLabels = new Map<string, string>()
    if (ids.length > 0) {
      const [response, labels] = await Promise.all([
        client.from('effective_bill_payments').select('*').in('bill_id', ids),
        deviceLabelsFor('bill', ids),
      ])
      if (response.error) throw actionError(response.error, 'Could not load bill payments.')
      effective = response.data as EffectivePaymentRow[]
      deviceLabels = labels
    }
    const serverBills = rows.map((row) =>
      billView(
        row,
        effective,
        Boolean(
          counterSession?.shift &&
          row.counter_device_id === counterSession.device.deviceId &&
          row.counter_shift_id === counterSession.shift.id,
        ),
        deviceLabels.get(row.id) ?? null,
      ),
    )
    if (filters.counterShiftId) resumeCoordinator?.noteBills(filters.counterShiftId, serverBills)
    const pendingBillIds = new Set(
      database
        ? (await database.envelopes.toArray()).flatMap((envelope) => {
            if (
              envelope.command.type === 'pay_now' ||
              envelope.command.type === 'pay_order' ||
              envelope.command.type === 'correct_bill_payment'
            ) {
              return [envelope.command.payload.billId]
            }
            return []
          })
        : [],
    )
    for (const bill of serverBills) {
      const local = localBillCache.get(bill.id)
      if (local && pendingBillIds.has(bill.id)) {
        localBillCache.set(bill.id, { ...local, billNumber: bill.billNumber })
      } else {
        localBillCache.delete(bill.id)
      }
    }
    return serverBills
  }

  /**
   * The envelopes a shift's bill projection replays, oldest first. Keyed by
   * tablet rather than outlet because a shift belongs to one device.
   */
  async function shiftEnvelopes(shiftId: string): Promise<BillingDeliveryEnvelopeRecord[] | null> {
    if (!database || !counterSession) return null
    return (
      await database.envelopes.where('tabletId').equals(counterSession.device.deviceId).toArray()
    )
      .filter((envelope) => envelope.shiftId === shiftId && envelope.state !== 'needs_attention')
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  /**
   * Rebuild locally effective bills from the durable command log after reloads.
   *
   * `known` lets a caller hand in envelopes it read *before* its server bills,
   * which is the same ordering `readOrders` depends on: acceptance writes the
   * server row and then deletes the envelope, so a reader that takes the server
   * side first can land in the gap where a just-settled bill is in neither.
   * Callers that pass nothing read them here, which is safe for the two that
   * have no server read to race.
   */
  async function overlayDurableBills(
    shiftId: string,
    serverBills: readonly BillingBill[],
    known?: readonly BillingDeliveryEnvelopeRecord[] | null,
  ): Promise<BillingBill[]> {
    const bills = new Map(serverBills.map((bill) => [bill.id, bill]))
    if (!database || !counterSession) return [...bills.values()]

    const envelopes = known ?? (await shiftEnvelopes(shiftId)) ?? []
    const orderSnapshots = new Map<string, BillingOrder>()

    for (const envelope of envelopes) {
      const command = envelope.command
      if (command.type === 'create_order' || command.type === 'revise_order') {
        const previous =
          orderSnapshots.get(command.payload.orderId) ?? orderCache.get(command.payload.orderId)
        orderSnapshots.set(command.payload.orderId, {
          id: command.payload.orderId,
          outletId: envelope.outletId,
          deviceId: counterSession.device.deviceId,
          orderNumber: previous?.orderNumber ?? AWAITING_ORDER_NUMBER,
          businessDate: command.payload.businessDate,
          orderedAt: previous?.orderedAt ?? command.createdAt,
          preparedAt: null,
          status: 'open',
          creatorId: counterSession.shift?.personId ?? '',
          creatorName: previous?.creatorName ?? 'Counter operator',
          deviceLabel: previous?.deviceLabel ?? null,
          customerName: command.payload.customerName,
          customerPhone: command.payload.customerPhone,
          lines: command.payload.lines.map((line) => ({
            menuItemId: line.menuItemId ?? '',
            itemName: line.itemName,
            unitPricePaise: line.unitPricePaise,
            quantity: line.quantity,
            discountPaise: line.discountPaise,
            discountPercentBp: line.discountPercentBp,
            categoryName: line.categoryName,
          })),
          discounts: command.payload.discounts.map((discount) => ({ ...discount })),
          roundingPaise: command.payload.roundingPaise,
          totalPaise: command.payload.totalPaise,
          cancelReason: null,
          cancelledAt: null,
          cancelledByName: null,
          paidAt: null,
          billId: null,
        })
        continue
      }

      if (command.type === 'pay_now') {
        bills.set(command.payload.billId, {
          id: command.payload.billId,
          outletId: envelope.outletId,
          billNumber: bills.get(command.payload.billId)?.billNumber ?? 0,
          orderNumber: null,
          orderId: null,
          businessDate: command.payload.businessDate,
          discounts: command.payload.discounts.map((discount) => ({ ...discount })),
          roundingPaise: command.payload.roundingPaise,
          orderedAt: command.createdAt,
          paidAt: command.createdAt,
          paymentBusinessDate: command.payload.paymentBusinessDate,
          payments: [...command.payload.payments],
          paymentRevision: 0,
          paymentEditable: true,
          // A direct sale: no order, so the clock runs from its own payment.
          ...editWindowOf({
            paidAt: command.createdAt,
            preparedAt: null,
            settlesAnOrder: false,
          }),
          paymentMethod:
            command.payload.payments.length > 1 ? 'mixed' : command.payload.payments[0]!.method,
          status: 'settled',
          billerName: 'Counter operator',
          tillLabel: null,
          customerName: command.payload.customerName,
          customerPhone: command.payload.customerPhone,
          lines: command.payload.lines.map((line) => ({
            menuItemId: line.menuItemId ?? '',
            itemName: line.itemName,
            unitPricePaise: line.unitPricePaise,
            quantity: line.quantity,
          })),
          totalPaise: command.payload.totalPaise,
          voidKind: null,
          voidReason: null,
          voidedAt: null,
          voidedBy: null,
          // No link yet: the token is minted when the row reaches Postgres,
          // and this bill has only been accepted locally.
          receiptUrl: null,
        })
        continue
      }

      if (command.type === 'pay_order' && !bills.has(command.payload.billId)) {
        const order =
          orderSnapshots.get(command.payload.orderId) ??
          orderCache.get(command.payload.orderId) ??
          (await readOrder(command.payload.orderId))
        if (order) {
          bills.set(command.payload.billId, {
            id: command.payload.billId,
            outletId: order.outletId,
            billNumber: 0,
            orderNumber: order.orderNumber,
            orderId: command.payload.orderId,
            discounts: [],
            roundingPaise: 0,
            businessDate: order.businessDate,
            orderedAt: order.orderedAt,
            paidAt: command.payload.paidAt,
            paymentBusinessDate: command.payload.paymentBusinessDate,
            payments: [...command.payload.payments],
            paymentRevision: 0,
            paymentEditable: true,
            // Over the order the tablet already holds: while its preparation is
            // unrecorded this payment has no deadline, offline included.
            ...editWindowOf({
              paidAt: command.payload.paidAt,
              preparedAt: order.preparedAt,
              settlesAnOrder: true,
            }),
            paymentMethod:
              command.payload.payments.length > 1 ? 'mixed' : command.payload.payments[0]!.method,
            status: 'settled',
            billerName: order.creatorName,
            tillLabel: null,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            lines: order.lines,
            totalPaise: order.totalPaise,
            voidKind: null,
            voidReason: null,
            voidedAt: null,
            voidedBy: null,
            // No link yet: the token is minted when the row reaches Postgres,
            // and this bill has only been accepted locally.
            receiptUrl: null,
          })
        }
        continue
      }

      if (command.type === 'void_order_payment' || command.type === 'cancel_paid_order') {
        // The counter-kind void drops the bill from the shift before delivery,
        // so the totals this screen shows never count money the counter has
        // already taken back.
        bills.delete(command.payload.billId)
        continue
      }

      if (command.type === 'correct_bill_payment') {
        const bill = bills.get(command.payload.billId)
        if (bill && bill.paymentRevision === command.payload.expectedRevision) {
          bills.set(bill.id, {
            ...bill,
            payments: [...command.payload.payments],
            paymentRevision: command.payload.expectedRevision + 1,
            paymentMethod:
              command.payload.payments.length > 1 ? 'mixed' : command.payload.payments[0]!.method,
          })
        }
      }
    }

    localBillCache.clear()
    for (const bill of bills.values()) {
      if (bill.paymentEditableUntil) localBillCache.set(bill.id, bill)
    }
    return [...bills.values()]
  }

  /**
   * Send this tablet's queued expenses. The insert carries the envelope's own
   * id, so a lost response replays into `23505` and resolves as delivered
   * rather than as a second expense.
   */
  async function drainQueuedExpenses(database: BillingDeliveryDatabase): Promise<void> {
    if (!counterSession) return
    await drainCounterExpenses(database, counterSession.device.deviceId, async (entry) => {
      const { error } = await client.from('expenses').insert({
        id: entry.id,
        outlet_id: entry.input.outletId,
        business_date: entry.input.businessDate,
        category: entry.input.category,
        is_cash: entry.input.isCash,
        amount_paise: entry.input.amountPaise,
        description: entry.input.note?.trim() ? entry.input.note.trim() : null,
      })
      return { error: error ? { code: error.code, message: error.message } : null }
    })
  }

  async function startRuntime(): Promise<void> {
    if (!counterSession || !store || !database || deliverySubscription) return
    const tabletId = counterSession.device.deviceId
    deliverySubscription = liveQuery(async () => ({
      envelopes: await database.envelopes.where('tabletId').equals(tabletId).toArray(),
      expenses: await listCounterExpenses(database, tabletId),
    })).subscribe({
      next: ({ envelopes, expenses }) => {
        const queued = envelopes
          .filter((envelope) => envelope.type === 'pay_now')
          .map((envelope) => {
            const payload = envelope.command.type === 'pay_now' ? envelope.command.payload : null
            return {
              clientId: envelope.commandId,
              totalPaise: payload?.totalPaise ?? 0,
              businessDate: envelope.businessDate,
              queuedAt: envelope.createdAtMs,
            }
          })
          .sort((left, right) => left.queuedAt - right.queuedAt)
        oldestQueuedAt = envelopes.reduce<number | null>(
          (value, envelope) =>
            value === null ? envelope.createdAtMs : Math.min(value, envelope.createdAtMs),
          null,
        )
        state = {
          ...state,
          queued,
          sync: {
            // A refused expense is not "still sending". It counts as needing
            // attention, exactly as a refused command does, so the indicator
            // stops promising delivery that will never happen.
            ...deliverySync(
              envelopes.length + expenses.filter((row) => row.state === 'pending').length,
              envelopes.some((envelope) => envelope.state === 'needs_attention') ||
                expenses.some((row) => row.state === 'needs_attention'),
            ),
          },
        }
        notify()
      },
      error: () => undefined,
    })

    // Reconnection must resolve the tablet and shift before any ordinary
    // delivery. The session hook listens for `online`; its successful server
    // resolution replaces this adapter, and only that fresh adapter drains.
    if (counterSession.offlineResume) {
      deliveryReachable = false
      state = { ...state, sync: deliverySync(state.sync.pending) }
      notify()
      return
    }

    const lockManager: BillingLockManager | null =
      typeof navigator !== 'undefined' && navigator.locks
        ? (navigator.locks as unknown as BillingLockManager)
        : null
    drain = new BillingDrainCoordinator({
      store,
      tabletId,
      ownerId: newUuid(),
      locks: lockManager,
      execute: async (command) => {
        const result = await commands.execute(command)
        if (result.status === 'removed_tablet') {
          tabletRemoved = true
          void drain?.stop()
          /*
            The device has lost the right to hold customer PII, so it stops
            holding it. The resume record's other contents — the menu, the
            shift, the day's bills — are this outlet's own trade and stay; fifty
            names and phone numbers are not, and a tablet taken out of service
            should not still be carrying them.
          */
          void forgetRememberedCustomers(tabletId).catch(() => undefined)
        }
        return result
      },
      onReachability: (reachable) => {
        deliveryReachable = reachable
        state = { ...state, sync: deliverySync(state.sync.pending) }
        notify()
      },
      // Queued expenses ride the command drain's tick and mutex rather than a
      // second scheduler — and rather than a surface happening to read a list,
      // which is what used to send them.
      secondary: () => drainQueuedExpenses(database),
    })
    reporter = new BillingUnsentReporter({
      store,
      tabletId,
      reportState: async ({ count, oldestCreatedAtMs }) => {
        const args =
          oldestCreatedAtMs === null
            ? { p_unsent: count }
            : {
                p_unresolved: count,
                p_oldest_unresolved_at: new Date(oldestCreatedAtMs).toISOString(),
              }
        const { error } = await client.rpc('report_counter_device_state', args)
        if (error) throw error
      },
    })
    drain.start()
    reporter.start()
  }

  async function stopRuntime(): Promise<void> {
    deliverySubscription?.unsubscribe()
    deliverySubscription = null
    await Promise.all([drain?.stop(), reporter?.stop()])
    drain = null
    reporter = null
  }

  const notLive = () =>
    Promise.reject(
      new BillingActionError('not_live', 'This shift action uses the tablet handshake.'),
    )

  return {
    getCounterState: () => state,
    subscribeCounter(listener) {
      listeners.add(listener)
      void startRuntime()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) void stopRuntime()
      }
    },
    async listBillers(outletId) {
      if (counterSession) return []
      const { data, error } = await client
        .from('assignments')
        .select('person_id, person:profiles!assignments_person_id_fkey(full_name)')
        .eq('outlet_id', outletId)
        .eq('role', 'biller')
        .is('ended_on', null)
      if (error) throw actionError(error, 'Could not load eligible billers.')
      return data
        .map((row) => ({
          profileId: row.person_id,
          fullName: joined(row.person)?.full_name ?? 'Former team member',
        }))
        .sort((left, right) => left.fullName.localeCompare(right.fullName))
    },
    openShift: notLive,
    async inspectFinishDay(shiftId) {
      const { session, shift, store } = requireTablet()
      if (shift.id !== shiftId) {
        throw new BillingActionError('not_permitted', 'That is not this tablet’s live shift.')
      }
      await startRuntime()
      // A negative browser signal is enough to avoid waiting for a doomed
      // request. A positive signal is never treated as proof: the drain and
      // authoritative reads below must still succeed before Finish Day clears.
      let serverReachable = typeof navigator === 'undefined' || navigator.onLine
      if (serverReachable) {
        try {
          await drain?.runOnce()
        } catch {
          serverReachable = false
        }
      }

      const envelopes = await store.database.envelopes
        .where('tabletId')
        .equals(session.device.deviceId)
        .filter((envelope) => envelope.businessDate === shift.businessDate)
        .toArray()
      const needsAttentionCount = envelopes.filter(
        (envelope) => envelope.state === 'needs_attention',
      ).length
      // Scoped to this shift's business date, like the envelopes above: an
      // expense filed against another date is not this day's blocker.
      const queuedExpenses = (
        await listCounterExpenses(store.database, session.device.deviceId)
      ).filter((row) => row.input.businessDate === shift.businessDate)
      const unsentCount =
        envelopes.length -
        needsAttentionCount +
        queuedExpenses.filter((row) => row.state === 'pending').length
      const attentionCount =
        needsAttentionCount + queuedExpenses.filter((row) => row.state === 'needs_attention').length

      let openOrderCount = 0
      let foodOwedCount = 0
      let editablePaymentCount = 0
      try {
        if (!serverReachable) throw new Error('offline')
        const [ordersResult, foodOwedResult, billsResult] = await Promise.all([
          client
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('device_id', session.device.deviceId)
            .eq('business_date', shift.businessDate)
            .eq('status', 'open'),
          // Paid and not prepared: a customer who has handed over money and is
          // still waiting for food. The database refuses the close on it too.
          client
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('device_id', session.device.deviceId)
            .eq('business_date', shift.businessDate)
            .eq('status', 'paid')
            .is('prepared_at', null),
          // Every settled payment of this day; which of them are still editable
          // is the derived window's answer, not a `paid_at` cutoff's — a payment
          // on an unprepared order has no deadline at all.
          client
            .from('bills')
            .select('id, paid_at, order_id, order:orders!bills_order_id_fkey(prepared_at)')
            .eq('counter_device_id', session.device.deviceId)
            .eq('payment_business_date', shift.businessDate)
            .eq('status', 'settled'),
        ])
        if (ordersResult.error || foodOwedResult.error || billsResult.error) {
          throw ordersResult.error ?? foodOwedResult.error ?? billsResult.error
        }
        openOrderCount = ordersResult.count ?? 0
        foodOwedCount = foodOwedResult.count ?? 0
        const now = Date.now()
        editablePaymentCount = (
          billsResult.data as unknown as Array<{
            paid_at: string
            order_id: string | null
            order: { prepared_at: string | null } | { prepared_at: string | null }[] | null
          }>
        ).filter((row) => {
          const deadline = ticketEditDeadlineMs({
            paidAt: row.paid_at,
            preparedAt: joined(row.order)?.prepared_at ?? null,
            settlesAnOrder: row.order_id !== null,
          })
          return deadline === null || deadline > now
        }).length
      } catch {
        serverReachable = false
      }

      const localBills = await overlayDurableBills(shift.id, [])
      editablePaymentCount += localBills.filter(
        (bill) =>
          bill.paymentEditable &&
          (bill.paymentEditableUntil === null ||
            Date.parse(bill.paymentEditableUntil) > Date.now()),
      ).length

      return {
        unsentCount,
        needsAttentionCount: attentionCount,
        openOrderCount,
        foodOwedCount,
        editablePaymentCount,
        serverReachable,
        attributionExceptionCount: 0,
        canFinish:
          serverReachable &&
          unsentCount === 0 &&
          attentionCount === 0 &&
          openOrderCount === 0 &&
          foodOwedCount === 0,
      }
    },
    async closeShift(shiftId: string): Promise<void> {
      const { session, shift, store } = requireTablet()
      if (shift.id !== shiftId) {
        throw new BillingActionError('not_permitted', 'That is not this tablet’s live shift.')
      }
      await startRuntime()
      await drain?.runOnce()
      const unresolved = await store.countUnresolved(session.device.deviceId)
      if (unresolved > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          `${unresolved} billing action${unresolved === 1 ? ' is' : 's are'} still unresolved on this tablet.`,
        )
      }
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: null,
        type: 'confirm_end_of_day',
        createdAt: new Date().toISOString(),
        payload: {
          outletId: session.device.outletId,
          businessDate: shift.businessDate,
          unsentCount: 0,
          needsAttentionCount: 0,
        },
      })
      await requireAccepted(
        commands,
        command,
        'The day could not be finished. Clear every open order and try again online.',
      )
      state = { ...state, shift: null }
      notify()
    },

    async settleBill(draft: BillDraft): Promise<void> {
      const { session, shift } = requireCurrentScope(
        draft.outletId,
        draft.shiftId,
        draft.businessDate,
      )
      const totals = billTotals(draft.lines, {
        discountPaise: discountTotalPaise(draft.lines, draft.discounts ?? []),
      })
      const now = new Date().toISOString()
      const command = await createBillingCommand({
        commandId: draft.clientId,
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'pay_now',
        createdAt: now,
        payload: {
          billId: draft.clientId,
          businessDate: draft.businessDate,
          paymentBusinessDate: draft.businessDate,
          customerId: null,
          customerName: draft.customerName?.trim() || null,
          customerPhone: draft.customerPhone?.trim() || null,
          ...totals,
          pricingMode: 'no_tax',
          payments: requirePayments(draft.payments, totals.totalPaise),
          lines: draft.lines.map((line) => ({
            id: newUuid(),
            menuItemId: line.menuItemId || null,
            itemName: line.itemName,
            unitPricePaise: line.unitPricePaise,
            quantity: line.quantity,
            lineTotalPaise: lineTotalPaise(line.unitPricePaise, line.quantity),
            discountPaise: line.discountPaise ?? 0,
            discountPercentBp: line.discountPercentBp ?? null,
            categoryName: line.categoryName ?? null,
          })),
          discounts: (draft.discounts ?? []).map((discount) => ({ ...discount })),
        },
      })
      await accept(command, draft.outletId, draft.businessDate, draft.clientId)
      localBillCache.set(draft.clientId, {
        id: draft.clientId,
        outletId: draft.outletId,
        billNumber: 0,
        orderNumber: null,
        orderId: null,
        businessDate: draft.businessDate,
        discounts: command.payload.discounts.map((discount) => ({ ...discount })),
        roundingPaise: command.payload.roundingPaise,
        orderedAt: command.createdAt,
        paidAt: command.createdAt,
        paymentBusinessDate: draft.businessDate,
        payments: [...draft.payments],
        paymentRevision: 0,
        paymentEditable: true,
        ...editWindowOf({
          paidAt: command.createdAt,
          preparedAt: null,
          settlesAnOrder: false,
        }),
        paymentMethod: draft.payments.length > 1 ? 'mixed' : draft.payments[0]!.method,
        status: 'settled',
        billerName: 'Counter operator',
        tillLabel: null,
        customerName: draft.customerName?.trim() || null,
        customerPhone: draft.customerPhone?.trim() || null,
        lines: [...draft.lines],
        totalPaise: totals.totalPaise,
        voidKind: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        // No link yet: the token is minted when the row reaches Postgres,
        // and this bill has only been accepted locally.
        receiptUrl: null,
      })
    },

    async correctBillPayment(billId, expectedRevision, paymentsInput) {
      const { session, shift } = requireTablet()
      const local = localBillCache.get(billId)
      const bill =
        local ??
        (await overlayDurableBills(shift.id, await readBills({ id: billId, limit: 1 }))).find(
          (candidate) => candidate.id === billId,
        )
      if (
        !bill ||
        !bill.paymentEditable ||
        (bill.paymentEditableUntil !== null && Date.parse(bill.paymentEditableUntil) <= Date.now())
      ) {
        throw new BillingActionError(
          'payment_edit_expired',
          'That payment can no longer be edited.',
        )
      }
      if (expectedRevision !== bill.paymentRevision) {
        throw new BillingActionError(
          'stale_revision',
          'That payment changed; reopen it and try again.',
        )
      }
      const payments = requirePayments(paymentsInput, bill.totalPaise)
      const createdAt = new Date().toISOString()
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'correct_bill_payment',
        createdAt,
        payload: { billId, expectedRevision, payments },
      })
      const ancestors = database
        ? (await database.envelopes.toArray())
            .filter(
              (envelope) =>
                (envelope.command.type === 'pay_now' ||
                  envelope.command.type === 'pay_order' ||
                  envelope.command.type === 'correct_bill_payment') &&
                envelope.command.payload.billId === billId,
            )
            .map((envelope) => envelope.commandId)
        : []
      await accept(command, bill.outletId, bill.paymentBusinessDate, `payment:${billId}`, ancestors)
      const corrected: BillingBill = {
        ...bill,
        payments,
        paymentRevision: expectedRevision + 1,
        paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
      }
      localBillCache.set(billId, corrected)
      return corrected
    },

    async saveOrder(input: SaveOrderInput): Promise<BillingOrder> {
      const { session, shift } = requireCurrentScope(
        input.outletId,
        input.shiftId,
        input.businessDate,
      )
      const command = await createBillingCommand({
        commandId: input.clientId,
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'create_order',
        createdAt: new Date().toISOString(),
        payload: orderPayload(input.clientId, input.businessDate, input.lines, input),
      })
      await accept(command, input.outletId, input.businessDate, input.clientId)
      const localOrder: BillingOrder = {
        id: input.clientId,
        outletId: input.outletId,
        deviceId: session.device.deviceId,
        orderNumber: AWAITING_ORDER_NUMBER,
        businessDate: input.businessDate,
        orderedAt: command.createdAt,
        preparedAt: null,
        status: 'open',
        creatorId: shift.personId,
        creatorName: 'Counter operator',
        deviceLabel: null,
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        lines: [...input.lines],
        discounts: [...(input.discounts ?? [])],
        // Computed with the discounts, not without them. A local order that
        // reported its gross total showed the till one figure and charged
        // another the moment it was paid.
        roundingPaise: billTotals(input.lines, {
          discountPaise: discountTotalPaise(input.lines, input.discounts ?? []),
        }).roundingPaise,
        totalPaise: billTotals(input.lines, {
          discountPaise: discountTotalPaise(input.lines, input.discounts ?? []),
        }).totalPaise,
        cancelReason: null,
        cancelledAt: null,
        cancelledByName: null,
        paidAt: null,
        billId: null,
      }
      orderCache.set(input.clientId, localOrder)
      return localOrder
    },

    async reviseOrder(orderId, input): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing) throw new BillingActionError('not_found', 'That order is no longer open.')
      requireOwnOrder(existing, session.device.deviceId)
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'revise_order',
        createdAt: new Date().toISOString(),
        payload: orderPayload(orderId, existing.businessDate, input.lines, input),
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const revisedTotals = billTotals(input.lines, {
        discountPaise: discountTotalPaise(input.lines, input.discounts ?? []),
      })
      const revised = {
        ...existing,
        ...input,
        discounts: [...(input.discounts ?? [])],
        roundingPaise: revisedTotals.roundingPaise,
        totalPaise: revisedTotals.totalPaise,
      }
      orderCache.set(orderId, revised)
      return revised
    },

    listOpenOrders(outletId) {
      return readOrders(outletId, true)
    },

    async payOrder(orderId, payments): Promise<BillingBill | null> {
      const { session, shift } = requireTablet()
      const existing = await projectOrder(orderId)
      if (!existing) throw new BillingActionError('not_found', 'That order is no longer open.')
      requireOwnOrder(existing, session.device.deviceId)
      // The same refusal the database would give, given in place and before a
      // command exists. Keyed on the projected state and never on whether this
      // order has been paid before: taking a payment back reopens an order
      // precisely so it can be paid again, and a history-keyed guard would
      // break that while every test stayed green.
      if (existing.status === 'paid') {
        throw new BillingActionError(
          'already_paid',
          `${orderLabel(existing)} is already paid. Refresh the pipeline if it is still showing.`,
        )
      }
      if (existing.status === 'cancelled') {
        throw new BillingActionError('not_open', `${orderLabel(existing)} was cancelled.`)
      }
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'pay_order',
        createdAt: new Date().toISOString(),
        payload: {
          billId: newUuid(),
          orderId,
          payments: requirePayments(payments, existing.totalPaise),
          paidAt: new Date().toISOString(),
          paymentBusinessDate: shift.businessDate,
        },
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      // Until the promoting change moves settlement to prepare-time, the live
      // database settles every payment at once — even for an unprepared order.
      // The mock already defers; this path returns the provisional bill so the
      // two adapters keep one interface.
      // Kept, not deleted: a paid-but-unprepared order is still pipeline work,
      // and marking it prepared must not depend on a fresh server read.
      const paidOrder: BillingOrder = {
        ...existing,
        status: 'paid',
        paidAt: command.payload.paidAt,
        billId: command.payload.billId,
      }
      orderCache.set(orderId, paidOrder)
      const localBill: BillingBill = {
        id: command.payload.billId,
        outletId: existing.outletId,
        billNumber: 0,
        orderNumber: existing.orderNumber,
        orderId: orderId,
        businessDate: existing.businessDate,
        // Paying an order settles it at the figures it was saved with, so the
        // bill inherits them rather than recomputing anything.
        discounts: [],
        roundingPaise: 0,
        orderedAt: existing.orderedAt,
        paidAt: command.payload.paidAt,
        paymentBusinessDate: command.payload.paymentBusinessDate,
        payments: [...payments],
        paymentRevision: 0,
        paymentEditable: true,
        ...editWindowOf({
          paidAt: command.payload.paidAt,
          preparedAt: existing.preparedAt,
          settlesAnOrder: true,
        }),
        paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
        status: 'settled',
        billerName: existing.creatorName,
        tillLabel: null,
        customerName: existing.customerName,
        customerPhone: existing.customerPhone,
        lines: existing.lines,
        totalPaise: existing.totalPaise,
        voidKind: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        // No link yet: the token is minted when the row reaches Postgres,
        // and this bill has only been accepted locally.
        receiptUrl: null,
      }
      localBillCache.set(localBill.id, localBill)
      return localBill
    },

    async cancelOrder(orderId, reason): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing) throw new BillingActionError('not_found', 'That order is no longer open.')
      // A stranded order is the outlet manager's to cancel, with a reason, from
      // their own device. The neighbouring tablet is not a recovery path and is
      // refused here as it is at the database.
      requireOwnOrder(existing, session.device.deviceId)
      if (!reason.trim())
        throw new BillingActionError('blank_reason', 'A cancellation needs a reason.')
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'cancel_order',
        createdAt: new Date().toISOString(),
        payload: { orderId, reason: reason.trim() },
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const cancelled = { ...existing, status: 'cancelled' as const, cancelReason: reason.trim() }
      orderCache.set(orderId, cancelled)
      return cancelled
    },

    async markOrderPrepared(orderId, prepared): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      const existing = await projectOrder(orderId)
      if (!existing)
        throw new BillingActionError('not_found', 'That order is no longer on the pipeline.')
      requireOwnOrder(existing, session.device.deviceId)
      // Paid and already prepared is the one shape the database refuses on the
      // marking side, and it is reachable from the screen whenever a refresh
      // loses an accepted preparation. Refuse it here instead.
      if (prepared && existing.status === 'paid' && existing.preparedAt !== null) {
        throw new BillingActionError(
          'already_prepared',
          `${orderLabel(existing)} is already paid and prepared.`,
        )
      }
      // Mirrors the database's guard so a deterministic refusal never has to
      // travel: only an open order moves, and a paid order may still be marked
      // prepared — but never reprepared, because the bills border is terminal
      // in that direction.
      if (existing.status === 'paid' && !prepared) {
        throw new BillingActionError(
          'not_open',
          'This order is paid, so it cannot go back to preparing. Take the payment back first.',
        )
      }
      if (existing.status !== 'open' && !(existing.status === 'paid' && prepared)) {
        throw new BillingActionError('not_open', `Order ${existing.orderNumber} is not open.`)
      }
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'set_order_preparation',
        createdAt: new Date().toISOString(),
        payload: { orderId, prepared },
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const updated: BillingOrder = {
        ...existing,
        preparedAt: prepared ? command.createdAt : null,
      }
      orderCache.set(orderId, updated)
      return updated
    },

    async unpayOrder(orderId, billId, reason): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      if (!reason.trim())
        throw new BillingActionError('blank_reason', 'Taking a payment back needs a reason.')
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      // Until the promoting change moves settlement to prepare-time, every
      // live payment settles immediately — so only a bill-backed unwind
      // exists here. A held payment without a bill is a mock-only state.
      if (!existing || billId === null || existing.billId !== billId) {
        throw new BillingActionError('not_found', 'That payment is not on this tablet.')
      }
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'void_order_payment',
        createdAt: new Date().toISOString(),
        payload: { orderId, billId, reason: reason.trim() },
      })
      // Same chain as the payment it reverses, so delivery can never overtake
      // the pay_order that created the money in the first place.
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const reopened: BillingOrder = {
        ...existing,
        status: 'open',
        paidAt: null,
        billId: null,
        cancelReason: null,
        cancelledAt: null,
        cancelledByName: null,
      }
      orderCache.set(orderId, reopened)
      localBillCache.delete(billId)
      return reopened
    },

    async cancelPaidOrder(orderId, reason): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      if (!reason.trim())
        throw new BillingActionError('blank_reason', 'A cancellation needs a reason.')
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing || !existing.billId) {
        throw new BillingActionError(
          'not_found',
          'That paid order is not one this tablet can cancel.',
        )
      }
      const billId = existing.billId
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'cancel_paid_order',
        createdAt: new Date().toISOString(),
        payload: { orderId, billId, reason: reason.trim() },
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const cancelled: BillingOrder = {
        ...existing,
        status: 'cancelled',
        paidAt: null,
        billId: null,
        cancelReason: reason.trim(),
        cancelledAt: command.createdAt,
        cancelledByName: null,
      }
      orderCache.set(orderId, cancelled)
      localBillCache.delete(billId)
      return cancelled
    },

    async listShiftHistory(shiftId) {
      // Envelopes first, server bills second. See `overlayDurableBills`.
      const known = await shiftEnvelopes(shiftId)
      let serverBills: BillingBill[]
      try {
        serverBills = await readBills({ counterShiftId: shiftId })
      } catch (cause) {
        // The counter's durable command log is sufficient to keep a newly
        // accepted payment editable while the backend is unreachable. Other
        // failures still surface instead of silently presenting partial data.
        if (
          !counterSession?.offlineResume &&
          (typeof navigator === 'undefined' || navigator.onLine)
        )
          throw cause
        serverBills = counterSession?.offlineResume?.bills
          ? structuredClone(counterSession.offlineResume.bills)
          : []
      }
      const bills = (await overlayDurableBills(shiftId, serverBills, known)).sort((a, b) =>
        b.paidAt.localeCompare(a.paidAt),
      )
      return {
        bills,
        totals: BILLING_PAYMENT_METHODS.map((method) => ({
          method,
          totalPaise: bills
            .filter((bill) => bill.status === 'settled')
            .flatMap((bill) => bill.payments)
            .filter((payment) => payment.method === method)
            .reduce((sum, payment) => sum + payment.amountPaise, 0),
        })),
      }
    },

    async listManagerHistory(filters) {
      let bills = await readBills({
        outletId: filters.outletId,
        ...(filters.businessDate && { businessDate: filters.businessDate }),
        ...(filters.status && filters.status !== 'all' && { status: filters.status }),
      })
      if (filters.paymentMethod && filters.paymentMethod !== 'all') {
        bills = bills.filter((bill) =>
          bill.payments.some((payment) => payment.method === filters.paymentMethod),
        )
      }
      return bills
    },

    async getBill(billId) {
      return (await readBills({ id: billId, limit: 1 }))[0] ?? null
    },

    async voidBill(billId, reason) {
      if (!reason.trim()) throw new BillingActionError('blank_reason', 'A void needs a reason.')
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: null,
        shiftId: null,
        type: 'void_bill',
        createdAt: new Date().toISOString(),
        payload: { billId, reason: reason.trim() },
      })
      await requireAccepted(commands, command, 'That bill could not be voided.')
      const bill = (await readBills({ id: billId, limit: 1 }))[0]
      if (!bill) throw new BillingActionError('not_found', 'That bill was not found.')
      return bill
    },

    listManagerOpenOrders(outletId) {
      return readOrders(outletId, true)
    },

    async managerCancelOrder(orderId, reason) {
      if (!reason.trim())
        throw new BillingActionError('blank_reason', 'A cancellation needs a reason.')
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: null,
        shiftId: null,
        type: 'manager_cancel_order',
        createdAt: new Date().toISOString(),
        payload: { orderId, reason: reason.trim() },
      })
      await requireAccepted(commands, command, 'That order could not be cancelled.')
      const order = await readOrder(orderId)
      if (!order) throw new BillingActionError('not_found', 'That order was not found.')
      return order
    },

    async reviewAttribution(
      billId: string,
      outcome: BillingAttributionOutcome,
      resolvedOperatorId?: string | null,
      reason?: string | null,
    ): Promise<BillingAttributionReview> {
      const { error } = await client.rpc('review_billing_attribution', {
        p_bill_id: billId,
        p_outcome: outcome,
        ...(resolvedOperatorId ? { p_resolved_operator_id: resolvedOperatorId } : {}),
        ...(reason ? { p_reason: reason } : {}),
      })
      if (error) throw actionError(error, 'That attribution review could not be recorded.')
      const bill = (await readBills({ id: billId, limit: 1 }))[0]
      if (!bill?.attributionReview) {
        throw new BillingActionError('not_found', 'The attribution review could not be read back.')
      }
      return bill.attributionReview
    },

    async listAttention(): Promise<BillingAttentionItem[]> {
      if (!database || !counterSession) return []
      const envelopes = await database.envelopes
        .where('[tabletId+state]')
        .equals([counterSession.device.deviceId, 'needs_attention'])
        .toArray()
      const results = await database.results.bulkGet(envelopes.map((row) => row.commandId))
      return envelopes.flatMap((envelope, index) => {
        const result = results[index]
        if (!result?.refusedTrace) return []
        return [
          {
            reference: envelope.commandId,
            commandType: envelope.type,
            resultCategory: result.result.status,
            receivedAt: new Date(result.recordedAtMs).toISOString(),
            orderNumber: refusedOrderNumber(result.result),
            ageMs: Math.max(0, Date.now() - result.recordedAtMs),
            deviceId: envelope.tabletId,
            refusedTrace: result.refusedTrace,
            state: 'needs_attention' as const,
            linkedCorrectionId: null,
            resolvedAt: null,
            resolvedBy: null,
            discardReason: null,
          },
        ]
      })
    },

    async correctAttention(reference, correctionId) {
      const { session, shift, store } = requireTablet()
      const envelope = await store.database.envelopes.get(reference)
      if (!envelope) throw new BillingActionError('not_found', 'That delivery item was not found.')
      const replacement = {
        ...envelope.command,
        commandId: correctionId,
        // Preserve when the refused work was actually taken. Historical queue
        // delivery is authorised against that immutable shift timestamp; giving
        // a copied payload "now" while retaining its original shift would turn
        // a valid correction into a fresh historical-shift refusal.
      } as BillingCommand
      await store.correctAttention(
        {
          commandId: reference,
          tabletId: session.device.deviceId,
          shiftId: shift.id,
          actorId: shift.personId,
          nowMs: Date.now(),
        },
        {
          command: replacement,
          tabletId: session.device.deviceId,
          outletId: envelope.outletId,
          businessDate: envelope.businessDate,
          chainId: envelope.chainId,
          dependsOnCommandIds: [],
          eligibleAtMs: Date.now(),
          nowMs: Date.now(),
        },
      )
      return {
        reference,
        commandType: envelope.type,
        resultCategory: 'corrected',
        orderNumber: null,
        receivedAt: new Date(envelope.createdAtMs).toISOString(),
        ageMs: Math.max(0, Date.now() - envelope.createdAtMs),
        deviceId: envelope.tabletId,
        refusedTrace: (await store.database.results.get(reference))?.refusedTrace ?? '',
        state: 'corrected',
        linkedCorrectionId: correctionId,
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.personId,
        discardReason: null,
      }
    },

    async discardAttention(reference, reason) {
      const { session, shift, store } = requireTablet()
      const envelope = await store.database.envelopes.get(reference)
      if (!envelope) throw new BillingActionError('not_found', 'That delivery item was not found.')
      const result = await store.database.results.get(reference)
      await store.discardAttention(
        {
          commandId: reference,
          tabletId: session.device.deviceId,
          shiftId: shift.id,
          actorId: shift.personId,
          nowMs: Date.now(),
        },
        reason,
      )
      return {
        reference,
        commandType: envelope.type,
        resultCategory: result?.result.status ?? 'discarded',
        orderNumber: null,
        receivedAt: new Date(envelope.createdAtMs).toISOString(),
        ageMs: Math.max(0, Date.now() - envelope.createdAtMs),
        deviceId: envelope.tabletId,
        refusedTrace: result?.refusedTrace ?? '',
        state: 'discarded',
        linkedCorrectionId: null,
        resolvedAt: new Date().toISOString(),
        resolvedBy: shift.personId,
        discardReason: reason.trim(),
      }
    },

    async listDeliveryDiagnostics(outletId): Promise<BillingDeliveryDiagnostic[]> {
      const { data, error } = await client
        .from('billing_commands')
        .select('id, command_type, result_category, received_at, result')
        .eq('outlet_id', outletId)
        .order('received_at', { ascending: false })
        .limit(100)
      if (error) throw actionError(error, 'Could not load delivery diagnostics.')
      return (data ?? []).map((row) => ({
        reference: row.id,
        commandType: row.command_type,
        resultCategory: row.result_category,
        receivedAt: row.received_at,
        ageMs: Math.max(0, Date.now() - Date.parse(row.received_at)),
        orderNumber: refusedOrderNumber(row.result),
      }))
    },
  }
}
