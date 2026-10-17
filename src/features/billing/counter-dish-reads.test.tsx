import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { CounterDeviceContext } from '@/session/counter-context'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'

import { BillingCounter } from './billing-counter'
import { KitchenMarksProvider } from './kitchen-marks'
import { useKitchenMarks } from './kitchen-marks-state'

/**
 * The counter's kitchen read and its rail's cards (each-dish-is-ticked-off,
 * design R5, R7): the marks come from `counter_kitchen_marks_v2`, re-read on a
 * return to the foreground, and each dish on a card is ticked off on its own.
 */
const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

it("reads the kitchen's marks through counter_kitchen_marks_v2, again on the foreground", async () => {
  const adapters = createMockAdapters('biller', createDemoData({ dishWalkthrough: true }))
  const dishRead = vi.spyOn(adapters.kitchen, 'readDishMarks')
  let marks!: ReturnType<typeof useKitchenMarks>
  function Capture() {
    marks = useKitchenMarks()
    return null
  }
  const view = render(
    <AdaptersContext.Provider value={adapters}>
      <CounterDeviceContext.Provider
        value={{
          kind: 'counter-device',
          device: { deviceId: 'device', outletId: 'outlet', label: 'Till' },
          shift: null,
        }}
      >
        <KitchenMarksProvider>
          <Capture />
        </KitchenMarksProvider>
      </CounterDeviceContext.Provider>
    </AdaptersContext.Provider>,
  )
  await waitFor(() => expect(dishRead).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(marks?.marks).not.toBeNull())
  // The Ready quantities and each kitchen's slot come with the read.
  expect(marks!.marks).toHaveProperty('readyQuantities')

  // A return to the foreground re-reads (design R5).
  const before = dishRead.mock.calls.length
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
  await waitFor(() => expect(dishRead.mock.calls.length).toBe(before + 1))
  view.unmount()
})

it("ticks each dish on the rail's cards, with no whole-order Prepared toggle", async () => {
  const adapters = createMockAdapters('biller', createDemoData({ dishWalkthrough: true }))
  render(
    <MemoryRouter>
      <SessionContext.Provider value={billerSession}>
        <AdaptersContext.Provider value={adapters}>
          <BillingCounter />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  const rail = await screen.findByTestId('counter-activity-rail')
  const card = await within(rail).findByTestId('open-order-105')
  expect(within(card).getAllByRole('button', { name: /^Tick / }).length).toBeGreaterThan(0)
  expect(within(card).queryByTestId(/^prepared-toggle-/)).toBeNull()
})
