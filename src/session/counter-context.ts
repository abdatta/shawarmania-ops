import { createContext, useContext } from 'react'

import type { CounterDeviceSession } from './counter-session'

/**
 * The tablet's own context, provided only by `CounterRoot`.
 *
 * Separate from `SessionContext` on purpose. A component that reads
 * `useSession()` is asking about a person, and a tablet is not one; giving both
 * one context would mean every such component silently receiving something with
 * no name and no assignments. Two contexts means a component asks for exactly
 * the thing it can handle, and gets a thrown error rather than a plausible
 * answer if it asks in the wrong tree.
 */
export const CounterDeviceContext = createContext<CounterDeviceSession | undefined>(undefined)

export function useCounterDevice(): CounterDeviceSession {
  const device = useContext(CounterDeviceContext)
  if (!device) {
    throw new Error('useCounterDevice called outside the counter tablet tree.')
  }
  return device
}
