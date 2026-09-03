import { createContext, useContext } from 'react'

import type { DemoConnectivityState } from '@/data-access/mock'

/**
 * The union lives on the demo store, beside the state it names, and is
 * re-exported here so the banner does not have to reach into the mock tree to
 * spell one of its own options. See `DemoConnectivity` in
 * `src/data-access/mock/store.ts` for what separates the two offline scenes.
 */
export type { DemoConnectivityState }

export interface DemoConnectivityControl {
  state: DemoConnectivityState
  set(state: DemoConnectivityState): void
}

/**
 * How the demo indicator takes the counter's backend away.
 *
 * A context rather than a prop threaded through two shells, for the reason
 * `demo-reset.ts` gives about its own control: the control lives in the demo
 * banner, which the shells receive as an opaque slot and must not learn
 * anything about.
 *
 * It also does the Biller-only rule for free, and does it better than a role
 * test would. The provider is the demo's counter host, so the control exists
 * exactly where a counter is on screen — not on the three phone shells, which
 * hold no local queue and no resume record and would be misrepresented by a
 * control implying they keep working offline, and not on a Biller URL that
 * resolves to `NotFound`, where the banner renders beside the not-found page
 * rather than inside the tablet. Absence follows from what is rendered, so it
 * cannot drift out of step with the role router.
 */
export const DemoConnectivityContext = createContext<DemoConnectivityControl | null>(null)

/** Null outside the demo counter's tree, which is the honest answer there. */
export function useDemoConnectivity(): DemoConnectivityControl | null {
  return useContext(DemoConnectivityContext)
}
