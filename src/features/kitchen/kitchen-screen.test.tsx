import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_SHIFT_ID } from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

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

// A tap schedules a sound check 300 ms later on both boards; let it land here.
afterEach(() => new Promise((resolve) => window.setTimeout(resolve, 350)))

/**
 * Which kitchen screen a page runs is decided once, from its gate snapshot
 * (each-dish-is-ticked-off, design R7): off, the kitchen reads `kitchen_board`
 * exactly as it did before #74; on, it reads `kitchen_board_v2`.
 */
describeChangeGate('dish-ticks', (on) => {
  it(
    on
      ? 'runs the dish board and never reads the old one'
      : 'runs the old board and never reads the dish one',
    async () => {
      const data = createDemoData({ dishTicks: on ? 'on' : 'off' })
      const adapters = createMockAdapters('biller', data)
      const oldBoard = vi.spyOn(adapters.kitchen, 'readBoard')
      const dishBoard = vi.spyOn(adapters.kitchen, 'readDishBoard')
      render(
        <ChangeGatesForTest on={{ 'dish-ticks': on }}>
          <CounterDeviceContext.Provider value={session}>
            <AdaptersContext.Provider value={adapters}>
              <KitchenScreen player={player} />
            </AdaptersContext.Provider>
          </CounterDeviceContext.Provider>
        </ChangeGatesForTest>,
      )
      expect((await screen.findAllByTestId(/^kitchen-card-/)).length).toBeGreaterThan(0)
      expect(on ? dishBoard : oldBoard).toHaveBeenCalled()
      expect(on ? oldBoard : dishBoard).not.toHaveBeenCalled()
    },
  )
})
