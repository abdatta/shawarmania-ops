import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { EmployeeRoster } from './employee-roster'

/** The Kalyani account deliberately left unlinked in the demo fixtures. */
const DEMO_GRILLER_ACCOUNT = 'd1000000-0000-4000-a000-000000000006'

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

  it('refuses to add somebody with no staff code', async () => {
    const user = userEvent.setup()
    const { adapters } = renderRoster()
    const create = vi.spyOn(adapters.employees, 'createEmployee')

    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Nameless')
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByTestId('roster-error')).toHaveTextContent('A staff code is needed')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses to add somebody with no name', async () => {
    // A roster row is a person. `required` on the input is inert — this form
    // carries `noValidate` like every other form in the app — so the guard is
    // what refuses, and `employees_full_name_not_blank` refuses the write.
    const user = userEvent.setup()
    const { adapters } = renderRoster()
    const create = vi.spyOn(adapters.employees, 'createEmployee')

    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Staff code'), 'KAL-09')
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByTestId('roster-error')).toHaveTextContent('needs a name')
    expect(create).not.toHaveBeenCalled()
  })

  it('treats a name of only spaces as no name at all', async () => {
    const user = userEvent.setup()
    const { adapters } = renderRoster()
    const create = vi.spyOn(adapters.employees, 'createEmployee')

    await user.click(await screen.findByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), '   ')
    await user.type(screen.getByLabelText('Staff code'), 'KAL-09')
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByTestId('roster-error')).toHaveTextContent('needs a name')
    expect(create).not.toHaveBeenCalled()
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

  it('refuses a name cleared while editing, not only one never typed', async () => {
    // One component serves add and edit both, so a create-only guard would
    // leave this way in wide open. The database refuses it either way.
    const user = userEvent.setup()
    const { adapters } = renderRoster()
    const update = vi.spyOn(adapters.employees, 'updateEmployee')

    await screen.findByText('Demo Griller')
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    await user.clear(screen.getByLabelText('Full name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByTestId('roster-error')).toHaveTextContent('needs a name')
    expect(update).not.toHaveBeenCalled()
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

/**
 * The link, and the question it answers. "Why can this person not check in?"
 * gets asked on a phone call mid-shift; if the answer needs a database, the
 * screen has failed.
 */
describe('the account behind a person on the roster', () => {
  it('says plainly who can and cannot check in', async () => {
    renderRoster()

    // Linked, active — the working case, named rather than merely ticked.
    expect(await screen.findByTestId('linked-KAL-01')).toHaveTextContent('Demo Staff')
    // On the payroll with no login at all.
    expect(screen.getByTestId('unlinked-KAL-03')).toHaveTextContent(
      'No app account — cannot check in from a phone',
    )
  })

  it('offers the unlinked accounts at this outlet, and only those', async () => {
    const user = userEvent.setup()
    renderRoster()

    await screen.findByText('Demo Griller')
    await user.click(screen.getByRole('button', { name: 'Add person' }))

    const options = within(screen.getByLabelText('App account')).getAllByRole('option')
    const labels = options.map((option) => option.textContent)
    expect(labels).toContain('Demo Griller')
    // Already linked to Demo Staff's roster row.
    expect(labels).not.toContain('Demo Staff')
    // A Kanchrapara manager, at the wrong outlet entirely.
    expect(labels).not.toContain('Demo Manager (Kanchrapara)')
    // Deactivated, so linking them would produce a person who still cannot
    // sign in — a link that looks finished and is not.
    expect(labels).not.toContain('Demo Former Staff')
  })

  it('links an existing account to an existing person', async () => {
    const user = userEvent.setup()
    renderRoster()

    await screen.findByTestId('unlinked-KAL-02')
    const row = screen.getByTestId('unlinked-KAL-02').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    await user.selectOptions(screen.getByLabelText('App account'), ['Demo Griller'])
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByTestId('linked-KAL-02')).toHaveTextContent('Demo Griller')
  })

  it('adds a person and links them in one go', async () => {
    const user = userEvent.setup()
    renderRoster()

    await screen.findByText('Demo Griller')
    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Staff code'), 'KAL-11')
    await user.selectOptions(screen.getByLabelText('App account'), ['Demo Griller'])
    await user.click(screen.getByRole('button', { name: 'Add to the list' }))

    expect(await screen.findByTestId('linked-KAL-11')).toHaveTextContent('Demo Griller')
  })

  it('says what unlinking costs before it happens, and keeps the worked days', async () => {
    const user = userEvent.setup()
    const { adapters } = renderRoster()
    const unlink = vi.spyOn(adapters.employees, 'unlinkAccount')

    await screen.findByTestId('linked-KAL-01')
    const row = screen.getByTestId('linked-KAL-01').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Unlink' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('stops being able to check in')
    expect(dialog).toHaveTextContent('stays on the staff list, because those days were worked')

    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(unlink).toHaveBeenCalled())
    expect(await screen.findByTestId('unlinked-KAL-01')).toBeInTheDocument()
  })

  it('offers no unlink where there is no link', async () => {
    renderRoster()

    const row = (await screen.findByTestId('unlinked-KAL-03')).closest('tr')!
    expect(within(row).queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
  })

  it('stops offering an account once somebody has it', async () => {
    const user = userEvent.setup()
    renderRoster()

    // Link it to the griller's roster row…
    const row = (await screen.findByTestId('unlinked-KAL-02')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('App account'), ['Demo Griller'])
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByTestId('linked-KAL-02')

    // …and it is no longer on offer to anyone else. One login, one person, or
    // every attendance record becomes ambiguous about who actually stood there.
    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const labels = within(screen.getByLabelText('App account'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(labels).not.toContain('Demo Griller')
  })

  it('refuses a second claim on one account even if the form is bypassed', async () => {
    const { adapters } = renderRoster()

    await screen.findByText('Demo Griller')
    await adapters.employees.linkAccount(
      'd2000000-0000-4000-a000-000000000002',
      DEMO_GRILLER_ACCOUNT,
    )

    await expect(
      adapters.employees.createEmployee({
        outletId: OUTLET_KALYANI_ID,
        employeeCode: 'KAL-13',
        fullName: 'Demo Impostor',
        profileId: DEMO_GRILLER_ACCOUNT,
      }),
    ).rejects.toThrow(/already on the roster/)
  })
})

/**
 * The Super Admin is outlet-less by constraint, so this screen has to ask which
 * outlet before it can show anything. Without it the one person who can create
 * an outlet could not then staff it.
 */
describe('the roster as the owner sees it', () => {
  function renderAsOwner(adapters: DataAdapters = createMockAdapters()) {
    const ownerSession: Session = {
      mode: 'demo',
      userId: personaFixtures.super_admin.profile.id,
      role: 'super_admin',
      outletId: null,
      displayName: personaFixtures.super_admin.profile.full_name,
      persona: personaFixtures.super_admin,
    }
    return {
      adapters,
      ...render(
        <MemoryRouter>
          <SessionContext.Provider value={ownerSession}>
            <AdaptersContext.Provider value={adapters}>
              <EmployeeRoster />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>,
      ),
    }
  }

  it('picks an outlet instead of refusing to render', async () => {
    renderAsOwner()

    expect(await screen.findByLabelText('Outlet')).toBeInTheDocument()
    expect(await screen.findByText('Demo Griller')).toBeInTheDocument()
  })

  it('switches the roster with the outlet', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    await screen.findByText('Demo Griller')
    await user.selectOptions(screen.getByLabelText('Outlet'), ['Shawarmania Kanchrapara'])

    expect(await screen.findByText('Demo Kanchrapara Staff')).toBeInTheDocument()
    expect(screen.queryByText('Demo Griller')).not.toBeInTheDocument()
  })

  it('sends the owner to Outlets when no outlet exists at all', async () => {
    const adapters = createMockAdapters()
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([])

    renderAsOwner(adapters)

    expect(await screen.findByText(/No outlet exists yet/)).toBeInTheDocument()
  })
})
