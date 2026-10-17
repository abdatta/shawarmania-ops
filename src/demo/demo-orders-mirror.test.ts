import { afterEach, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data-access/mock'
import { mirrorDemoOrders } from './demo-orders-mirror'

class Channel {
  static opened: Channel[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  sent: unknown[] = []
  constructor() {
    Channel.opened.push(this)
  }
  postMessage(message: unknown) {
    this.sent.push(structuredClone(message))
  }
  close() {}
  deliver(message: unknown) {
    this.onmessage?.({ data: structuredClone(message) } as MessageEvent<unknown>)
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Channel.opened = []
})

it('publishes a local Undo before adopting an incoming counter snapshot', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('BroadcastChannel', Channel)
  const cook = createDemoData({ dishWalkthrough: true })
  const stopCook = mirrorDemoOrders(cook.store, cook.kitchen, 0, () => {}, 'kitchen')
  const channel = Channel.opened[0]!
  channel.deliver({ type: 'hello', epoch: 0 })
  const snapshot = channel.sent.at(-1) as Record<string, unknown>
  const ready = cook.store.dishWorkflow!.readies[0]!
  ready.undone = true
  // A counter handover arrives before the next 500ms kitchen broadcast.
  channel.deliver({ ...snapshot, writer: 'counter' })
  await vi.advanceTimersByTimeAsync(500)
  const sent = channel.sent.filter((entry) => {
    const message = entry as { dishWorkflow?: typeof cook.store.dishWorkflow }
    return message.dishWorkflow?.readies.some((row) => row.id === ready.id && row.undone)
  })
  expect(sent).not.toHaveLength(0)
  stopCook()
})

it('stale snapshots cannot erase Ready, undo Undo, revert counter ticks or overwrite an order', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('BroadcastChannel', Channel)
  const counter = createDemoData({ dishWalkthrough: true })
  const cook = createDemoData({ dishWalkthrough: true })
  const stopCounter = mirrorDemoOrders(counter.store, counter.kitchen, 0, () => {}, 'counter')
  const stopCook = mirrorDemoOrders(cook.store, cook.kitchen, 0, () => {}, 'kitchen')
  const [counterChannel, cookChannel] = Channel.opened
  counterChannel!.deliver({ type: 'hello', epoch: 0 })
  const staleCounter = counterChannel!.sent.at(-1)
  cookChannel!.deliver(staleCounter)
  const line = cook.store.orderItems.find((line) => line.kind === 'item')!
  const ready = {
    id: 'review-ready',
    orderId: line.order_id,
    station: 1,
    lines: [{ id: line.id, quantity: 1 }],
    at: new Date().toISOString(),
    undone: false,
  }
  cook.store.dishWorkflow!.readies.push(ready)
  await vi.advanceTimersByTimeAsync(500)
  const readySnapshot = cookChannel!.sent.at(-1)
  counterChannel!.deliver(readySnapshot)
  cookChannel!.deliver(staleCounter)
  expect(cook.store.dishWorkflow!.readies.find((row) => row.id === ready.id)).toBeDefined()
  counter.store.dishWorkflow!.preparations[line.id] = 1
  counter.store.orders[0]!.changed_at = new Date().toISOString()
  const changedAt = counter.store.orders[0]!.changed_at
  counterChannel!.deliver(readySnapshot)
  expect(counter.store.dishWorkflow!.preparations[line.id]).toBe(1)
  expect(counter.store.orders[0]!.changed_at).toBe(changedAt)
  cook.store.dishWorkflow!.readies.find((row) => row.id === ready.id)!.undone = true
  await vi.advanceTimersByTimeAsync(500)
  counterChannel!.deliver(cookChannel!.sent.at(-1))
  counterChannel!.deliver(readySnapshot)
  expect(counter.store.dishWorkflow!.readies.find((row) => row.id === ready.id)?.undone).toBe(true)
  stopCounter()
  stopCook()
})
