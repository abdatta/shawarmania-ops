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
 * Deliberately small: last writer wins, orders and lines only — plus the demo
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
      orders: DemoStore['orders']
      orderItems: DemoStore['orderItems']
      kitchen?: Pick<DemoKitchen, 'acks' | 'filter'>
    }

function signature(store: DemoStore, kitchen: DemoKitchen): string {
  return JSON.stringify([
    store.orders.map((o) => [o.id, o.status, o.changed_at, o.prepared_at, o.cancelled_at]),
    store.orderItems.length,
    kitchen.acks.length,
    kitchen.filter,
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
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel(CHANNEL)
  let epoch = startedAt
  let last = signature(store, kitchen)

  const send = () =>
    channel.postMessage({
      type: 'orders',
      epoch,
      orders: store.orders,
      orderItems: store.orderItems,
      kitchen: { acks: kitchen.acks, filter: kitchen.filter },
    } satisfies Message)

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
    // A tab that opened after the last reset joins the demo the others hold.
    epoch = message.epoch
    store.orders.splice(0, store.orders.length, ...message.orders)
    store.orderItems.splice(0, store.orderItems.length, ...message.orderItems)
    // A tab still on an older build sends no kitchen; keep this tab's.
    if (message.kitchen) {
      kitchen.acks.splice(0, kitchen.acks.length, ...message.kitchen.acks)
      kitchen.filter = message.kitchen.filter
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
