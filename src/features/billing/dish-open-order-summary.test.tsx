import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'

import type { BillingOrder, KitchenMarks } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { DishOpenOrderSummary } from './dish-open-order-summary'
import { ManagerBillingHistory } from './manager-billing-history'

/**
 * The owner's Orders tab with the dish ticks (each-dish-is-ticked-off, design
 * R11): the toggle point on the page, and the card's four dish states.
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

describeChangeGate('dish-ticks', (on) => {
  it(`${on ? 'fills in' : 'keeps'} the Orders tab's card, and reads the kitchens only when on`, async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters(
      'franchise_admin',
      createDemoData({ dishTicks: on ? 'on' : 'off' }),
    )
    const kitchens = vi.spyOn(adapters.kitchen, 'readManagerDishMarks')
    render(
      <ChangeGatesForTest on={{ 'dish-ticks': on, 'kitchen-ready': on }}>
        <MemoryRouter>
          <SessionContext.Provider value={managerSession()}>
            <AdaptersContext.Provider value={adapters}>
              <ManagerBillingHistory />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>
      </ChangeGatesForTest>,
    )
    await user.click(await screen.findByRole('tab', { name: /Open orders/ }))
    const card = screen.getByTestId('manager-open-order-104')
    if (on) {
      expect(kitchens).toHaveBeenCalledOnce()
      expect(within(card).getByTestId('manager-dish-order-104')).toBeInTheDocument()
      expect(within(card).queryByText('Order items')).toBeNull()
      await user.click(within(card).getByRole('button', { name: 'Cancel order 104' }))
    } else {
      expect(kitchens).not.toHaveBeenCalled()
      expect(card).toHaveTextContent('Order items')
      expect(card).toHaveTextContent('Customer details')
      await user.click(within(card).getByRole('button', { name: 'Cancel this order' }))
    }
    expect(screen.getByRole('dialog', { name: 'Cancel order 104' })).toBeVisible()
  })
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
    <ChangeGatesForTest on={{ 'dish-ticks': true, 'kitchen-ready': true }}>
      <DishOpenOrderSummary
        order={order}
        marks={marks}
        now={new Date('2026-10-14T10:21:00.000Z')}
      />
    </ChangeGatesForTest>,
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

it('reads nothing as Done while kitchen-ready is off', () => {
  render(
    <ChangeGatesForTest on={{ 'dish-ticks': true, 'kitchen-ready': false }}>
      <DishOpenOrderSummary order={order} marks={marks} now={new Date()} />
    </ChangeGatesForTest>,
  )
  expect(stateOf('Dish done')).toBe('placed')
  expect(screen.getByText('Kitchen 1 · seen')).toBeInTheDocument()
})
