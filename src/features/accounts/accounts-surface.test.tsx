import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { DataAdapters } from '@/data-access/adapters'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'

import { AccountsSurface } from './accounts-surface'

/**
 * People and Access are the same component seen through two different
 * authorities. What is asserted here is that the *form* never offers a
 * Franchise Admin something the server would refuse — the server refusing it
 * anyway is proved in supabase/tests/rest/account-flows.test.ts.
 */

function sessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    role,
    outletId: persona.profile.outlet_id,
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderSurface(role: Role, adapters: DataAdapters = createMockAdapters()) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>
            <AccountsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the account surface', () => {
  it('is People for the owner and Access for a manager', async () => {
    const { unmount } = renderSurface('super_admin')
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    unmount()

    renderSurface('franchise_admin')
    expect(await screen.findByRole('heading', { name: 'Access' })).toBeInTheDocument()
  })

  it('shows the outlet column only where more than one outlet is in scope', async () => {
    const { unmount } = renderSurface('super_admin')
    expect(await screen.findByRole('columnheader', { name: 'Outlet' })).toBeInTheDocument()
    unmount()

    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'Access' })
    expect(screen.queryByRole('columnheader', { name: 'Outlet' })).not.toBeInTheDocument()
  })

  it('offers a Franchise Admin no role beyond Biller and Employee', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'Access' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    const roles = within(screen.getByLabelText('Role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Biller', 'Staff'])
  })

  it('pins a Franchise Admin to their own outlet', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'Access' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    const outlet = screen.getByLabelText('Outlet') as HTMLSelectElement
    expect(outlet).toBeDisabled()
    expect(outlet.value).toBe(OUTLET_KALYANI_ID)
    // Not merely disabled — the other outlet is not even in the list.
    expect(within(outlet).getAllByRole('option')).toHaveLength(2) // placeholder + own outlet
  })

  it('lets the owner choose any role, and drops the outlet for an owner account', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    const roles = within(screen.getByLabelText('Role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Owner', 'Admin', 'Biller', 'Staff'])

    // A Super Admin is outlet-less by schema constraint, so the field goes away
    // rather than offering a choice the database would reject.
    await user.selectOptions(screen.getByLabelText('Role'), 'super_admin')
    expect(screen.queryByLabelText('Outlet')).not.toBeInTheDocument()
  })

  it('shows a newly issued code once, and says it cannot be looked up again', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Full name'), 'New Starter')
    await user.type(screen.getByLabelText('Email'), 'new.starter@example.com')
    await user.selectOptions(screen.getByLabelText('Outlet'), OUTLET_KALYANI_ID)
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    expect(
      within(panel).getByText(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent('shown once and cannot be looked up again')

    // Dismissing it is final: nothing puts it back.
    await user.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('never offers destructive actions on your own row', async () => {
    renderSurface('super_admin')
    const ownName = personaFixtures.super_admin.profile.full_name
    const row = (await screen.findByText(ownName)).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    expect(within(row!).queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()
    expect(row!).toHaveTextContent('(you)')
  })

  it('states the consequence before deactivating, in plain words', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const setActive = vi.spyOn(adapters.accounts, 'setActive')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('stops being able to read or write anything immediately')
    expect(setActive).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(setActive).toHaveBeenCalledWith(personaFixtures.franchise_admin.profile.id, false)

    // Scoped to the row that changed: another fixture is deactivated already,
    // and a page-wide match would pass even if the wrong person were hit.
    await waitFor(() => {
      const updated = screen.getByText('Demo Manager').closest('tr')!
      expect(within(updated).getByText('Deactivated')).toBeInTheDocument()
      expect(within(updated).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    })
  })

  it('surfaces a refusal instead of failing silently', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    vi.spyOn(adapters.accounts, 'reissue').mockRejectedValue(new Error('nope'))
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'New code' }))

    expect(await screen.findByTestId('accounts-error')).toBeInTheDocument()
  })
})
