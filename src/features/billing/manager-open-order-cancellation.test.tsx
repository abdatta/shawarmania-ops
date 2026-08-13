import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'

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

it('uses the same focused reason dialog when cancelling an open order', async () => {
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

  await user.click(await screen.findByRole('tab', { name: /Open orders/ }))
  await user.click(screen.getByRole('button', { name: 'Cancel this order' }))

  const dialog = screen.getByRole('dialog', { name: 'Cancel order 104' })
  expect(dialog).toBeVisible()
  expect(screen.queryByText(/Nothing is transferred to another tablet/)).not.toBeInTheDocument()
  expect(within(dialog).getByRole('group', { name: 'Common cancellation reasons' })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'Cancel order' })).toBeDisabled()

  await user.click(within(dialog).getByRole('button', { name: 'Duplicate order' }))
  expect(within(dialog).getByLabelText('Cancellation reason for order 104')).toHaveValue(
    'Duplicate order',
  )
  expect(within(dialog).getByRole('button', { name: 'Cancel order' })).toBeEnabled()
})
