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
import { kitchenCardState, type KitchenAnswer } from '@/domain'
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
  function lineSplit(order: Tables<'orders'>): { shown: KitchenLine[]; other: number } {
    const shown: KitchenLine[] = []
    let other = 0
    for (const item of store.orderItems) {
      if (item.order_id !== order.id || item.kind !== 'item') continue
      const categoryId =
        store.menuItems.find((candidate) => candidate.id === item.menu_item_id)?.category_id ?? null
      if (visible(categoryId, kitchen.filter)) {
        shown.push({
          id: item.id,
          menuItemId: item.menu_item_id,
          itemName: item.item_name,
          quantity: item.quantity,
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
    for (const ack of kitchen.acks) {
      if (ack.orderId === orderId && (!latest || ack.ackedAt >= latest.ackedAt)) latest = ack
    }
    if (!latest) return null
    return {
      ...latest,
      lines: latest.lines.filter((line) => {
        const categoryId =
          store.menuItems.find((item) => item.id === line.menuItemId)?.category_id ?? null
        return visible(categoryId, kitchen.filter)
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
          serviceType: order.service_type,
          tableNumber: order.table_number,
          orderedAt: order.ordered_at,
          version: version(order),
          status: order.status,
          cancelledAt: order.cancelled_at,
          lines: shown,
          otherItemCount: other,
          acknowledged: kitchen.acks.some((a) => a.orderId === order.id && a.kind === 'new'),
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
      .sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.id.localeCompare(b.id))
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
  function counterMarks(): KitchenMarks {
    const cards = new Map(board().orders.map((order) => [order.id, order]))
    const orders: Record<string, (KitchenAnswer | null)[]> = {}
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
          shown.length > 0 ||
          ((ack?.lines.length ?? 0) > 0 &&
            !(ack?.kind === 'cancel' && ack.orderVersion === version(order)))
        answer = carried ? 'seen' : null
      } else {
        const card = cards.get(order.id)
        if (card) answer = kitchenCardState(card) === 'quiet' ? 'seen' : 'waiting'
      }
      if (answer) orders[order.id] = [answer]
    }
    return {
      kitchens: [{ id: DEMO_KITCHEN_DEVICE_ID, label: DEMO_KITCHEN_LABEL }],
      orders,
      kitchenTablets: 1,
    }
  }

  return {
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
