import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { CounterDeviceContext } from '@/session/counter-context'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { BillingCounter } from './billing-counter'
import { KitchenMarksProvider } from './kitchen-marks'
import { useKitchenMarks } from './kitchen-marks-state'

/**
 * The counter's toggle points for `dish-ticks` (each-dish-is-ticked-off, design
 * R7). Off is the counter and its kitchen read exactly as they were before #74;
 * on is the dish ticks' own code, beside it. Each point is decided once from the
 * page's gate snapshot, so a test pins the snapshot and looks at what runs.
 */
const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

describeChangeGate('dish-ticks', (on) => {
  it(`reads the kitchen's marks through ${on ? 'counter_kitchen_marks_v2' : 'the old read'} only`, async () => {
    const adapters = createMockAdapters('biller', createDemoData({ dishTicks: on ? 'on' : 'off' }))
    const oldRead = vi.spyOn(adapters.kitchen, 'readCounterMarks')
    const dishRead = vi.spyOn(adapters.kitchen, 'readDishMarks')
    let marks!: ReturnType<typeof useKitchenMarks>
    function Capture() {
      marks = useKitchenMarks()
      return null
    }
    const view = render(
      <ChangeGatesForTest on={{ 'dish-ticks': on }}>
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
        </AdaptersContext.Provider>
      </ChangeGatesForTest>,
    )
    await waitFor(() => expect(on ? dishRead : oldRead).toHaveBeenCalledTimes(1))
    expect(on ? oldRead : dishRead).not.toHaveBeenCalled()
    await waitFor(() => expect(marks?.marks).not.toBeNull())
    // The Ready quantities and each kitchen's slot are the dish read's alone.
    if (on) expect(marks!.marks).toHaveProperty('readyQuantities')
    else expect(marks!.marks).not.toHaveProperty('readyQuantities')

    // A return to the foreground re-reads only on the dish path (design R5);
    // the old provider has no such trigger, as before #74.
    const before = (on ? dishRead : oldRead).mock.calls.length
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    if (on) await waitFor(() => expect(dishRead.mock.calls.length).toBe(before + 1))
    else expect(oldRead.mock.calls.length).toBe(before)
    view.unmount()
  })

  it(`ticks ${on ? 'each dish' : 'the whole order Prepared'} on the rail's cards`, async () => {
    const adapters = createMockAdapters('biller', createDemoData({ dishTicks: on ? 'on' : 'off' }))
    render(
      <ChangeGatesForTest on={{ 'dish-ticks': on }}>
        <MemoryRouter>
          <SessionContext.Provider value={billerSession}>
            <AdaptersContext.Provider value={adapters}>
              <BillingCounter />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>
      </ChangeGatesForTest>,
    )
    const rail = await screen.findByTestId('counter-activity-rail')
    const card = await within(rail).findByTestId('open-order-105')
    if (on) {
      expect(within(card).getAllByRole('button', { name: /^Tick / }).length).toBeGreaterThan(0)
      expect(within(card).queryByTestId(/^prepared-toggle-/)).toBeNull()
    } else {
      expect(within(card).getByTestId(/^prepared-toggle-/)).toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /^Tick / })).toBeNull()
    }
  })
})
