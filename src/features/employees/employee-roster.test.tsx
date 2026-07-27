import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { EmployeeRoster } from './employee-roster'

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  role: 'franchise_admin',
  outletId: OUTLET_KALYANI_ID,
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderRoster(adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <EmployeeRoster />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the employee roster', () => {
  it('lists this outlet’s people and nobody else’s', async () => {
    renderRoster()

    expect(await screen.findByText('Demo Griller')).toBeInTheDocument()
    expect(screen.queryByText('Demo Kanchrapara Staff')).not.toBeInTheDocument()
  })

  it('shows employment status, including people who have left', async () => {
    renderRoster()

    await screen.findByText('Demo Griller')
    expect(screen.getByText('Left')).toBeInTheDocument()
  })

  it('adds someone to the list', async () => {
    const user = userEvent.setup()
    renderRoster()

    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo New Starter')
    await user.type(screen.getByLabelText('Staff code'), 'KAL-09')
    await user.type(screen.getByLabelText('Role (optional)'), 'Prep')
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByText('Demo New Starter')).toBeInTheDocument()
  })

  it('refuses a staff code already used at this outlet', async () => {
    const user = userEvent.setup()
    renderRoster()

    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Clash')
    await user.type(screen.getByLabelText('Staff code'), 'KAL-02')
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByTestId('roster-error')).toHaveTextContent('already used')
  })

  it('edits someone without letting their staff code move', async () => {
    const user = userEvent.setup()
    renderRoster()

    await screen.findByText('Demo Griller')
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)

    // A staff code identifies past attendance records; letting it change would
    // silently re-point history at a different person.
    expect(screen.getByLabelText('Staff code')).toBeDisabled()

    const name = screen.getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Demo Renamed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Demo Renamed')).toBeInTheDocument()
  })

  it('ends and reinstates employment', async () => {
    const user = userEvent.setup()
    renderRoster()

    await screen.findByText('Demo Griller')
    expect(screen.getAllByText('Active').length).toBe(3)

    await user.click(screen.getAllByRole('button', { name: 'Mark left' })[0]!)
    await waitFor(() => expect(screen.getAllByText('Active').length).toBe(2))

    await user.click(screen.getAllByRole('button', { name: 'Reinstate' })[0]!)
    await waitFor(() => expect(screen.getAllByText('Active').length).toBe(3))
  })
})
