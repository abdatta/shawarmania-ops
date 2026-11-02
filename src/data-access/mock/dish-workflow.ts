import type { DemoStore } from './store'
import { DEMO_OUTLET_ID } from './store'
import type { BillLineDraft } from '../adapters'

export interface DemoReady {
  id: string
  orderId: string
  station: number
  lines: { id: string; quantity: number }[]
  at: string
  undone: boolean
}

/** Proposed columns/records alongside schema-typed fixtures until phase 2. */
export interface DemoDishWorkflow {
  labels: Record<string, string | null>
  notes: Record<string, string | null>
  preparations: Record<string, number>
  readies: DemoReady[]
  commands: string[]
  /** When an edit added each line, as `order_line_additions` (design R12). */
  additions?: Record<string, string>
  /** Delivery orders and their take-backs (delivery-orders-are-made-not-billed). */
  delivery?: import('./delivery').DemoDelivery
}

export function readyQuantity(store: DemoStore, id: string, quantity: number): number {
  return Math.min(
    quantity,
    (store.dishWorkflow?.readies ?? [])
      .filter((ready) => !ready.undone)
      .reduce(
        (sum, ready) =>
          sum +
          ready.lines.filter((line) => line.id === id).reduce((n, line) => n + line.quantity, 0),
        0,
      ),
  )
}

export function workflowLines(store: DemoStore, lines: BillLineDraft[]): BillLineDraft[] {
  if (!store.dishWorkflow) return lines
  return lines.map((line) => {
    const id = line.orderLineId ?? line.workflowLineId ?? ''
    return {
      ...line,
      workflowLineId: id,
      note: store.dishWorkflow!.notes[id] ?? null,
      preparedQuantity: store.dishWorkflow!.preparations[id] ?? 0,
      readyQuantity: readyQuantity(store, id, line.quantity),
      ...(store.dishWorkflow!.additions?.[id]
        ? { addedAt: store.dishWorkflow!.additions[id] }
        : {}),
    }
  })
}

/**
 * The demo's dish records, empty: what a store not seeded with the walkthrough
 * carries, so every read and revision has somewhere to look.
 */
export function emptyDishWorkflow(store: DemoStore): void {
  store.dishWorkflow = { labels: {}, notes: {}, preparations: {}, readies: [], commands: [] }
}

/**
 * The dish ticks' walkthrough (each-dish-is-ticked-off): a labelled order, noted
 * dishes, a two-kitchen order with one side Ready, a ticket after Ready and a
 * paid order still cooking. It reshapes some fixture orders and adds four, so it
 * is seeded for the demo and for a test that reads it, and no other.
 */
export function seedDishWorkflow(store: DemoStore): void {
  emptyDishWorkflow(store)
  const workflow = store.dishWorkflow!
  const source = store.orders.find(
    (order) => order.outlet_id === DEMO_OUTLET_ID && order.status === 'open' && !order.prepared_at,
  )
  if (!source) return
  workflow.labels[source.id] = 'Red shirt'
  source.service_type = 'takeaway'
  source.table_number = null
  source.ordered_at = new Date(Date.now() - 12 * 60_000).toISOString()
  source.created_at = source.ordered_at
  const original = store.orderItems.find(
    (line) => line.order_id === source.id && line.kind === 'item',
  )
  if (original) workflow.notes[original.id] = 'No sauce'
  for (const order of store.orders.filter((row) => row.prepared_at)) {
    if (order.outlet_id === DEMO_OUTLET_ID && order.status === 'open') {
      order.ordered_at = new Date(Date.now() - 84 * 60_000).toISOString()
      order.created_at = order.ordered_at
    }
    for (const line of store.orderItems.filter(
      (item) => item.order_id === order.id && item.kind === 'item',
    ))
      workflow.preparations[line.id] = line.quantity
  }
  const items = store.menuItems.filter(
    (item) => item.outlet_id === DEMO_OUTLET_ID && item.is_available,
  )
  const shawarma = items.find((item) => /chicken.*shawarma/i.test(item.name)) ?? items[0]
  const pasta = items.find((item) => /chicken katsu rice/i.test(item.name)) ?? items[1]
  if (!shawarma || !pasta) return
  for (let i = 0; i < 4; i++) {
    const id = `e7400000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`
    const selected =
      i === 1 ? [shawarma, pasta] : i === 2 ? [shawarma, shawarma, shawarma] : [shawarma]
    const orderedAt = new Date(Date.now() - (i + 1) * 60_000).toISOString()
    const total = selected.reduce((sum, item) => sum + item.price_paise, 0)
    store.orders.push({
      ...source,
      id,
      order_number: 96 + i,
      service_type: i === 0 || i === 3 ? 'dine_in' : i === 1 ? 'takeaway' : null,
      table_number: i === 0 ? 6 : i === 3 ? 9 : null,
      ordered_at: orderedAt,
      created_at: orderedAt,
      changed_at: null,
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      customer_tier: null,
      subtotal_paise: total,
      total_paise: total,
      discount_paise: 0,
      rounding_paise: 0,
      status: i === 3 ? 'paid' : 'open',
      paid_at: i === 3 ? orderedAt : null,
      paid_by: i === 3 ? source.created_by : null,
      paid_shift_id: i === 3 ? source.created_shift_id : null,
      bill_id: null,
    })
    workflow.labels[id] = ['Table by door', 'Rahul', 'Blue cap', 'Paid · still cooking'][i]!
    selected.forEach((item, j) => {
      const lineId = `e7410000-0000-4000-a000-${String(i * 10 + j + 1).padStart(12, '0')}`
      store.orderItems.push({
        note: null,
        id: lineId,
        order_id: id,
        menu_item_id: item.id,
        item_name: item.name,
        quantity: 1,
        unit_price_paise: item.price_paise,
        line_total_paise: item.price_paise,
        discount_paise: 0,
        discount_percent_bp: null,
        category_name: null,
        kind: 'item',
      })
      if (i === 0) workflow.notes[lineId] = 'Extra spicy'
      if (i === 2 && j === 0) workflow.preparations[lineId] = 1
      if (i === 2 && j === 2) workflow.notes[lineId] = 'No onion'
      if (i === 2 && j === 1)
        workflow.readies.push({
          id: `e7420000-0000-4000-a000-${String(i * 10 + j + 1).padStart(12, '0')}`,
          orderId: id,
          station: 1,
          lines: [{ id: lineId, quantity: 1 }],
          at: orderedAt,
          undone: false,
        })
      if (i === 1 && j === 0)
        workflow.readies.push({
          id: `e7420000-0000-4000-a000-${String(i * 10 + j + 1).padStart(12, '0')}`,
          orderId: id,
          station: 1,
          lines: [{ id: lineId, quantity: 1 }],
          at: orderedAt,
          undone: false,
        })
    })
    if (i === 3)
      store.orderPayments.set(id, {
        payments: [{ method: 'cash', amountPaise: total }],
        paidAt: orderedAt,
        shiftId: source.created_shift_id,
      })
  }
}
