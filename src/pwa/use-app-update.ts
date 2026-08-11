import { useSyncExternalStore } from 'react'

import {
  getServerUpdateState,
  getUpdateState,
  subscribeToUpdates,
  type UpdateState,
} from './update-store'

/**
 * Read the waiting-build state from React.
 *
 * The store lives outside React because registration does (design D2); this is
 * the whole of the bridge.
 */
export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribeToUpdates, getUpdateState, getServerUpdateState)
}
