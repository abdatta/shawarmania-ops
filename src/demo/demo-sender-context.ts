import { createContext } from 'react'

import type { DemoSenderScene } from '@/data-access/mock/campaigns'

/**
 * What the demo says the campaign sender is doing, and the way to change it
 * (a-campaign-goes-out-on-whatsapp, design D15).
 *
 * A context for the reason `demo-connectivity.ts` gives about its own: the
 * control lives in the demo banner, which the shells receive as an opaque slot
 * and must not learn anything about. The provider is the demo's phone shell, so
 * the control is absent on the two tablets, which have no Campaigns pages.
 */
export interface DemoSenderControl {
  scene: DemoSenderScene
  set(scene: DemoSenderScene): void
}

export const DemoSenderContext = createContext<DemoSenderControl | null>(null)
