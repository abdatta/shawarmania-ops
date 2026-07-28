import { useSyncExternalStore } from 'react'

import { useAdapters } from '@/data-access'
import type { CounterState } from '@/data-access/adapters'

/**
 * Who is on shift and where the queue is, read straight from the billing
 * adapter.
 *
 * `useSyncExternalStore` rather than a context provider on purpose: the adapter
 * is already the single source of truth, and the shell chrome and the billing
 * screen both need this. Reading it in two places from one store is what stops
 * the header and the counter ever disagreeing about whether a shift is open.
 *
 * The adapter's snapshot is stable between changes, so this does not re-render
 * on every tick — only when something actually moves.
 */
export function useCounterState(): CounterState {
  const { billing } = useAdapters()
  return useSyncExternalStore(billing.subscribeCounter, billing.getCounterState)
}
