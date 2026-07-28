import { BillingActionError, type BillingAdapter, type CounterState } from '../adapters'

/**
 * The real counter adapter — **deliberately not connected yet**.
 *
 * `DataAdapters` is total, so the real tree has to supply a `billing` today. The
 * counter surfaces are `demo`-gated and never mount against it;
 * `counter-devices-and-offline` (#9) brings the enrolled device and the durable
 * outbox, and `billing-live` (#10) replaces this file with the real settlement
 * path.
 *
 * The reads are not a placeholder lie: there genuinely is no open shift and
 * nothing pending in the real system yet, so the counter chrome resting at
 * "No shift open / synced" is the correct thing for it to say. The writes refuse
 * in this app's voice rather than throwing something raw at a screen.
 */

const RESTING: CounterState = {
  shift: null,
  queued: [],
  sync: { kind: 'synced', pending: 0 },
}

export function createSupabaseBillingAdapter(): BillingAdapter {
  const notLive = () =>
    Promise.reject(
      new BillingActionError(
        'not_live',
        'The counter is not connected to real data yet. It is being demonstrated first.',
      ),
    )

  return {
    getCounterState() {
      return RESTING
    },
    subscribeCounter() {
      // Nothing ever changes, so there is nothing to notify. Returning a no-op
      // unsubscribe keeps `useSyncExternalStore` happy without a subscription.
      return () => {}
    },
    async listBillers() {
      return []
    },
    openShift: notLive,
    closeShift: notLive,
    settleBill: notLive,
    cancelQueuedBill: notLive,
  }
}
