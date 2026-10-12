import { readyQuantity } from './dish-workflow'
import { dishOwed } from '@/domain/dish-workflow'
import type {
  KitchenAcknowledgement,
  KitchenAdapter,
  KitchenBoard,
  KitchenFilterMode,
  KitchenLine,
  KitchenMarks,
  KitchenOrder,
  KitchenSort,
} from '../adapters'
import { kitchenCardState, type KitchenAnswer, type KitchenDishState } from '@/domain'
import type { Tables } from '../database.types'
import { DEMO_OUTLET_ID, type DemoStore } from './store'

/**
 * The demo kitchen (#70): the same board the database builds, computed over the
 * demo store the counter writes to. Kept beside the real rules on purpose —
 * which orders, which lines, when a lost line reads as a cancellation — so a
 * walkthrough shows what a real kitchen tablet would. Nothing is written
 * anywhere but this session's memory.
 */

export const DEMO_KITCHEN_DEVICE_ID = 'dddddddd-0000-4000-a000-0000000000c1'
export const DEMO_KITCHEN_SHIFT_ID = 'dddddddd-0000-4000-a000-0000000000c2'
/** The demo kitchen tablet's name, as its own screen and the counter's bell call it. */
export const DEMO_KITCHEN_LABEL = 'Kitchen 1'

interface StoredAck extends KitchenAcknowledgement {
  id: string
  orderId: string
}

/** The demo kitchen's own state, shared across role switches like the counter's. */
export interface DemoKitchen {
  filter: { mode: KitchenFilterMode; categoryIds: string[] }
  filterChangedAt: string | null
  sort: KitchenSort
  station?: number
  stationAcks?: Record<number, StoredAck[]>
  acks: StoredAck[]
}

export function createDemoKitchen(): DemoKitchen {
  return {
    filter: { mode: 'exclude', categoryIds: [] },
    filterChangedAt: null,
    sort: 'oldest_first',
    acks: [],
  }
}

function version(order: Tables<'orders'>): string {
  return order.changed_at ?? order.created_at
}

function visible(categoryId: string | null, filter: DemoKitchen['filter']): boolean {
  const listed = categoryId !== null && filter.categoryIds.includes(categoryId)
  return filter.mode === 'include' ? listed : !listed
}

export function createMockKitchenAdapter(
  store: DemoStore,
  kitchen: DemoKitchen,
  now: () => Date = () => new Date(),
  /** Who the demo says opened its kitchen: the walkthrough's biller. */
  operatorName = 'Demo Morning Biller',
): KitchenAdapter {
  function activeReadies(orderId: string) {
    return (store.dishWorkflow?.readies ?? []).filter(
      (ready) =>
        ready.orderId === orderId && !ready.undone && ready.station === (kitchen.station ?? 1),
    )
  }
  function carriedByKitchen(item: Tables<'order_items'>): boolean {
    const categoryId =
      store.menuItems.find((menu) => menu.id === item.menu_item_id)?.category_id ?? null
    const mainCourse =
      store.menuCategories.find((category) => category.id === categoryId)?.name === 'Main Course'
    return (
      visible(categoryId, kitchen.filter) &&
      (!store.dishWorkflow || ((kitchen.station ?? 1) === 1 ? !mainCourse : mainCourse))
    )
  }
  function lineSplit(order: Tables<'orders'>): { shown: KitchenLine[]; other: number } {
    const shown: KitchenLine[] = []
    let other = 0
    for (const item of store.orderItems) {
      if (item.order_id !== order.id || item.kind !== 'item') continue
      const categoryId =
        store.menuItems.find((candidate) => candidate.id === item.menu_item_id)?.category_id ?? null
      const mainCourse =
        store.menuCategories.find((category) => category.id === categoryId)?.name === 'Main Course'
      const stationVisible =
        !store.dishWorkflow || ((kitchen.station ?? 1) === 1 ? !mainCourse : mainCourse)
      if (visible(categoryId, kitchen.filter) && stationVisible) {
        const owed = store.dishWorkflow
          ? dishOwed(
              item.quantity,
              readyQuantity(store, item.id, item.quantity),
              store.dishWorkflow.preparations[item.id] ?? 0,
            )
          : item.quantity
        if (owed <= 0) continue
        shown.push({
          id: item.id,
          menuItemId: item.menu_item_id,
          itemName: item.item_name,
          quantity: owed,
          ...(store.dishWorkflow ? { note: store.dishWorkflow.notes[item.id] ?? null } : {}),
        })
      } else {
        other += 1
      }
    }
    shown.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.id.localeCompare(b.id))
    return { shown, other }
  }

  function latestAck(orderId: string): StoredAck | null {
    let latest: StoredAck | null = null
    const cutoff = activeReadies(orderId).at(-1)?.at
    for (const ack of kitchen.acks) {
      if (cutoff && ack.ackedAt <= cutoff) continue
      if (ack.orderId === orderId && (!latest || ack.ackedAt >= latest.ackedAt)) latest = ack
    }
    if (!latest) return null
    return {
      ...latest,
      lines: latest.lines
        .map((line) =>
          store.dishWorkflow
            ? {
                ...line,
                quantity: dishOwed(
                  line.quantity,
                  readyQuantity(store, line.id, line.quantity),
                  store.dishWorkflow.preparations[line.id] ?? 0,
                ),
              }
            : line,
        )
        .filter((line) => {
          const categoryId =
            store.menuItems.find((item) => item.id === line.menuItemId)?.category_id ?? null
          return line.quantity > 0 && visible(categoryId, kitchen.filter)
        }),
    }
  }

  function board(): KitchenBoard {
    const orders: KitchenOrder[] = store.orders
      .filter(
        (order) =>
          order.outlet_id === DEMO_OUTLET_ID &&
          // Not yet prepared, paid or not: a ticked order is done in the kitchen.
          (((order.status === 'open' || order.status === 'paid') && order.prepared_at === null) ||
            (order.status === 'cancelled' && order.business_date === store.today)),
      )
      .map((order) => {
        const { shown, other } = lineSplit(order)
        const ack = latestAck(order.id)
        return {
          id: order.id,
          orderNumber: order.order_number,
          ...(store.dishWorkflow
            ? {
                ticketNumber: activeReadies(order.id).length + 1,
              }
            : {}),
          serviceType: order.service_type,
          tableNumber: order.table_number,
          orderedAt: order.ordered_at,
          version: version(order),
          status: order.status,
          cancelledAt: order.cancelled_at,
          lines: shown,
          otherItemCount: other,
          acknowledged:
            ack !== null &&
            kitchen.acks.some(
              (a) =>
                a.orderId === order.id &&
                a.kind === 'new' &&
                (!activeReadies(order.id).at(-1)?.at ||
                  a.ackedAt > activeReadies(order.id).at(-1)!.at),
            ),
          latestAck: ack
            ? {
                kind: ack.kind,
                orderVersion: ack.orderVersion,
                lines: ack.lines,
                ackedAt: ack.ackedAt,
              }
            : null,
        }
      })
      .filter(
        (order) =>
          (order.lines.length > 0 || (order.latestAck?.lines.length ?? 0) > 0) &&
          !(
            order.latestAck?.kind === 'cancel' &&
            order.latestAck.orderVersion === order.version &&
            (order.status === 'cancelled' || order.lines.length === 0)
          ),
      )
    if (store.dishWorkflow) {
      for (const order of store.orders) {
        if (
          order.outlet_id !== DEMO_OUTLET_ID ||
          (order.status !== 'open' && order.status !== 'paid') ||
          order.prepared_at !== null
        )
          continue
        const allocated: Record<string, number> = {}
        activeReadies(order.id).forEach((ready, index) => {
          const lines: KitchenLine[] = []
          for (const captured of ready.lines) {
            const item = store.orderItems.find(
              (item) => item.id === captured.id && item.order_id === order.id,
            )
            const prior = allocated[captured.id] ?? 0
            allocated[captured.id] = prior + captured.quantity
            if (!item) continue
            const categoryId =
              store.menuItems.find((menu) => menu.id === item.menu_item_id)?.category_id ?? null
            if (!visible(categoryId, kitchen.filter)) continue
            // Handover consumes the oldest receipt first, never a later addition.
            const quantity = Math.max(
              0,
              Math.min(captured.quantity, Math.max(0, item.quantity - prior)) -
                Math.max(0, (store.dishWorkflow!.preparations[item.id] ?? 0) - prior),
            )
            if (quantity === 0) continue
            lines.push({
              id: item.id,
              menuItemId: item.menu_item_id,
              itemName: item.item_name,
              quantity,
              note: store.dishWorkflow!.notes[item.id] ?? null,
            })
          }
          if (lines.length === 0) return
          orders.push({
            id: `${order.id}:ready:${ready.id}`,
            sourceOrderId: order.id,
            readyId: ready.id,
            orderNumber: order.order_number,
            ticketNumber: index + 1,
            serviceType: order.service_type,
            tableNumber: order.table_number,
            orderedAt: order.ordered_at,
            version: version(order),
            status: order.status,
            cancelledAt: null,
            lines,
            otherItemCount: 0,
            acknowledged: true,
            latestAck: { kind: 'new', orderVersion: version(order), lines, ackedAt: ready.at },
          })
        })
      }
    }
    orders.sort(
      (a, b) =>
        a.orderedAt.localeCompare(b.orderedAt) ||
        (a.ticketNumber ?? 1) - (b.ticketNumber ?? 1) ||
        a.id.localeCompare(b.id),
    )
    return {
      readAt: now().toISOString(),
      filterChangedAt: kitchen.filterChangedAt,
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      shiftId: DEMO_KITCHEN_SHIFT_ID,
      operatorName,
      filter: { mode: kitchen.filter.mode, categoryIds: [...kitchen.filter.categoryIds] },
      sort: kitchen.sort,
      orders,
    }
  }

  /**
   * What the demo board, or the counter's bell, would answer, as a comparable
   * string: the orders, and the kitchen's acknowledgements and filter, which a
   * kitchen tab's ACK changes through the demo mirror (#72).
   */
  function signature(): string {
    return [
      store.orders
        .map((o) => `${o.id}:${o.status}:${o.changed_at ?? ''}:${o.prepared_at ?? ''}`)
        .join('|'),
      kitchen.acks.length,
      kitchen.station,
      JSON.stringify(store.dishWorkflow),
      kitchen.filter.mode,
      kitchen.filter.categoryIds.join(','),
      kitchen.filterChangedAt,
    ].join('#')
  }

  /**
   * The counter's read (#72), by the same rules as `counter_kitchen_marks()`:
   * the demo kitchen is always on shift, carries an order exactly when its board
   * would, and has answered it when its card there is quiet — or when the
   * counter has ticked it Prepared, because then the food is made.
   */
  function singleCounterMarks(): KitchenMarks {
    const cards = new Map(board().orders.map((order) => [order.id, order]))
    const orders: Record<string, (KitchenAnswer | null)[]> = {}
    const dishStates: Record<string, (KitchenDishState | null)[]> = {}
    for (const order of store.orders) {
      if (order.outlet_id !== DEMO_OUTLET_ID) continue
      const onRail =
        order.status === 'open' || (order.status === 'paid' && order.prepared_at === null)
      if (!onRail) continue
      let answer: KitchenAnswer | null = null
      if (order.prepared_at !== null) {
        // The board leaves out a prepared order, so ask the lines directly.
        const { shown } = lineSplit(order)
        const ack = latestAck(order.id)
        const carried =
          (store.dishWorkflow &&
            store.orderItems.some(
              (line) =>
                line.order_id === order.id &&
                line.kind === 'item' &&
                visible(
                  store.menuItems.find((item) => item.id === line.menu_item_id)?.category_id ??
                    null,
                  kitchen.filter,
                ) &&
                ((kitchen.station ?? 1) === 2
                  ? store.menuCategories.find(
                      (category) =>
                        category.id ===
                        store.menuItems.find((item) => item.id === line.menu_item_id)?.category_id,
                    )?.name === 'Main Course'
                  : store.menuCategories.find(
                      (category) =>
                        category.id ===
                        store.menuItems.find((item) => item.id === line.menu_item_id)?.category_id,
                    )?.name !== 'Main Course'),
            )) ||
          shown.length > 0 ||
          ((ack?.lines.length ?? 0) > 0 &&
            !(ack?.kind === 'cancel' && ack.orderVersion === version(order)))
        answer = carried ? 'seen' : null
      } else {
        const card = cards.get(order.id)
        if (card) answer = kitchenCardState(card) === 'quiet' ? 'seen' : 'waiting'
        else if (activeReadies(order.id).length > 0) answer = 'seen'
      }
      if (answer) orders[order.id] = [answer]
      if (store.dishWorkflow) {
        const carried = store.orderItems.filter(
          (item) => item.order_id === order.id && item.kind === 'item' && carriedByKitchen(item),
        )
        if (carried.length) {
          const owed = carried.filter(
            (item) => (store.dishWorkflow!.preparations[item.id] ?? 0) < item.quantity,
          )
          const readies = activeReadies(order.id)
          const ready = owed.some(
            (item) =>
              Math.min(
                item.quantity,
                readies.reduce(
                  (sum, receipt) =>
                    sum +
                    receipt.lines
                      .filter((line) => line.id === item.id)
                      .reduce((quantity, line) => quantity + line.quantity, 0),
                  0,
                ),
              ) > (store.dishWorkflow!.preparations[item.id] ?? 0),
          )
          const acknowledged =
            answer === 'seen' || latestAck(order.id)?.orderVersion === version(order)
          dishStates[order.id] = [
            owed.length === 0
              ? 'handed_over'
              : ready
                ? 'ready'
                : acknowledged
                  ? 'acknowledged'
                  : 'sent',
          ]
        }
      }
    }
    return {
      ...(store.dishWorkflow
        ? {
            dishStates,
            readyQuantities: Object.fromEntries(
              store.orders
                .filter((order) => order.outlet_id === DEMO_OUTLET_ID)
                .map((order) => [
                  order.id,
                  Object.fromEntries(
                    store.orderItems
                      .filter((line) => line.order_id === order.id && line.kind === 'item')
                      .map((line) => [line.id, readyQuantity(store, line.id, line.quantity)]),
                  ),
                ]),
            ),
          }
        : {}),
      kitchens: [{ id: DEMO_KITCHEN_DEVICE_ID, label: DEMO_KITCHEN_LABEL }],
      orders,
      kitchenTablets: 1,
    }
  }

  function counterMarks(): KitchenMarks {
    if (!store.dishWorkflow) return singleCounterMarks()
    const station = kitchen.station ?? 1
    const acks = kitchen.acks
    kitchen.stationAcks ??= {}
    kitchen.stationAcks[station] = acks
    try {
      kitchen.station = 1
      kitchen.acks = kitchen.stationAcks[1] ?? []
      const first = singleCounterMarks()
      kitchen.station = 2
      kitchen.acks = kitchen.stationAcks[2] ?? []
      const second = singleCounterMarks()
      const ids = new Set([...Object.keys(first.orders), ...Object.keys(second.orders)])
      return {
        ...first,
        kitchens: [...first.kitchens, { id: DEMO_KITCHEN_DEVICE_ID + '-2', label: 'Kitchen 2' }],
        kitchenTablets: 2,
        orders: Object.fromEntries(
          [...ids].map((id) => [
            id,
            [first.orders[id]?.[0] ?? null, second.orders[id]?.[0] ?? null],
          ]),
        ),
        dishStates: Object.fromEntries(
          [
            ...new Set([
              ...Object.keys(first.dishStates ?? {}),
              ...Object.keys(second.dishStates ?? {}),
            ]),
          ].map((id) => [
            id,
            [first.dishStates?.[id]?.[0] ?? null, second.dishStates?.[id]?.[0] ?? null],
          ]),
        ),
      }
    } finally {
      kitchen.station = station
      kitchen.acks = acks
    }
  }

  return {
    ...(store.dishWorkflow
      ? {
          setDemoStation(station: number) {
            kitchen.stationAcks ??= {}
            kitchen.stationAcks[kitchen.station ?? 1] = kitchen.acks
            kitchen.station = station
            kitchen.acks = kitchen.stationAcks[station] ?? []
          },
          async ready(input: {
            id: string
            orderId: string
            lines: { id: string; quantity: number }[]
          }) {
            const workflow = store.dishWorkflow!
            if (workflow.readies.some((ready) => ready.id === input.id)) return
            const order = store.orders.find(
              (order) => order.id === input.orderId && order.outlet_id === DEMO_OUTLET_ID,
            )
            if (
              !order ||
              order.status === 'cancelled' ||
              (order.status === 'paid' && order.prepared_at)
            )
              throw new Error('That ticket is finished.')
            const shown = lineSplit(order).shown
            if (
              input.lines.length === 0 ||
              input.lines.some(
                (line) =>
                  !Number.isInteger(line.quantity) ||
                  line.quantity <= 0 ||
                  !shown.some((item) => item.id === line.id),
              )
            )
              throw new Error('That dish is not this kitchen’s to prepare.')
            workflow.readies.push({
              ...input,
              station: kitchen.station ?? 1,
              at: now().toISOString(),
              undone: false,
            })
          },
          async undoReady(id: string, readyId: string) {
            const workflow = store.dishWorkflow!
            if (workflow.commands.includes(id)) return
            const ready = workflow.readies.find(
              (ready) => ready.id === readyId && ready.station === (kitchen.station ?? 1),
            )
            if (!ready || ready.undone)
              throw new Error('This Ready is no longer available to undo.')
            ready.undone = true
            workflow.commands.push(id)
          },
        }
      : {}),
    async readBoard() {
      return board()
    },

    async listCategories() {
      return store.menuCategories
        .filter((category) => category.outlet_id === DEMO_OUTLET_ID)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((category) => ({
          id: category.id,
          name: category.name,
          isActive: category.is_active,
        }))
    },

    async readCounterMarks() {
      return counterMarks()
    },

    async setFilter(mode, categoryIds, sort) {
      kitchen.filter = { mode, categoryIds: [...new Set(categoryIds)] }
      kitchen.filterChangedAt = now().toISOString()
      kitchen.sort = sort
    },

    async acknowledge(input) {
      const order = store.orders.find((candidate) => candidate.id === input.orderId)
      if (!order) throw new Error('That order is not on this board.')
      if (kitchen.acks.some((ack) => ack.id === input.id)) return 'accepted'
      if (version(order) !== input.orderVersion) return 'stale'
      kitchen.acks.push({
        id: input.id,
        orderId: input.orderId,
        kind: input.kind,
        orderVersion: input.orderVersion,
        lines: lineSplit(order).shown,
        ackedAt: now().toISOString(),
      })
      if (store.dishWorkflow) {
        kitchen.stationAcks ??= {}
        kitchen.stationAcks[kitchen.station ?? 1] = kitchen.acks
      }
      return 'accepted'
    },

    /**
     * The demo has no pulse table: one store backs every role in the tab, so a
     * once-a-second comparison of the orders the board reads stands in for the
     * database's nudge. Always reports itself live — the demo's connectivity
     * control is the counter's, and the kitchen is online by design.
     */
    subscribe(_outletId, onNudge, onStatus) {
      let last = signature()
      onStatus?.(true)
      const timer = setInterval(() => {
        const next = signature()
        if (next !== last) {
          last = next
          onNudge()
        }
      }, 1000)
      return () => {
        clearInterval(timer)
        onStatus?.(false)
      }
    },
  }
}
