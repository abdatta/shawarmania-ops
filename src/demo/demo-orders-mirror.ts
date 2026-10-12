import type { DemoKitchen } from '@/data-access/mock/kitchen'
import type { DemoStore } from '@/data-access/mock/store'

/**
 * Orders, mirrored between demo tabs of one browser (#70).
 *
 * Each tab holds its own demo store, so a counter walked in one tab and a
 * kitchen in another would never meet. The kitchen walkthrough exists to show
 * the counter ringing the kitchen, so the demo — and only the demo — copies its
 * orders and their lines across same-origin tabs with a `BroadcastChannel`.
 *
 * Orders and dish ticks come from counter tabs; Ready and ACK come from kitchens.
 * Ready snapshots merge by command ID, with Undo permanent within an epoch, so a
 * delayed counter snapshot cannot resurrect or erase a kitchen's action.
 * This includes the demo
 * kitchen's acknowledgements and filter, so a kitchen tab's ACK stops the bell
 * in a counter tab (#72) — and a tab that opens asks the others for what they
 * hold. Real tablets share nothing but the
 * server; this is a demo convenience and is never imported outside `src/demo`.
 *
 * **Start again starts every tab again.** A reset is announced with an epoch —
 * the moment it was pressed — and every message carries its tab's epoch. A tab
 * that hears a newer reset resets itself; orders from an older epoch are
 * ignored, so a tab that has not caught up yet cannot hand the old demo back to
 * the one that just started again.
 */

const CHANNEL = 'shawarmania-demo-orders'
const SCAN_MS = 500

type Message =
  | { type: 'hello'; epoch: number }
  | { type: 'reset'; epoch: number }
  | {
      type: 'orders'
      epoch: number
      writer?: 'counter' | 'kitchen'
      orders: DemoStore['orders']
      orderItems: DemoStore['orderItems']
      dishWorkflow?: DemoStore['dishWorkflow']
      kitchen?: Pick<DemoKitchen, 'acks' | 'filter' | 'stationAcks'> & {
        filterChangedAt?: string | null
      }
    }

function signature(store: DemoStore, kitchen: DemoKitchen): string {
  return JSON.stringify([
    store.orders.map((o) => [o.id, o.status, o.changed_at, o.prepared_at, o.cancelled_at]),
    store.orderItems,
    store.dishWorkflow,
    kitchen.stationAcks,
    kitchen.acks.length,
    kitchen.filter,
    kitchen.filterChangedAt,
  ])
}

/** Tell every other demo tab to start again; `epoch` is when this one did. */
export function announceDemoReset(epoch: number): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage({ type: 'reset', epoch } satisfies Message)
  channel.close()
}

export function mirrorDemoOrders(
  store: DemoStore,
  kitchen: DemoKitchen,
  startedAt: number,
  onReset: (epoch: number) => void,
  writer: 'counter' | 'kitchen' = 'counter',
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel(CHANNEL)
  let epoch = startedAt
  let last = signature(store, kitchen)

  const send = () => {
    if (store.dishWorkflow) {
      kitchen.stationAcks ??= {}
      kitchen.stationAcks[kitchen.station ?? 1] = kitchen.acks
    }
    channel.postMessage({
      type: 'orders',
      epoch,
      writer,
      orders: store.orders,
      orderItems: store.orderItems,
      ...(store.dishWorkflow ? { dishWorkflow: store.dishWorkflow } : {}),
      kitchen: {
        acks: kitchen.acks,
        ...(kitchen.stationAcks ? { stationAcks: kitchen.stationAcks } : {}),
        filter: kitchen.filter,
        filterChangedAt: kitchen.filterChangedAt,
      },
    } satisfies Message)
  }

  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data
    if (message.type === 'hello') {
      send()
      return
    }
    if (message.type === 'reset') {
      if (message.epoch > epoch) onReset(message.epoch)
      return
    }
    if (message.epoch < epoch) return
    // Do not let an incoming frame hide an action authored since our last scan.
    // Publish that action first; Ready/Undo merge monotonically at the other tab.
    if (signature(store, kitchen) !== last) {
      send()
      last = signature(store, kitchen)
    }
    // A tab that opened after the last reset joins the demo the others hold.
    epoch = message.epoch
    if (message.writer !== 'kitchen') {
      store.orders.splice(0, store.orders.length, ...message.orders)
      store.orderItems.splice(0, store.orderItems.length, ...message.orderItems)
    }
    if (message.dishWorkflow) {
      const readies = new Map((store.dishWorkflow?.readies ?? []).map((ready) => [ready.id, ready]))
      for (const ready of message.dishWorkflow.readies) {
        const held = readies.get(ready.id)
        readies.set(ready.id, { ...ready, undone: ready.undone || held?.undone === true })
      }
      const facts =
        message.writer === 'kitchen'
          ? (store.dishWorkflow ?? message.dishWorkflow)
          : message.dishWorkflow
      store.dishWorkflow = {
        ...facts,
        readies: [...readies.values()].sort((a, b) => a.at.localeCompare(b.at)),
      }
    }
    // A tab still on an older build sends no kitchen; keep this tab's.
    if (message.kitchen && message.writer !== 'counter') {
      if (!message.kitchen.stationAcks)
        kitchen.acks.splice(0, kitchen.acks.length, ...message.kitchen.acks)
      const stations = { ...kitchen.stationAcks }
      for (const [station, acks] of Object.entries(message.kitchen.stationAcks ?? {})) {
        const all = new Map((stations[Number(station)] ?? []).map((ack) => [ack.id, ack]))
        for (const ack of acks) all.set(ack.id, ack)
        stations[Number(station)] = [...all.values()]
      }
      kitchen.stationAcks = stations
      if (message.kitchen.stationAcks)
        kitchen.acks = kitchen.stationAcks[kitchen.station ?? 1] ?? []
      kitchen.filter = message.kitchen.filter
      kitchen.filterChangedAt = message.kitchen.filterChangedAt ?? null
    }
    // Adopted, not authored: remembering it stops this tab echoing it back.
    last = signature(store, kitchen)
  }

  const timer = window.setInterval(() => {
    const next = signature(store, kitchen)
    if (next === last) return
    last = next
    send()
  }, SCAN_MS)

  channel.postMessage({ type: 'hello', epoch } satisfies Message)

  return () => {
    window.clearInterval(timer)
    channel.close()
  }
}
