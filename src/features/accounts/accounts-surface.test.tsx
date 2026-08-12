import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { AccountActionError, type DataAdapters } from '@/data-access/adapters'
import {
  createMockAdapters,
  DEMO_GRILLER_ACCOUNT_ID,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { AccountsSurface } from './accounts-surface'

function sessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderSurface(
  role: Role,
  adapters: DataAdapters = createMockAdapters(role),
  session: Session = sessionFor(role),
) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <AdaptersContext.Provider value={adapters}>
            <AccountsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

async function rowFor(name: string) {
  return (await screen.findByText(name)).closest('tr')!
}

async function openActions(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: /^Actions for /i }))
}

async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = await rowFor(name)
  await openActions(user, row)
  await user.click(within(row).getByRole('button', { name: 'Edit' }))
  return row
}

describe('People task menu and lifecycle', () => {
  it('uses recognizable lifecycle tasks and removes persistence primitives', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    const active = await rowFor('Demo Helper')
    await openActions(user, active)
    expect(within(active).getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(within(active).getByRole('button', { name: 'Replace reset link' })).toBeEnabled()
    expect(within(active).getByRole('button', { name: 'Change username' })).toBeEnabled()
    expect(within(active).queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()
    expect(
      within(active).queryByRole('button', { name: /Assign to an outlet|End an assignment/ }),
    ).not.toBeInTheDocument()

    const pending = await rowFor('Demo New Starter')
    await openActions(user, pending)
    expect(within(pending).getByText('Set-up link issued')).toBeInTheDocument()
    expect(within(pending).getByRole('button', { name: 'Replace set-up link' })).toBeEnabled()
  })

  it('shows a purpose-aware handover from the state-aware action', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    const row = await rowFor('Demo Helper')
    await openActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Replace reset link' }))

    const handover = await screen.findByTestId('account-handover')
    expect(handover).toHaveTextContent('Reset password')
    expect(handover).toHaveTextContent('Using this link replaces the password')
    expect(within(handover).getByRole('img', { name: /Reset password link/i })).toBeInTheDocument()
  })

  it('offers sign-in email only for an owner and only to another owner', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const owner = await rowFor('Demo Owner')
    expect(within(owner).queryByRole('button', { name: /^Actions for /i })).not.toBeInTheDocument()

    const manager = await rowFor('Demo Manager')
    await openActions(user, manager)
    expect(
      within(manager).queryByRole('button', { name: 'Change sign-in email' }),
    ).not.toBeInTheDocument()
  })
})

describe('the responsive assignment-set editor', () => {
  it('keeps a one-outlet person in the compact form until requested', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await openEdit(user, 'Demo Griller')

    expect(screen.getByLabelText('Full name')).toHaveValue('Demo Griller')
    expect(screen.getByLabelText('Phone (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Job title (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Outlet')).toHaveValue(OUTLET_KALYANI_ID)
    expect(screen.getByLabelText('Access role')).toHaveValue('employee')
    expect(screen.getByRole('button', { name: 'Works at multiple outlets' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('Outlet 1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Works at multiple outlets' }))
    expect(screen.getByLabelText('Outlet 1')).toHaveValue(OUTLET_KALYANI_ID)
    expect(screen.getByLabelText('Access role at outlet 1')).toHaveValue('employee')
  })

  it('opens existing multi-outlet people expanded and uses a responsive grid', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await openEdit(user, 'Demo Both Outlets')

    expect(screen.getByRole('heading', { name: 'Works at multiple outlets' })).toBeInTheDocument()
    expect(screen.getByLabelText('Outlet 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Outlet 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Access role')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Outlet 1').closest('fieldset')).toHaveClass('sm:grid-cols-2')
  })

  it('excludes selected outlets from other expanded rows', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await openEdit(user, 'Demo Both Outlets')

    const first = screen.getByLabelText('Outlet 1')
    const second = screen.getByLabelText('Outlet 2')
    expect(within(first).getAllByRole('option')).toHaveLength(1)
    expect(within(second).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add outlet' })).toBeDisabled()
  })

  it('saves a Biller promotion as one intended assignment set and retains the start date', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const edit = vi.spyOn(adapters.accounts, 'editAccount')
    renderSurface('franchise_admin', adapters)
    await openEdit(user, 'Demo Griller')

    await user.selectOptions(screen.getByLabelText('Access role'), 'biller')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: DEMO_GRILLER_ACCOUNT_ID,
          assignments: [
            expect.objectContaining({
              outletId: OUTLET_KALYANI_ID,
              role: 'biller',
              startedOn: expect.any(String),
            }),
          ],
        }),
      ),
    )
    await waitFor(() => {
      const row = screen.getByText('Demo Griller').closest('tr')!
      expect(within(row).getByTestId(`assignments-${DEMO_GRILLER_ACCOUNT_ID}`)).toHaveTextContent(
        'Biller',
      )
      expect(within(row).queryByText('Deactivated')).not.toBeInTheDocument()
    })
  })

  it('transfers a placement through the same atomic editor command', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    const edit = vi.spyOn(adapters.accounts, 'editAccount')
    renderSurface('super_admin', adapters)
    await openEdit(user, 'Demo Griller')

    await user.selectOptions(screen.getByLabelText('Outlet'), OUTLET_KANCHRAPARA_ID)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        expect.objectContaining({
          assignments: [expect.objectContaining({ outletId: OUTLET_KANCHRAPARA_ID })],
        }),
      ),
    )
  })

  it('limits a Franchise Admin to Staff and Biller at managed outlets', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await openEdit(user, 'Demo Griller')

    const roles = within(screen.getByLabelText('Access role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Biller', 'Staff'])
    expect(screen.queryByRole('button', { name: 'Grant owner access' })).not.toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Outlet')).queryByText('Shawarmania Kanchrapara'),
    ).not.toBeInTheDocument()
  })

  it('keeps owner access in a guarded separate subflow with private email', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await openEdit(user, 'Demo Helper')

    await user.click(screen.getByRole('button', { name: 'Grant owner access' }))
    expect(screen.getByRole('heading', { name: 'Owner access' })).toBeInTheDocument()
    expect(screen.getByLabelText('Private sign-in email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByLabelText('Private sign-in email'), 'helper@example.com')
    await user.click(
      screen.getByLabelText('I understand this grants owner access across all outlets.'),
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe('explicit departure and failures', () => {
  it('does not make departure a default Save consequence', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const leave = vi.spyOn(adapters.accounts, 'markAsLeft')
    renderSurface('franchise_admin', adapters)
    await openEdit(user, 'Demo Griller')

    expect(screen.getByRole('button', { name: 'Mark as left' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog', { name: /Edit Demo Griller/ })).queryByRole('checkbox'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(leave).not.toHaveBeenCalled()
  })

  it('requires an explicit destructive confirmation to mark someone as left', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const leave = vi.spyOn(adapters.accounts, 'markAsLeft')
    renderSurface('franchise_admin', adapters)
    await openEdit(user, 'Demo Griller')

    await user.click(screen.getByRole('button', { name: 'Mark as left' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mark this person as left?' })
    expect(dialog).toHaveTextContent('every current outlet assignment')
    expect(leave).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Mark as left' }))

    await waitFor(() =>
      expect(leave).toHaveBeenCalledWith(DEMO_GRILLER_ACCOUNT_ID, expect.any(String)),
    )
  })

  it('keeps a stale edit open and names the need to reload', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    vi.spyOn(adapters.accounts, 'editAccount').mockRejectedValue(
      new AccountActionError('stale_edit', 'This person changed. Reload and try again.'),
    )
    renderSurface('franchise_admin', adapters)
    await openEdit(user, 'Demo Griller')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent('Reload and try again')
    expect(screen.getByRole('dialog', { name: /Edit Demo Griller/ })).toBeInTheDocument()
  })

  it('keeps keyboard operation on native controls and the row action trigger', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    const row = await rowFor('Demo Griller')
    const actions = within(row).getByRole('button', { name: /^Actions for /i })

    await user.click(actions)
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(actions).toHaveFocus()
  })
})
