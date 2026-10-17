import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_SHIFT_ID } from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'

import { KitchenScreen } from './kitchen-screen'
import type { TunePlayer } from './ringer'

const player: TunePlayer = { play: () => 50, stop() {} }

const session: CounterDeviceSession = {
  kind: 'counter-device',
  device: {
    deviceId: DEMO_KITCHEN_DEVICE_ID,
    outletId: DEMO_OUTLET_ID,
    label: 'Kitchen 1',
    kind: 'kitchen',
  },
  shift: {
    id: DEMO_KITCHEN_SHIFT_ID,
    personId: 'biller',
    outletId: DEMO_OUTLET_ID,
    openedAt: new Date().toISOString(),
    businessDate: '2026-10-08',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    kind: 'kitchen',
  },
}

// A tap schedules a sound check 300 ms later; let it land here.
afterEach(() => new Promise((resolve) => window.setTimeout(resolve, 350)))

/**
 * The kitchen tablet runs the dish board (each-dish-is-ticked-off, design R7),
 * which reads `kitchen_board_v2`.
 */
it('runs the dish board', async () => {
  const data = createDemoData({ dishWalkthrough: true })
  const adapters = createMockAdapters('biller', data)
  const dishBoard = vi.spyOn(adapters.kitchen, 'readDishBoard')
  render(
    <CounterDeviceContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <KitchenScreen player={player} />
      </AdaptersContext.Provider>
    </CounterDeviceContext.Provider>,
  )
  expect((await screen.findAllByTestId(/^kitchen-card-/)).length).toBeGreaterThan(0)
  expect(dishBoard).toHaveBeenCalled()
})
