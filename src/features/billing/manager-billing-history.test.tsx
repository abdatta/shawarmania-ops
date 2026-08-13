import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'

import { ManagerBillingHistory } from './manager-billing-history'

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

describe('manager billing history status', () => {
  it('puts Cash and UPI aggregates before sync activity in one Status view', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')

    render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession()}>
          <AdaptersContext.Provider value={adapters}>
            <ManagerBillingHistory />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    const statusTab = await screen.findByRole('tab', { name: 'Status' })
    expect(screen.queryByRole('heading', { name: 'Payment totals' })).not.toBeInTheDocument()

    await user.click(statusTab)

    const paymentTotals = screen.getByRole('heading', { name: 'Payment totals' })
    expect(paymentTotals).toBeVisible()
    expect(within(screen.getByTestId('billing-total-cash')).getByText('Cash')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-cash')).getByText('₹3,711')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-upi')).getByText('UPI')).toBeVisible()
    const syncStatus = screen.getByRole('heading', { name: 'Tablet sync status' })
    expect(syncStatus).toBeVisible()
    expect(
      paymentTotals.compareDocumentPosition(syncStatus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(screen.getByTestId('billing-total-upi')).getByText('₹1,772')).toBeVisible()
    expect(screen.queryByText('Bills rung')).not.toBeInTheDocument()
    expect(screen.queryByText('Drawer cash')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-bill-list')).not.toBeInTheDocument()
  })
})
