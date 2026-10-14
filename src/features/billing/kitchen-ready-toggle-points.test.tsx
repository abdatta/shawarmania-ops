import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { CounterDeviceContext } from '@/session/counter-context'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { DishOpenOrdersSurface } from './dish-open-orders-surface'
import { KitchenMarksProvider } from './kitchen-marks'

/**
 * The counter's toggle points for `kitchen-ready` (each-dish-is-ticked-off,
 * design R1, R4). With the dish ticks on and Ready off, a kitchen's Ready food
 * reads as acknowledged (it is) and nothing is drawn for Ready; with Ready on,
 * that kitchen's slot is the Ready bell and the card is flagged for the scroll
 * chip. The demo's two-kitchen order #97 has Kitchen 1 Ready and Kitchen 2 sent.
 */
const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

describeChangeGate('kitchen-ready', (on) => {
  it(`${on ? 'shows' : 'does not show'} a kitchen's Ready food as a bell on the rail's card`, async () => {
    const adapters = createMockAdapters('biller', createDemoData({ dishTicks: 'on' }))
    render(
      <ChangeGatesForTest on={{ 'dish-ticks': true, 'kitchen-ready': on }}>
        <MemoryRouter>
          <SessionContext.Provider value={billerSession}>
            <AdaptersContext.Provider value={adapters}>
              <CounterDeviceContext.Provider
                value={{
                  kind: 'counter-device',
                  device: {
                    deviceId: 'till',
                    outletId: personaFixtures.biller.assignments[0]!.outletId!,
                    label: 'Till',
                  },
                  shift: null,
                }}
              >
                <KitchenMarksProvider>
                  <DishOpenOrdersSurface embedded />
                </KitchenMarksProvider>
              </CounterDeviceContext.Provider>
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>
      </ChangeGatesForTest>,
    )
    const card = await screen.findByTestId('open-order-97')
    // Wait for the kitchens' slots: they arrive with the marks, after the orders.
    await waitFor(() =>
      expect(within(card).getAllByTestId(/^kitchen-(status-slot|pickup-bell)$/)).toHaveLength(2),
    )
    const first = within(card)
      .getAllByTestId(/^kitchen-(status-slot|pickup-bell)$/)
      .find((slot) => slot.getAttribute('data-kitchen') === '1')!
    if (on) {
      expect(first).toHaveAttribute('data-testid', 'kitchen-pickup-bell')
      expect(first).toHaveAttribute('data-kitchen-state', 'ready')
      expect(card.closest('li')).toHaveAttribute('data-ready-order')
    } else {
      expect(within(card).queryByTestId('kitchen-pickup-bell')).toBeNull()
      expect(first).toHaveAttribute('data-kitchen-state', 'acknowledged')
      expect(card.closest('li')).not.toHaveAttribute('data-ready-order')
    }
  })
})
