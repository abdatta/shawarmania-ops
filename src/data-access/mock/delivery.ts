import type { Tables } from '../database.types'
import type {
  DeliveryDayStats,
  DeliveryHandover,
  DeliveryHistoryOrder,
  DeliveryLine,
} from '../adapters'
import type { DemoStore } from './store'
import { DEMO_OUTLET_ID } from './store'

/**
 * The demo's delivery orders (delivery-orders-are-made-not-billed), as
 * `delivery_orders` and `delivery_handover_takebacks` hold them. Labels stay in
 * the dish workflow's own `labels`, which the demo never deletes, so a kept
 * label is simply the one it already has.
 */
export interface DemoDeliveryRecord {
  markedAt: string
  handedOverAt: string | null
  handedOverBy: string | null
  handedOverShiftId: string | null
  /** What the handover changed of the counter's ticks, so a take-back puts back exactly that. */
  priorTicks: { lineId: string; quantity: number | null }[] | null
}

export interface DemoDeliveryTakeBack {
  orderId: string
  handedOverAt: string
  takenBackAt: string
  takenBackBy: string
  reason: string
}

export interface DemoDelivery {
  orders: Record<string, DemoDeliveryRecord>
  takebacks: DemoDeliveryTakeBack[]
}

export { DELIVERY_TAKE_BACK_MS } from '../adapters'
import { DELIVERY_TAKE_BACK_MS } from '../adapters'

export function demoDelivery(store: DemoStore): DemoDelivery {
  if (!store.dishWorkflow)
    store.dishWorkflow = { labels: {}, notes: {}, preparations: {}, readies: [], commands: [] }
  store.dishWorkflow.delivery ??= { orders: {}, takebacks: [] }
  return store.dishWorkflow.delivery
}

export function isDeliveryOrder(store: DemoStore, orderId: string): boolean {
  return Boolean(store.dishWorkflow?.delivery?.orders[orderId])
}

function itemLines(store: DemoStore, orderId: string): DeliveryLine[] {
  return store.orderItems
    .filter((line) => line.order_id === orderId && line.kind === 'item')
    .map((line) => ({
      id: line.id,
      itemName: line.item_name,
      quantity: line.quantity,
      note: store.dishWorkflow?.notes[line.id] ?? null,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.id.localeCompare(b.id))
}

/** A shift's handed-over delivery orders, newest first, as My shift lists them. */
export function shiftHandovers(store: DemoStore, shiftId: string, now: number): DeliveryHandover[] {
  const delivery = store.dishWorkflow?.delivery
  if (!delivery) return []
  return store.orders
    .filter((order) => {
      const record = delivery.orders[order.id]
      return order.status === 'handed_over' && record?.handedOverShiftId === shiftId
    })
    .map((order) => {
      const handedOverAt = delivery.orders[order.id]!.handedOverAt!
      const until = Date.parse(handedOverAt) + DELIVERY_TAKE_BACK_MS
      return {
        orderId: order.id,
        orderNumber: order.order_number,
        label: store.dishWorkflow?.labels[order.id] ?? null,
        orderedAt: order.ordered_at,
        handedOverAt,
        takeBackUntil: until > now ? new Date(until).toISOString() : null,
        lines: itemLines(store, order.id),
      }
    })
    .sort((a, b) => b.handedOverAt.localeCompare(a.handedOverAt))
}

/** An outlet-day's handed-over and cancelled delivery orders, as Billing history lists them. */
export function deliveryHistory(
  store: DemoStore,
  outletId: string,
  businessDate: string,
  nameOf: (id: string | null) => string | null,
): DeliveryHistoryOrder[] {
  const delivery = store.dishWorkflow?.delivery
  if (!delivery) return []
  return store.orders
    .filter(
      (order) =>
        order.outlet_id === outletId &&
        order.business_date === businessDate &&
        delivery.orders[order.id] &&
        (order.status === 'handed_over' || order.status === 'cancelled'),
    )
    .map((order) => {
      const record = delivery.orders[order.id]!
      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status as 'handed_over' | 'cancelled',
        orderedAt: order.ordered_at,
        label: store.dishWorkflow?.labels[order.id] ?? null,
        createdByName: nameOf(order.created_by),
        handedOverAt: record.handedOverAt,
        handedOverByName: nameOf(record.handedOverBy),
        cancelledAt: order.cancelled_at,
        cancelledByName: nameOf(order.cancelled_by),
        cancelReason: order.cancel_reason,
        lines: itemLines(store, order.id),
        takeBacks: delivery.takebacks
          .filter((takeBack) => takeBack.orderId === order.id)
          .map((takeBack) => ({
            takenBackAt: takeBack.takenBackAt,
            takenBackByName: nameOf(takeBack.takenBackBy),
            handedOverAt: takeBack.handedOverAt,
            reason: takeBack.reason,
          })),
      }
    })
    .sort((a, b) =>
      (b.handedOverAt ?? b.cancelledAt ?? '').localeCompare(a.handedOverAt ?? a.cancelledAt ?? ''),
    )
}

/**
 * Hand a delivery order over: tick every dish still owed, remembering what each
 * tick was, and close it. No bill.
 */
export function applyHandover(
  store: DemoStore,
  orderId: string,
  shift: Pick<Tables<'counter_shifts'>, 'id' | 'person_id'>,
  at: string,
): void {
  const order = store.orders.find((row) => row.id === orderId)
  const record = store.dishWorkflow?.delivery?.orders[orderId]
  const workflow = store.dishWorkflow
  if (!order || !record || !workflow || order.status !== 'open') return
  const prior: { lineId: string; quantity: number | null }[] = []
  for (const line of store.orderItems.filter(
    (item) => item.order_id === orderId && item.kind === 'item',
  )) {
    const ticked = workflow.preparations[line.id]
    if ((ticked ?? 0) >= line.quantity) continue
    prior.push({ lineId: line.id, quantity: ticked ?? null })
    workflow.preparations[line.id] = line.quantity
  }
  order.prepared_at ??= at
  order.prepared_source ??= 'counter'
  order.status = 'handed_over'
  record.handedOverAt = at
  record.handedOverBy = shift.person_id
  record.handedOverShiftId = shift.id
  record.priorTicks = prior
}

/** Put a handed-over order back on the rail as it was, recording why. */
export function applyTakeBack(
  store: DemoStore,
  orderId: string,
  personId: string,
  reason: string,
  at: string,
): void {
  const order = store.orders.find((row) => row.id === orderId)
  const delivery = store.dishWorkflow?.delivery
  const record = delivery?.orders[orderId]
  const workflow = store.dishWorkflow
  if (!order || !record || !workflow || !delivery || order.status !== 'handed_over') return
  delivery.takebacks.push({
    orderId,
    handedOverAt: record.handedOverAt!,
    takenBackAt: at,
    takenBackBy: personId,
    reason,
  })
  for (const tick of record.priorTicks ?? []) {
    if (tick.quantity === null) delete workflow.preparations[tick.lineId]
    else workflow.preparations[tick.lineId] = tick.quantity
  }
  if ((record.priorTicks ?? []).length > 0) {
    order.prepared_at = null
    order.prepared_source = null
  }
  order.status = 'open'
  record.handedOverAt = null
  record.handedOverBy = null
  record.handedOverShiftId = null
  record.priorTicks = null
}

/**
 * Stats → Delivery over the demo's rows (design D6): the counter figures'
 * definitions, for delivery orders alone, and no money.
 */
export function deliveryDayStats(
  store: DemoStore,
  outletId: string,
  businessDate: string,
  seenIds: ReadonlySet<string>,
): DeliveryDayStats {
  const orders = store.orders.filter(
    (order) =>
      order.outlet_id === outletId &&
      order.business_date === businessDate &&
      isDeliveryOrder(store, order.id),
  )
  const ids = new Set(orders.map((order) => order.id))
  const lastReady = new Map<string, number>()
  for (const ready of store.dishWorkflow?.readies ?? []) {
    if (ready.undone || !ids.has(ready.orderId)) continue
    const at = Date.parse(ready.at)
    lastReady.set(ready.orderId, Math.max(at, lastReady.get(ready.orderId) ?? at))
  }
  const toReady: number[] = []
  const handover: number[] = []
  for (const order of orders) {
    const at = lastReady.get(order.id)
    if (at === undefined) continue
    const ordered = Date.parse(order.ordered_at)
    if (at >= ordered) toReady.push((at - ordered) / 1000)
    if (order.prepared_source === 'counter' && order.prepared_at) {
      const prepared = Date.parse(order.prepared_at)
      if (prepared >= at) handover.push((prepared - at) / 1000)
    }
  }
  const mean = (values: number[]) =>
    values.length === 0
      ? null
      : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  return {
    placed: orders.length,
    updated: orders.filter((order) => order.changed_at !== null).length,
    cancelled: orders.filter((order) => order.status === 'cancelled').length,
    handedOver: orders.filter((order) => order.status === 'handed_over').length,
    seen: [...ids].filter((id) => seenIds.has(id)).length,
    ready: lastReady.size,
    toReadySeconds: mean(toReady),
    handoverSeconds: mean(handover),
  }
}

/**
 * The store as Analytics → Delivery reads it: each handed-over delivery order a
 * settled "bill" of its item lines at no money, so the Sales and Items reads
 * count orders and dishes over them and can say nothing about revenue.
 */
export function deliveryAnalyticsStore(store: DemoStore): DemoStore {
  const orders = store.orders.filter(
    (order) => order.status === 'handed_over' && isDeliveryOrder(store, order.id),
  )
  const bills = orders.map(
    (order) =>
      ({
        id: order.id,
        outlet_id: order.outlet_id,
        business_date: order.business_date,
        ordered_at: order.ordered_at,
        paid_at: store.dishWorkflow!.delivery!.orders[order.id]!.handedOverAt ?? order.ordered_at,
        status: 'settled',
        total_paise: 0,
        discount_paise: 0,
      }) as unknown as Tables<'bills'>,
  )
  const billItems = store.orderItems
    .filter((line) => orders.some((order) => order.id === line.order_id))
    .map(
      (line) =>
        ({
          ...line,
          bill_id: line.order_id,
          line_total_paise: 0,
          discount_paise: 0,
        }) as unknown as Tables<'bill_items'>,
    )
  return { ...store, bills, billItems, aggregatorChannelDays: store.aggregatorChannelDays }
}

const DELIVERY_LABELS = ['ZMT 6241', 'SWG 3310', 'ZMT 6198', 'ZMT 6205']

/**
 * The delivery walkthrough (delivery-orders-are-made-not-billed, Demo): a
 * cooking delivery order on the rail and the kitchen, two handed over in this
 * shift (one inside its take-back window), one cancelled, and six days of
 * handed-over ones so Stats, Items and Sales have a Delivery view to show.
 */
export function seedDeliveryOrders(store: DemoStore): void {
  const delivery = demoDelivery(store)
  const workflow = store.dishWorkflow!
  const shift = store.shifts.find(
    (row) => row.outlet_id === DEMO_OUTLET_ID && row.ended_at === null,
  )
  const source = store.orders.find((order) => order.outlet_id === DEMO_OUTLET_ID)
  if (!shift || !source) return
  const items = store.menuItems.filter(
    (item) => item.outlet_id === DEMO_OUTLET_ID && item.is_available,
  )
  const shawarma = items.find((item) => /chicken.*shawarma/i.test(item.name)) ?? items[0]
  const katsu = items.find((item) => /katsu/i.test(item.name)) ?? items[1]
  const roll = items.find((item) => /roll|wrap/i.test(item.name)) ?? items[2] ?? shawarma
  if (!shawarma || !katsu || !roll) return
  // The demo's Kalyani offers Delivery beside its dine-in and takeaway.
  const service = store.serviceSettings.get(DEMO_OUTLET_ID)
  if (service) store.serviceSettings.set(DEMO_OUTLET_ID, { ...service, deliveryOffered: true })
  const now = Date.now()
  let serial = 0
  // Today's numbers continue the day's sequence, and the counter carries on after them.
  const todayKey = `${DEMO_OUTLET_ID}:${store.today}`
  const base = Math.max(
    store.orderNumbers.get(todayKey) ?? 0,
    ...store.orders
      .filter((order) => order.outlet_id === DEMO_OUTLET_ID && order.business_date === store.today)
      .map((order) => order.order_number),
  )
  store.orderNumbers.set(todayKey, base + 5)

  const add = (options: {
    daysAgo: number
    number: number
    minutesAgo: number
    dishes: [Tables<'menu_items'>, number][]
    label: string | null
    status: 'open' | 'handed_over' | 'cancelled'
    handedOverMinutesAgo?: number
    readyMinutesAgo?: number
    /** A kitchen marked the first dish Ready a minute ago, so the rail shows it. */
    firstDishReady?: boolean
    /** A note on the last dish, as the biller types one. */
    lastDishNote?: string
    /** Every dish ticked a minute ago: made, waiting for its rider. */
    allTicked?: boolean
  }) => {
    serial++
    const id = `e8300000-0000-4000-a000-${String(serial).padStart(12, '0')}`
    const dayShift = options.daysAgo * 24 * 60
    const orderedAt = new Date(now - (options.minutesAgo + dayShift) * 60_000).toISOString()
    const handedOverAt =
      options.handedOverMinutesAgo === undefined
        ? null
        : new Date(now - (options.handedOverMinutesAgo + dayShift) * 60_000).toISOString()
    const total = options.dishes.reduce((sum, [item, n]) => sum + item.price_paise * n, 0)
    const cancelled = options.status === 'cancelled'
    store.orders.push({
      ...source,
      id,
      label: null,
      order_number: options.number,
      business_date: store.businessDate(options.daysAgo),
      service_type: null,
      table_number: null,
      table_shared: false,
      ordered_at: orderedAt,
      created_at: orderedAt,
      created_by: shift.person_id,
      created_shift_id: shift.id,
      device_id: shift.device_id,
      changed_at: null,
      changed_by: null,
      changed_shift_id: null,
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      customer_tier: null,
      subtotal_paise: total,
      total_paise: total,
      discount_paise: 0,
      tax_paise: 0,
      rounding_paise: 0,
      status: options.status,
      prepared_at: handedOverAt,
      prepared_source: handedOverAt ? 'counter' : null,
      paid_at: null,
      paid_by: null,
      paid_shift_id: null,
      bill_id: null,
      cancel_reason: cancelled ? 'Cancelled on Zomato' : null,
      cancelled_at: cancelled ? new Date(now - 30 * 60_000).toISOString() : null,
      cancelled_by: cancelled ? shift.person_id : null,
      cancelled_device_id: cancelled ? shift.device_id : null,
      cancelled_shift_id: cancelled ? shift.id : null,
    })
    workflow.labels[id] = options.label
    delivery.orders[id] = {
      markedAt: orderedAt,
      handedOverAt,
      handedOverBy: handedOverAt ? shift.person_id : null,
      // Only today's are this shift's; the days before were other shifts'.
      handedOverShiftId: handedOverAt && options.daysAgo === 0 ? shift.id : null,
      priorTicks: handedOverAt ? [] : null,
    }
    options.dishes.forEach(([item, quantity], index) => {
      const lineId = `e8310000-0000-4000-a000-${String(serial * 10 + index + 1).padStart(12, '0')}`
      store.orderItems.push({
        note: null,
        id: lineId,
        order_id: id,
        menu_item_id: item.id,
        item_name: item.name,
        quantity,
        unit_price_paise: item.price_paise,
        line_total_paise: item.price_paise * quantity,
        discount_paise: 0,
        discount_percent_bp: null,
        category_name:
          store.menuCategories.find((category) => category.id === item.category_id)?.name ?? null,
        kind: 'item',
      })
      if (handedOverAt || options.allTicked) workflow.preparations[lineId] = quantity
    })
    if (options.allTicked) {
      const order = store.orders.find((row) => row.id === id)!
      order.prepared_at = new Date(now - 60_000).toISOString()
      order.prepared_source = 'counter'
    }
    if (options.lastDishNote) {
      const lines = store.orderItems.filter((line) => line.order_id === id)
      workflow.notes[lines.at(-1)!.id] = options.lastDishNote
    }
    if (options.firstDishReady) {
      const first = store.orderItems.find((line) => line.order_id === id)!
      workflow.readies.push({
        id: `e8320000-0000-4000-a000-${String(serial + 900).padStart(12, '0')}`,
        orderId: id,
        station: 1,
        lines: [{ id: first.id, quantity: first.quantity }],
        at: new Date(now - 60_000).toISOString(),
        undone: false,
      })
    }
    if (options.readyMinutesAgo !== undefined)
      workflow.readies.push({
        id: `e8320000-0000-4000-a000-${String(serial).padStart(12, '0')}`,
        orderId: id,
        station: 1,
        lines: store.orderItems
          .filter((line) => line.order_id === id)
          .map((line) => ({ id: line.id, quantity: line.quantity })),
        at: new Date(now - (options.readyMinutesAgo + dayShift) * 60_000).toISOString(),
        undone: false,
      })
  }

  add({
    daysAgo: 0,
    number: base + 4,
    minutesAgo: 6,
    dishes: [
      [shawarma, 2],
      [katsu, 1],
    ],
    label: DELIVERY_LABELS[0]!,
    status: 'open',
    firstDishReady: true,
    lastDishNote: 'No mayo',
  })
  add({
    daysAgo: 0,
    number: base + 5,
    minutesAgo: 9,
    dishes: [[roll, 1]],
    label: 'SWG 3342',
    status: 'open',
    readyMinutesAgo: 3,
    allTicked: true,
  })
  add({
    daysAgo: 0,
    number: base + 3,
    minutesAgo: 14,
    dishes: [[shawarma, 1]],
    label: DELIVERY_LABELS[1]!,
    status: 'handed_over',
    readyMinutesAgo: 4,
    handedOverMinutesAgo: 2,
  })
  add({
    daysAgo: 0,
    number: base + 1,
    minutesAgo: 58,
    dishes: [
      [shawarma, 2],
      [roll, 1],
    ],
    label: DELIVERY_LABELS[2]!,
    status: 'handed_over',
    readyMinutesAgo: 47,
    handedOverMinutesAgo: 45,
  })
  add({
    daysAgo: 0,
    number: base + 2,
    minutesAgo: 40,
    dishes: [[katsu, 2]],
    label: DELIVERY_LABELS[3]!,
    status: 'cancelled',
  })
  for (let daysAgo = 1; daysAgo <= 6; daysAgo++) {
    const count = 3 + ((daysAgo * 5) % 4)
    for (let n = 0; n < count; n++) {
      const minutesAgo = 120 + n * 70
      add({
        daysAgo,
        number: 300 + n,
        minutesAgo,
        dishes:
          n % 3 === 0
            ? [[shawarma, 2]]
            : n % 3 === 1
              ? [
                  [katsu, 1],
                  [shawarma, 1],
                ]
              : [[roll, 1 + (daysAgo % 2)]],
        label: `ZMT ${5000 + daysAgo * 10 + n}`,
        status: 'handed_over',
        readyMinutesAgo: minutesAgo - 11,
        handedOverMinutesAgo: minutesAgo - 14,
      })
    }
  }
}
