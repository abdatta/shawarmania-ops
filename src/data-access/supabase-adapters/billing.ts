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
  type BillLineDraft,
  type BillingAdapter,
  type BillingAttentionItem,
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
  billTotals,
  classifySync,
  lineTotalPaise,
  PAYMENT_EDIT_WINDOW_MS,
  provisionalToken,
} from '@/domain'
import { newUuid } from '@/lib/uuid'
import {
  BillingDeliveryDatabase,
  BillingDeliveryStore,
  BillingDeliveryStoreError,
  BillingDrainCoordinator,
  BillingUnsentReporter,
  type BillingLockManager,
} from '@/outbox'
import type { CounterDeviceSession } from '@/session/counter-session'

import { createSupabaseBillingCommandAdapter } from './billing-command'

type OrderReadRow = Tables<'orders'> & {
  order_items: Tables<'order_items'>[]
  creator: { full_name: string } | { full_name: string }[] | null
  canceller: { full_name: string } | { full_name: string }[] | null
}

type BillReadRow = Tables<'bills'> & {
  bill_items: Tables<'bill_items'>[]
  bill_payments: Tables<'bill_payments'>[]
  order: { order_number: number } | { order_number: number }[] | null
  biller: { full_name: string } | { full_name: string }[] | null
  voider: { id: string; full_name: string } | { id: string; full_name: string }[] | null
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
  }
}

function orderView(row: OrderReadRow): BillingOrder {
  return {
    id: row.id,
    outletId: row.outlet_id,
    deviceId: row.device_id,
    orderNumber: row.order_number,
    localReference: null,
    businessDate: row.business_date,
    orderedAt: row.ordered_at,
    preparedAt: row.prepared_at,
    status: row.status,
    creatorId: row.created_by,
    creatorName: joined(row.creator)?.full_name ?? 'Counter operator',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines: row.order_items.map(lineView),
    totalPaise: row.total_paise,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    cancelledByName: joined(row.canceller)?.full_name ?? null,
    paidAt: row.paid_at,
    billId: row.bill_id,
  }
}

function billView(
  row: BillReadRow,
  effective: readonly EffectivePaymentRow[] = [],
  paymentEditable = false,
): BillingBill {
  const voider = joined(row.voider)
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
    paymentEditableUntil: paymentEditable
      ? new Date(Date.parse(row.paid_at) + PAYMENT_EDIT_WINDOW_MS).toISOString()
      : null,
    paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
    status: row.status,
    billerName: joined(row.biller)?.full_name ?? 'Counter operator',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines: row.bill_items.map(lineView),
    totalPaise: row.total_paise,
    voidKind: row.void_kind,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: voider ? { id: voider.id, name: voider.full_name } : null,
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

function orderPayload(
  orderId: string,
  businessDate: string,
  lines: readonly BillLineDraft[],
  customer: {
    customerId?: string | null
    customerName?: string | null
    customerPhone?: string | null
  },
): OrderContentPayload {
  const totals = billTotals(lines)
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
    })),
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
 * Billing's live adapter. Tablet writes cross the IndexedDB commit boundary and
 * return immediately; the one drain leader delivers them later. Manager writes
 * are online personal-device commands and never create a second local outbox.
 */
export function createSupabaseBillingAdapter(
  client: SupabaseClient<Database>,
  counterSession: CounterDeviceSession | null = null,
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

  const notify = () => {
    for (const listener of [...listeners]) listener()
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
      Date.parse(counterSession.shift.expiresAt) <= Date.now()
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

  async function readOrders(outletId: string, pipelineOnly: boolean): Promise<BillingOrder[]> {
    let query = client
      .from('orders')
      .select(
        '*, order_items(*), creator:profiles!orders_created_by_fkey(full_name), canceller:profiles!orders_cancelled_by_fkey(full_name)',
      )
      .eq('outlet_id', outletId)
      .order('ordered_at', { ascending: false })
    // Both money states come back and `inPipeline` decides below.
    if (pipelineOnly) query = query.in('status', ['open', 'paid'])
    const { data, error } = await query
    let orders: BillingOrder[]
    if (error) {
      if (!counterSession?.shift) throw actionError(error, 'Could not load open orders.')
      orders = [...orderCache.values()].filter(
        (order) => order.outletId === outletId && (!pipelineOnly || inPipeline(order)),
      )
    } else {
      orders = (data as unknown as OrderReadRow[]).map(orderView)
      for (const [id, cached] of orderCache) {
        if (cached.outletId === outletId) orderCache.delete(id)
      }
      for (const order of orders) orderCache.set(order.id, order)
    }

    if (database && counterSession) {
      const local = (await database.envelopes.where('outletId').equals(outletId).toArray())
        .filter((envelope) => envelope.state !== 'needs_attention')
        .sort((left, right) => left.createdAtMs - right.createdAtMs)
      const overlaid = new Map(orders.map((order) => [order.id, order]))
      for (const envelope of local) {
        switch (envelope.command.type) {
          case 'create_order': {
            const payload = envelope.command.payload
            overlaid.set(payload.orderId, {
              id: payload.orderId,
              outletId: envelope.outletId,
              deviceId: envelope.tabletId,
              orderNumber: 0,
              localReference: `Local · ${provisionalToken(envelope.commandId)}`,
              businessDate: payload.businessDate,
              orderedAt: envelope.command.createdAt,
              preparedAt: null,
              status: 'open',
              creatorId: counterSession.shift?.personId ?? '',
              creatorName: 'Counter operator',
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              lines: payload.lines.map((line) => ({
                menuItemId: line.menuItemId ?? '',
                itemName: line.itemName,
                unitPricePaise: line.unitPricePaise,
                quantity: line.quantity,
              })),
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
      orders = [...overlaid.values()]
    }

    for (const order of orders) orderCache.set(order.id, order)
    return orders.filter((order) => !pipelineOnly || inPipeline(order))
  }

  async function readOrder(orderId: string): Promise<BillingOrder | null> {
    const { data, error } = await client
      .from('orders')
      .select(
        '*, order_items(*), creator:profiles!orders_created_by_fkey(full_name), canceller:profiles!orders_cancelled_by_fkey(full_name)',
      )
      .eq('id', orderId)
      .maybeSingle()
    if (error) throw actionError(error, 'Could not load that order.')
    if (!data) return null
    const order = orderView(data as unknown as OrderReadRow)
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
        '*, bill_items(*), bill_payments(*), order:orders!bills_order_id_fkey(order_number), biller:profiles!bills_biller_profile_id_fkey(full_name), voider:profiles!bills_voided_by_fkey(id, full_name)',
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
    if (ids.length > 0) {
      const response = await client.from('effective_bill_payments').select('*').in('bill_id', ids)
      if (response.error) throw actionError(response.error, 'Could not load bill payments.')
      effective = response.data as EffectivePaymentRow[]
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
      ),
    )
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

  /** Rebuild locally effective bills from the durable command log after reloads. */
  async function overlayDurableBills(
    shiftId: string,
    serverBills: readonly BillingBill[],
  ): Promise<BillingBill[]> {
    const bills = new Map(serverBills.map((bill) => [bill.id, bill]))
    if (!database || !counterSession) return [...bills.values()]

    const envelopes = (
      await database.envelopes.where('tabletId').equals(counterSession.device.deviceId).toArray()
    )
      .filter((envelope) => envelope.shiftId === shiftId && envelope.state !== 'needs_attention')
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
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
          orderNumber: previous?.orderNumber ?? 0,
          localReference:
            previous?.localReference ?? `Local · ${provisionalToken(command.payload.orderId)}`,
          businessDate: command.payload.businessDate,
          orderedAt: previous?.orderedAt ?? command.createdAt,
          preparedAt: null,
          status: 'open',
          creatorId: counterSession.shift?.personId ?? '',
          creatorName: previous?.creatorName ?? 'Counter operator',
          customerName: command.payload.customerName,
          customerPhone: command.payload.customerPhone,
          lines: command.payload.lines.map((line) => ({
            menuItemId: line.menuItemId ?? '',
            itemName: line.itemName,
            unitPricePaise: line.unitPricePaise,
            quantity: line.quantity,
          })),
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
          orderedAt: command.createdAt,
          paidAt: command.createdAt,
          paymentBusinessDate: command.payload.paymentBusinessDate,
          payments: [...command.payload.payments],
          paymentRevision: 0,
          paymentEditableUntil: new Date(
            Date.parse(command.createdAt) + PAYMENT_EDIT_WINDOW_MS,
          ).toISOString(),
          paymentMethod:
            command.payload.payments.length > 1 ? 'mixed' : command.payload.payments[0]!.method,
          status: 'settled',
          billerName: 'Counter operator',
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
            businessDate: order.businessDate,
            orderedAt: order.orderedAt,
            paidAt: command.payload.paidAt,
            paymentBusinessDate: command.payload.paymentBusinessDate,
            payments: [...command.payload.payments],
            paymentRevision: 0,
            paymentEditableUntil: new Date(
              Date.parse(command.payload.paidAt) + PAYMENT_EDIT_WINDOW_MS,
            ).toISOString(),
            paymentMethod:
              command.payload.payments.length > 1 ? 'mixed' : command.payload.payments[0]!.method,
            status: 'settled',
            billerName: order.creatorName,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            lines: order.lines,
            totalPaise: order.totalPaise,
            voidKind: null,
            voidReason: null,
            voidedAt: null,
            voidedBy: null,
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

  async function startRuntime(): Promise<void> {
    if (!counterSession || !store || !database || deliverySubscription) return
    const tabletId = counterSession.device.deviceId
    deliverySubscription = liveQuery(() =>
      database.envelopes.where('tabletId').equals(tabletId).toArray(),
    ).subscribe({
      next: (envelopes) => {
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
            ...deliverySync(
              envelopes.length,
              envelopes.some((envelope) => envelope.state === 'needs_attention'),
            ),
          },
        }
        notify()
      },
      error: () => undefined,
    })

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
        }
        return result
      },
      onReachability: (reachable) => {
        deliveryReachable = reachable
        state = { ...state, sync: deliverySync(state.sync.pending) }
        notify()
      },
    })
    reporter = new BillingUnsentReporter({
      store,
      tabletId,
      reportState: async (unsent) => {
        const { error } = await client.rpc('report_counter_device_state', { p_unsent: unsent })
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
    async listBillers() {
      return []
    },
    openShift: notLive,
    async closeShift(shiftId: string): Promise<void> {
      const { session, shift, store } = requireTablet()
      if (shift.id !== shiftId) {
        throw new BillingActionError('not_permitted', 'That is not this tablet’s live shift.')
      }
      await startRuntime()
      const localBills = await overlayDurableBills(shift.id, [])
      const editable = localBills.filter(
        (bill) => bill.paymentEditableUntil && Date.parse(bill.paymentEditableUntil) > Date.now(),
      )
      if (editable.length > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          'A recent payment can still be edited. Wait for its five-minute window, then finish the day.',
        )
      }
      const locallyUnresolved = await store.countUnsent(session.device.deviceId)
      if (locallyUnresolved > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          `${locallyUnresolved} billing action${locallyUnresolved === 1 ? ' is' : 's are'} still unresolved on this tablet.`,
        )
      }
      const { data: recentServerBills, error: recentError } = await client
        .from('bills')
        .select('id')
        .eq('counter_device_id', session.device.deviceId)
        .eq('payment_business_date', shift.businessDate)
        .eq('status', 'settled')
        .gt('paid_at', new Date(Date.now() - PAYMENT_EDIT_WINDOW_MS).toISOString())
        .limit(1)
      if (recentError) throw actionError(recentError, 'Could not verify the payment edit window.')
      if (recentServerBills.length > 0) {
        throw new BillingActionError(
          'unresolved_operations',
          'A recent payment can still be edited. Wait for its five-minute window, then finish the day.',
        )
      }
      await drain?.runOnce()
      const unresolved = await store.countUnsent(session.device.deviceId)
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
      const totals = billTotals(draft.lines)
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
          })),
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
        orderedAt: command.createdAt,
        paidAt: command.createdAt,
        paymentBusinessDate: draft.businessDate,
        payments: [...draft.payments],
        paymentRevision: 0,
        paymentEditableUntil: new Date(
          Date.parse(command.createdAt) + PAYMENT_EDIT_WINDOW_MS,
        ).toISOString(),
        paymentMethod: draft.payments.length > 1 ? 'mixed' : draft.payments[0]!.method,
        status: 'settled',
        billerName: 'Counter operator',
        customerName: draft.customerName?.trim() || null,
        customerPhone: draft.customerPhone?.trim() || null,
        lines: [...draft.lines],
        totalPaise: totals.totalPaise,
        voidKind: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
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
        !bill.paymentEditableUntil ||
        Date.parse(bill.paymentEditableUntil) <= Date.now()
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
        orderNumber: 0,
        localReference: `Local · ${provisionalToken(input.clientId)}`,
        businessDate: input.businessDate,
        orderedAt: command.createdAt,
        preparedAt: null,
        status: 'open',
        creatorId: shift.personId,
        creatorName: 'Counter operator',
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        lines: [...input.lines],
        totalPaise: billTotals(input.lines).totalPaise,
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
      const command = await createBillingCommand({
        commandId: newUuid(),
        tabletId: session.device.deviceId,
        shiftId: shift.id,
        type: 'revise_order',
        createdAt: new Date().toISOString(),
        payload: orderPayload(orderId, existing.businessDate, input.lines, input),
      })
      await accept(command, existing.outletId, existing.businessDate, orderId)
      const revised = { ...existing, ...input, totalPaise: billTotals(input.lines).totalPaise }
      orderCache.set(orderId, revised)
      return revised
    },

    listOpenOrders(outletId) {
      return readOrders(outletId, true)
    },

    async payOrder(orderId, payments): Promise<BillingBill> {
      const { session, shift } = requireTablet()
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing) throw new BillingActionError('not_found', 'That order is no longer open.')
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
        orderedAt: existing.orderedAt,
        paidAt: command.payload.paidAt,
        paymentBusinessDate: command.payload.paymentBusinessDate,
        payments: [...payments],
        paymentRevision: 0,
        paymentEditableUntil: new Date(
          Date.parse(command.payload.paidAt) + PAYMENT_EDIT_WINDOW_MS,
        ).toISOString(),
        paymentMethod: payments.length > 1 ? 'mixed' : payments[0]!.method,
        status: 'settled',
        billerName: existing.creatorName,
        customerName: existing.customerName,
        customerPhone: existing.customerPhone,
        lines: existing.lines,
        totalPaise: existing.totalPaise,
        voidKind: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
      }
      localBillCache.set(localBill.id, localBill)
      return localBill
    },

    async cancelOrder(orderId, reason): Promise<BillingOrder> {
      const { session, shift } = requireTablet()
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing) throw new BillingActionError('not_found', 'That order is no longer open.')
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
      const existing = orderCache.get(orderId) ?? (await readOrder(orderId))
      if (!existing)
        throw new BillingActionError('not_found', 'That order is no longer on the pipeline.')
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
      if (!existing || existing.billId !== billId) {
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
      let serverBills: BillingBill[]
      try {
        serverBills = await readBills({ counterShiftId: shiftId })
      } catch (cause) {
        // The counter's durable command log is sufficient to keep a newly
        // accepted payment editable while the backend is unreachable. Other
        // failures still surface instead of silently presenting partial data.
        if (typeof navigator === 'undefined' || navigator.onLine) throw cause
        serverBills = []
      }
      const bills = (await overlayDurableBills(shiftId, serverBills)).sort((a, b) =>
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
        .select('id, command_type, result_category, received_at')
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
      }))
    },
  }
}
