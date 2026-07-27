import { createContext, useContext } from 'react'

import type { DataAdapters } from './adapters'

/**
 * How adapters reach screens. The demo tree provides mock adapters, the real
 * tree provides Supabase adapters, and no screen ever knows which it got.
 *
 * There is deliberately no shared factory taking a `'demo' | 'real'` mode
 * parameter — that would be a guard where the design demands a structure.
 * Each branch imports only its own factory (design D2/D4).
 */
export const AdaptersContext = createContext<DataAdapters | undefined>(undefined)

export function useAdapters(): DataAdapters {
  const adapters = useContext(AdaptersContext)
  if (!adapters) {
    throw new Error('useAdapters called outside an adapters provider — wrap the tree in one.')
  }
  return adapters
}
