import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'

import type { BillingOrder, KitchenMarks } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'

import { DishOpenOrderSummary } from './dish-open-order-summary'
import { ManagerBillingHistory } from './manager-billing-history'

/**
 * The owner's Orders tab (each-dish-is-ticked-off, design R11): what the page
 * reads and when, and the card's four dish states.
 */
function managerSession(): Session {
  const persona = personaFixtures.franchise_admin
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

it('counts the open orders on opening, and reads them and the kitchens each time the tab is chosen', async () => {
  const user = userEvent.setup()
  const adapters = createMockAdapters('franchise_admin', createDemoData({ dishWalkthrough: true }))
  const kitchens = vi.spyOn(adapters.kitchen, 'readManagerDishMarks')
  const list = vi.spyOn(adapters.billing, 'listManagerOpenOrders')
  const count = vi.spyOn(adapters.billing, 'countManagerOpenOrders')
  render(
    <MemoryRouter>
      <SessionContext.Provider value={managerSession()}>
        <AdaptersContext.Provider value={adapters}>
          <ManagerBillingHistory />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  const tab = await screen.findByRole('tab', { name: /Open orders \(\d+\)/ })
  // Opening the page counts the open orders and reads none of them.
  expect(count).toHaveBeenCalledOnce()
  expect(list).not.toHaveBeenCalled()
  expect(kitchens).not.toHaveBeenCalled()
  await user.click(tab)
  await screen.findByTestId('manager-open-order-104')
  // Choosing the tab reads it; leaving and coming back reads it again.
  expect(list).toHaveBeenCalledOnce()
  expect(kitchens).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('tab', { name: /^Bills/ }))
  await user.click(screen.getByRole('tab', { name: /Open orders/ }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  expect(kitchens).toHaveBeenCalledTimes(2)
  // Tapping the open tab again reads it again too.
  await user.click(screen.getByRole('tab', { name: /Open orders/ }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  const fresh = await screen.findByTestId('manager-open-order-104')
  expect(within(fresh).getByTestId('manager-dish-order-104')).toBeInTheDocument()
  expect(within(fresh).queryByText('Order items')).toBeNull()
  await user.click(within(fresh).getByRole('button', { name: 'Cancel order 104' }))
  expect(screen.getByRole('dialog', { name: 'Cancel order 104' })).toBeVisible()
})

const order: BillingOrder = {
  id: 'o1',
  outletId: 'outlet',
  deviceId: 'till',
  orderNumber: 98,
  businessDate: '2026-10-14',
  orderedAt: '2026-10-14T10:00:00.000Z',
  preparedAt: null,
  status: 'open',
  creatorId: 'p',
  creatorName: 'Asha',
  deviceLabel: null,
  customerName: null,
  customerPhone: null,
  discounts: [],
  roundingPaise: 0,
  label: 'Blue cap',
  lines: ['placed', 'acked', 'done', 'handed'].map((id) => ({
    orderLineId: id,
    menuItemId: 'm',
    itemName: `Dish ${id}`,
    unitPricePaise: 13500,
    quantity: 1,
    preparedQuantity: id === 'handed' ? 1 : 0,
  })),
  totalPaise: 54000,
  cancelReason: null,
  cancelledAt: null,
  cancelledByName: null,
  paidAt: null,
  billId: null,
} as BillingOrder

const marks: KitchenMarks = {
  kitchens: [{ id: 'k1', label: 'Kitchen 1' }],
  orders: { o1: ['seen'] },
  kitchenTablets: 1,
  dishStates: { o1: ['ready'] },
  readyQuantities: { o1: { done: 1, handed: 1 } },
  ackedLines: { o1: ['acked'] },
}

const stateOf = (name: string) =>
  screen.getByText(`1 × ${name}`, { exact: false }).closest('li')!.dataset.dishState

it('draws a dish placed, acknowledged, Done or handed over, and each kitchen in words', () => {
  render(
    <DishOpenOrderSummary order={order} marks={marks} now={new Date('2026-10-14T10:21:00.000Z')} />,
  )
  expect(stateOf('Dish placed')).toBe('placed')
  expect(stateOf('Dish acked')).toBe('acknowledged')
  expect(stateOf('Dish done')).toBe('done')
  expect(stateOf('Dish handed')).toBe('handed_over')
  expect(screen.getByText('Kitchen 1 · ready')).toBeInTheDocument()
  expect(screen.getByText('Not paid')).toBeInTheDocument()
  expect(screen.getByText(/21m ago/)).toBeInTheDocument()
  expect(screen.getByText('No customer details yet')).toBeInTheDocument()
})

it('writes the customer as the rest of the app does, +91 and all', () => {
  render(
    <DishOpenOrderSummary
      order={{ ...order, customerName: 'Anushka Bose', customerPhone: '+919000010349' }}
      marks={marks}
      now={new Date()}
    />,
  )
  expect(screen.getByText('Anushka Bose · +91 90000 10349')).toBeInTheDocument()
})
