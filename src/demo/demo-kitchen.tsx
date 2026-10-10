import { useMemo, useState, type ReactNode } from 'react'

import {
  DEMO_KITCHEN_DEVICE_ID,
  DEMO_KITCHEN_LABEL,
  DEMO_KITCHEN_SHIFT_ID,
} from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { DEMO_BILLER_ID } from '@/data-access/mock/fixtures/billing'
import { KitchenBoardScreen } from '@/features/kitchen/kitchen-board-screen'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'

/**
 * The demo's kitchen tablet (#70): **the real kitchen board**, on a kitchen
 * shift already open, over the demo's orders.
 *
 * Open the Biller in one tab and this in another: an order saved at the
 * counter appears here, shaking and ringing, within a second — the demo's
 * orders are mirrored between tabs for exactly this walkthrough. The shift
 * handshake is skipped because the counter walkthrough already shows it, and
 * the kitchen's is the same screen.
 */
export function DemoKitchen({ banner, today }: { banner: ReactNode; today: string }) {
  // Opened when the walkthrough arrived, once; never re-read during render.
  const [openedAt] = useState(() => Date.now())
  const session = useMemo<CounterDeviceSession>(
    () => ({
      kind: 'counter-device',
      device: {
        deviceId: DEMO_KITCHEN_DEVICE_ID,
        outletId: DEMO_OUTLET_ID,
        label: DEMO_KITCHEN_LABEL,
        kind: 'kitchen',
      },
      shift: {
        id: DEMO_KITCHEN_SHIFT_ID,
        personId: DEMO_BILLER_ID,
        outletId: DEMO_OUTLET_ID,
        openedAt: new Date(openedAt).toISOString(),
        businessDate: today,
        expiresAt: new Date(openedAt + 12 * 60 * 60 * 1000).toISOString(),
        kind: 'kitchen',
      },
    }),
    [today, openedAt],
  )

  return (
    <CounterDeviceContext.Provider value={session}>
      <div className="sticky top-0 z-40" data-window-edge="top">
        {banner}
      </div>
      <KitchenBoardScreen />
    </CounterDeviceContext.Provider>
  )
}
