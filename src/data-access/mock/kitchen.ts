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
import {
  dishKitchenCardState,
  kitchenCardState,
  type KitchenAnswer,
  type KitchenDishState,
} from '@/domain'
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
  /**
   * The dish ticks' records, only when the caller is on the dish ticks' path
   * (each-dish-is-ticked-off, design R7). The demo always carries them; with
   * `dish-ticks` off the old methods ask for nothing, and read as before #74.
   */
  function dishes(on: boolean) {
    return on ? store.dishWorkflow : undefined
  }
  function carriedByKitchen(item: Tables<'order_items'>, on: boolean): boolean {
    const categoryId =
      store.menuItems.find((menu) => menu.id === item.menu_item_id)?.category_id ?? null
    const mainCourse =
      store.menuCategories.find((category) => category.id === categoryId)?.name === 'Main Course'
    return (
      visible(categoryId, kitchen.filter) &&
      (!dishes(on) || ((kitchen.station ?? 1) === 1 ? !mainCourse : mainCourse))
    )
  }
  /**
   * The lines this kitchen shows. On the dish ticks' path they carry notes, and
   * by default only the food still owed; `owedOnly: false` is the full snapshot
   * an acknowledgement records (design R4).
   */
  function lineSplit(
    order: Tables<'orders'>,
    on: boolean,
    owedOnly = true,
  ): { shown: KitchenLine[]; other: number } {
    const workflow = dishes(on)
    const shown: KitchenLine[] = []
    let other = 0
    for (const item of store.orderItems) {
      if (item.order_id !== order.id || item.kind !== 'item') continue
      const categoryId =
        store.menuItems.find((candidate) => candidate.id === item.menu_item_id)?.category_id ?? null
      const mainCourse =
        store.menuCategories.find((category) => category.id === categoryId)?.name === 'Main Course'
      const stationVisible = !workflow || ((kitchen.station ?? 1) === 1 ? !mainCourse : mainCourse)
      if (visible(categoryId, kitchen.filter) && stationVisible) {
        const owed =
          workflow && owedOnly
            ? dishOwed(
                item.quantity,
                readyQuantity(store, item.id, item.quantity),
                workflow.preparations[item.id] ?? 0,
              )
            : item.quantity
        if (owed <= 0) continue
        shown.push({
          id: item.id,
          menuItemId: item.menu_item_id,
          itemName: item.item_name,
          quantity: owed,
          ...(workflow ? { note: workflow.notes[item.id] ?? null } : {}),
        })
      } else {
        other += 1
      }
    }
    shown.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.id.localeCompare(b.id))
    return { shown, other }
  }

  /**
   * The kitchen's latest acknowledgement. On the dish ticks' path, only one made
   * after its latest Ready counts, and its full snapshot is read as owed now —
   * less what the counter has ticked and the kitchens marked Ready since — so
   * a tick after an ACK stays silent, as `kitchen_ticket_v2` reads it.
   */
  function latestAck(orderId: string, on: boolean): StoredAck | null {
    const workflow = dishes(on)
    let latest: StoredAck | null = null
    const cutoff = workflow ? activeReadies(orderId).at(-1)?.at : undefined
    for (const ack of kitchen.acks) {
      if (cutoff && ack.ackedAt <= cutoff) continue
      if (ack.orderId === orderId && (!latest || ack.ackedAt >= latest.ackedAt)) latest = ack
    }
    if (!latest) return null
    if (!workflow) {
      return {
        ...latest,
        lines: latest.lines.filter((line) => {
          const categoryId =
            store.menuItems.find((item) => item.id === line.menuItemId)?.category_id ?? null
          return visible(categoryId, kitchen.filter)
        }),
      }
    }
    return {
      ...latest,
      lines: latest.lines
        .map((line) => ({
          ...line,
          quantity: dishOwed(
            line.quantity,
            readyQuantity(store, line.id, line.quantity),
            workflow.preparations[line.id] ?? 0,
          ),
        }))
        .filter((line) => {
          const categoryId =
            store.menuItems.find((item) => item.id === line.menuItemId)?.category_id ?? null
          return line.quantity > 0 && visible(categoryId, kitchen.filter)
        }),
    }
  }

  function board(on: boolean): KitchenBoard {
    const workflow = dishes(on)
    const orders: KitchenOrder[] = store.orders
      .filter(
        (order) =>
          order.outlet_id === DEMO_OUTLET_ID &&
          // Not yet prepared, paid or not: a ticked order is done in the kitchen.
          (((order.status === 'open' || order.status === 'paid') && order.prepared_at === null) ||
            (order.status === 'cancelled' && order.business_date === store.today)),
      )
      .map((order) => {
        const { shown, other } = lineSplit(order, on)
        const ack = latestAck(order.id, on)
        return {
          id: order.id,
          orderNumber: order.order_number,
          ...(workflow
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
          acknowledged: workflow
            ? ack !== null &&
              kitchen.acks.some(
                (a) =>
                  a.orderId === order.id &&
                  a.kind === 'new' &&
                  (!activeReadies(order.id).at(-1)?.at ||
                    a.ackedAt > activeReadies(order.id).at(-1)!.at),
              )
            : kitchen.acks.some((a) => a.orderId === order.id && a.kind === 'new'),
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
    if (workflow) {
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
                Math.max(0, (workflow.preparations[item.id] ?? 0) - prior),
            )
            if (quantity === 0) continue
            lines.push({
              id: item.id,
              menuItemId: item.menu_item_id,
              itemName: item.item_name,
              quantity,
              note: workflow.notes[item.id] ?? null,
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
    if (workflow) {
      orders.sort(
        (a, b) =>
          a.orderedAt.localeCompare(b.orderedAt) ||
          (a.ticketNumber ?? 1) - (b.ticketNumber ?? 1) ||
          a.id.localeCompare(b.id),
      )
    } else {
      orders.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.id.localeCompare(b.id))
    }
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
  function singleCounterMarks(on: boolean): KitchenMarks {
    const workflow = dishes(on)
    const cards = new Map(board(on).orders.map((order) => [order.id, order]))
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
        const { shown } = lineSplit(order, on)
        const ack = latestAck(order.id, on)
        const carried =
          (workflow &&
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
        if (card)
          answer =
            (on ? dishKitchenCardState : kitchenCardState)(card) === 'quiet' ? 'seen' : 'waiting'
        else if (workflow && activeReadies(order.id).length > 0) answer = 'seen'
      }
      if (answer) orders[order.id] = [answer]
      if (workflow) {
        const carried = store.orderItems.filter(
          (item) =>
            item.order_id === order.id && item.kind === 'item' && carriedByKitchen(item, on),
        )
        if (carried.length) {
          const owed = carried.filter(
            (item) => (workflow.preparations[item.id] ?? 0) < item.quantity,
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
              ) > (workflow.preparations[item.id] ?? 0),
          )
          const acknowledged =
            answer === 'seen' || latestAck(order.id, on)?.orderVersion === version(order)
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
      ...(workflow
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

  /** Off, the one demo kitchen as before #74; on, its two stations side by side. */
  function counterMarks(on: boolean): KitchenMarks {
    if (!dishes(on)) return singleCounterMarks(false)
    const station = kitchen.station ?? 1
    const acks = kitchen.acks
    kitchen.stationAcks ??= {}
    kitchen.stationAcks[station] = acks
    try {
      kitchen.station = 1
      kitchen.acks = kitchen.stationAcks[1] ?? []
      const first = singleCounterMarks(true)
      kitchen.station = 2
      kitchen.acks = kitchen.stationAcks[2] ?? []
      const second = singleCounterMarks(true)
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

  /** An acknowledgement, recorded as the real ones are: old lines, or full lines with notes (R4). */
  function acknowledgeWith(
    input: Parameters<KitchenAdapter['acknowledge']>[0],
    on: boolean,
  ): 'accepted' | 'stale' {
    const order = store.orders.find((candidate) => candidate.id === input.orderId)
    if (!order) throw new Error('That order is not on this board.')
    if (kitchen.acks.some((ack) => ack.id === input.id)) return 'accepted'
    if (version(order) !== input.orderVersion) return 'stale'
    kitchen.acks.push({
      id: input.id,
      orderId: input.orderId,
      kind: input.kind,
      orderVersion: input.orderVersion,
      lines: lineSplit(order, on, false).shown,
      ackedAt: now().toISOString(),
    })
    if (dishes(on)) {
      kitchen.stationAcks ??= {}
      kitchen.stationAcks[kitchen.station ?? 1] = kitchen.acks
    }
    return 'accepted'
  }

  return {
    setDemoStation(station: number) {
      kitchen.stationAcks ??= {}
      kitchen.stationAcks[kitchen.station ?? 1] = kitchen.acks
      kitchen.station = station
      kitchen.acks = kitchen.stationAcks[station] ?? []
    },
    async ready(input) {
      const workflow = store.dishWorkflow
      if (!workflow) throw new Error('This demo has no dish records.')
      if (workflow.readies.some((ready) => ready.id === input.id)) return
      const order = store.orders.find(
        (order) => order.id === input.orderId && order.outlet_id === DEMO_OUTLET_ID,
      )
      if (!order || order.status === 'cancelled' || (order.status === 'paid' && order.prepared_at))
        throw new Error('That ticket is finished.')
      const shown = lineSplit(order, true).shown
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
      // Ready answers for ACK, as `kitchen_ready_v2` records it (design R4).
      if (
        !kitchen.acks.some((ack) => ack.orderId === order.id && ack.orderVersion === version(order))
      ) {
        acknowledgeWith(
          {
            id: crypto.randomUUID(),
            orderId: order.id,
            kind: kitchen.acks.some((ack) => ack.orderId === order.id && ack.kind === 'new')
              ? 'edit'
              : 'new',
            orderVersion: version(order),
          },
          true,
        )
      }
      workflow.readies.push({
        ...input,
        station: kitchen.station ?? 1,
        at: new Date(now().getTime() + 1).toISOString(),
        undone: false,
      })
    },
    async undoReady(id, readyId) {
      const workflow = store.dishWorkflow
      if (!workflow) throw new Error('This demo has no dish records.')
      if (workflow.commands.includes(id)) return
      const ready = workflow.readies.find(
        (ready) => ready.id === readyId && ready.station === (kitchen.station ?? 1),
      )
      if (!ready || ready.undone) throw new Error('This Ready is no longer available to undo.')
      ready.undone = true
      workflow.commands.push(id)
    },
    async readBoard() {
      return board(false)
    },

    async readDishBoard() {
      return board(true)
    },

    async readDishMarks() {
      return counterMarks(true)
    },

    async readManagerDishMarks(outletId) {
      // What the counter reads, for the one outlet asked about.
      const marks = counterMarks(true)
      const here = new Set(
        store.orders.filter((order) => order.outlet_id === outletId).map((order) => order.id),
      )
      const only = <T>(byOrder: Record<string, T> | undefined) =>
        byOrder && Object.fromEntries(Object.entries(byOrder).filter(([id]) => here.has(id)))
      // A dish is acknowledged when a kitchen's latest ACK of the order names it.
      const acks = [
        ...kitchen.acks,
        ...Object.entries(kitchen.stationAcks ?? {})
          .filter(([station]) => Number(station) !== (kitchen.station ?? 1))
          .flatMap(([, list]) => list),
      ]
      const ackedLines = Object.fromEntries(
        [...here]
          .map((orderId) => {
            const latest = acks
              .filter((ack) => ack.orderId === orderId)
              .sort((a, b) => b.ackedAt.localeCompare(a.ackedAt))[0]
            return [orderId, latest ? latest.lines.map((line) => line.id) : []] as const
          })
          .filter(([, lines]) => lines.length > 0),
      )
      return {
        ...marks,
        orders: only(marks.orders)!,
        ...(marks.dishStates ? { dishStates: only(marks.dishStates)! } : {}),
        ...(marks.readyQuantities ? { readyQuantities: only(marks.readyQuantities)! } : {}),
        ackedLines,
      }
    },

    async acknowledgeDish(input) {
      return acknowledgeWith(input, true)
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
      return counterMarks(false)
    },

    async setFilter(mode, categoryIds, sort) {
      kitchen.filter = { mode, categoryIds: [...new Set(categoryIds)] }
      kitchen.filterChangedAt = now().toISOString()
      kitchen.sort = sort
    },

    async acknowledge(input) {
      return acknowledgeWith(input, false)
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
