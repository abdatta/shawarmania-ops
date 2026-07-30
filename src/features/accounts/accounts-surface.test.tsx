import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { DataAdapters } from '@/data-access/adapters'
import {
  createMockAdapters,
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_HELPER_ACCOUNT_ID,
  DEMO_RETURNER_ACCOUNT_ID,
  DEMO_SPLIT_SHIFT_ACCOUNT_ID,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
  PENDING_ACCOUNT_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { AccountsSurface } from './accounts-surface'

/**
 * People is one component seen through two authorities — the owner across all
 * outlets, a Franchise Admin their own. What is asserted here is that the
 * *form* never offers a Franchise Admin something the server would refuse —
 * the server refusing it anyway is proved in the REST suite.
 *
 * Staff exist only as accounts: creating a person is one act, the staff facts
 * live on the row, and there is no roster choice and no linking step.
 */

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

/** Row actions live behind a kebab menu now, so a test has to open it first. */
async function openRowActions(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: /^Actions for /i }))
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

describe('the People surface', () => {
  it('is People for both authorities — the scope differs, not the name', async () => {
    const { unmount } = renderSurface('super_admin')
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getByText(/across all outlets/)).toBeInTheDocument()
    unmount()

    renderSurface('franchise_admin')
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getByText(/This outlet’s people/)).toBeInTheDocument()
  })

  it('names where each person works, and as what', async () => {
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    const assignments = within(row).getByTestId(`assignments-${DEMO_GRILLER_ACCOUNT_ID}`)
    expect(assignments).toHaveTextContent('Shawarmania Kalyani')
    expect(assignments).toHaveTextContent('Staff')
  })

  it('shows both outlets for somebody who works at both', async () => {
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Split Shift')).closest('tr')!
    const assignments = within(row).getByTestId(`assignments-${DEMO_SPLIT_SHIFT_ACCOUNT_ID}`)
    expect(assignments).toHaveTextContent('Shawarmania Kalyani')
    expect(assignments).toHaveTextContent('Shawarmania Kanchrapara')
  })

  it('shows the job title beside the name', async () => {
    renderSurface('franchise_admin')

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    expect(within(row).getByText('Grill')).toBeInTheDocument()
  })

  it('offers a Franchise Admin no role beyond Biller and Employee', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const roles = within(screen.getByLabelText('Role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Biller', 'Staff'])
  })

  it('pins a Franchise Admin to their own outlet', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const outlet = screen.getByLabelText('Outlet') as HTMLSelectElement
    expect(outlet).toBeDisabled()
    expect(outlet.value).toBe(OUTLET_KALYANI_ID)
    // Not merely disabled — the other outlet is not even in the list.
    expect(within(outlet).getAllByRole('option')).toHaveLength(2) // placeholder + own outlet
  })

  it('offers only management outlets when the caller also works elsewhere in another role', async () => {
    const user = userEvent.setup()
    const base = sessionFor('franchise_admin')
    const assignments = [
      ...base.assignments,
      {
        id: 'da000000-0000-4000-a000-000000000099',
        role: 'employee' as const,
        outletId: OUTLET_KANCHRAPARA_ID,
        startedOn: '2026-07-01',
        endedOn: null,
      },
    ]
    const mixedSession: Session = {
      ...base,
      assignments,
      ...deriveSessionScope(assignments),
    }
    renderSurface('franchise_admin', createMockAdapters('franchise_admin'), mixedSession)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const outlet = screen.getByLabelText('Outlet') as HTMLSelectElement
    expect(outlet).toBeDisabled()
    expect(outlet.value).toBe(OUTLET_KALYANI_ID)
    expect(within(outlet).queryByText('Shawarmania Kanchrapara')).not.toBeInTheDocument()
    expect(screen.queryByTestId('account-outlet-options')).not.toBeInTheDocument()
  })

  it('lets the owner choose any role, and drops the outlet for an owner account', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const roles = within(screen.getByLabelText('Role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Owner', 'Admin', 'Biller', 'Staff'])

    // A Super Admin is outlet-less by schema constraint, so the field goes away
    // rather than offering a choice the database would reject.
    await user.selectOptions(screen.getByLabelText('Role'), 'super_admin')
    expect(screen.queryByLabelText('Outlet')).not.toBeInTheDocument()
  })

  it('asks for the staff facts where the person is staff, and not where they are a device', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    expect(screen.getByLabelText('Job title (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Joined on (optional)')).toBeInTheDocument()
    // And never a staff code: the database issues it.
    expect(screen.queryByLabelText(/Staff code/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Role'), 'biller')
    expect(screen.queryByLabelText('Job title (optional)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Joined on (optional)')).not.toBeInTheDocument()
  })

  it('creates a person in one act, staff facts and all', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Username'), 'newcomer')
    await user.type(screen.getByLabelText('Job title (optional)'), 'Grill')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Demo Newcomer',
          username: 'newcomer',
          role: 'employee',
          outletIds: [OUTLET_KALYANI_ID],
          roleTitle: 'Grill',
        }),
      ),
    )
    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()

    // One act: the person is on the list at once, already placed at an outlet —
    // no second surface, no linking step, nothing left to finish.
    const row = (await screen.findByText('Demo Newcomer')).closest('tr')!
    expect(within(row).getByText('Shawarmania Kalyani')).toBeInTheDocument()
  })

  it('creates one person at two outlets and issues one code after both placements', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('super_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    expect(
      screen.getByText('Choose one or more. They will have the same role at each.'),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Full name'), 'Demo Two Outlets')
    await user.type(screen.getByLabelText('Username'), 'two.outlets')
    await user.click(screen.getByRole('checkbox', { name: 'Shawarmania Kalyani' }))
    await user.click(screen.getByRole('checkbox', { name: 'Shawarmania Kanchrapara' }))
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Demo Two Outlets',
          username: 'two.outlets',
          role: 'employee',
          outletIds: [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID],
        }),
      ),
    )
    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()

    const row = (await screen.findByText('Demo Two Outlets')).closest('tr')!
    const assignments = within(row).getByTestId(/assignments-/)
    expect(assignments).toHaveTextContent('Shawarmania Kalyani')
    expect(assignments).toHaveTextContent('Shawarmania Kanchrapara')
  })

  it('refuses an outlet-scoped owner hire until at least one outlet is selected', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('super_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Nowhere')
    await user.type(screen.getByLabelText('Username'), 'nowhere')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(
      await screen.findAllByText('Choose at least one outlet for this person.'),
    ).not.toHaveLength(0)
    expect(provision).not.toHaveBeenCalled()
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('shows a newly issued code once, and says it cannot be looked up again', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'New Starter')
    await user.type(screen.getByLabelText('Username'), 'new.starter')
    await user.click(screen.getByRole('checkbox', { name: 'Shawarmania Kalyani' }))
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    expect(within(panel).getByTestId('issued-code-link')).toHaveTextContent(
      /\/activate\?code=[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/,
    )
    expect(panel).toHaveTextContent('Shown once')

    // Dismissing it is final: nothing puts it back.
    await user.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('offers the link and nothing else to hand over', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'New Starter')
    await user.type(screen.getByLabelText('Username'), 'new.starter')
    await user.click(screen.getByRole('checkbox', { name: 'Shawarmania Kalyani' }))
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    const link = within(panel).getByTestId('issued-code-link').textContent!
    const code = new URL(link).searchParams.get('code')!

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    // The username is on the panel for the admin to check, but the activation
    // URL carries only the one-time code.
    expect(link).not.toContain('@')
    expect(
      within(panel).getByRole('img', { name: /Activation link for New Starter/ }),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()

    // One handover, not a choice between three. The code exists inside the URL
    // and is deliberately not printed beside it as a second thing to send.
    expect(within(panel).queryByTestId('issued-code-value')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument()
    expect(within(panel).queryByText(code)).not.toBeInTheDocument()
  })

  it('writes nothing at all when the name is missing', async () => {
    // `required` on the input is inert: this form carries `noValidate`, like
    // every other form in the app. The guard refuses, and
    // `profiles_full_name_not_blank` refuses the write.
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Username'), 'nameless')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('needs a name')
    expect(provision).not.toHaveBeenCalled()
    // No code is issued for an account that was never created. An admin left
    // holding a code for nobody is the failure this ordering exists to avoid.
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('treats a name of only spaces as no name at all', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), '   ')
    await user.type(screen.getByLabelText('Username'), 'spaces')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('needs a name')
    expect(provision).not.toHaveBeenCalled()
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('writes nothing at all when the username is missing', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const provision = vi.spyOn(adapters.accounts, 'provision')
    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Unreachable')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('Enter a username')
    expect(provision).not.toHaveBeenCalled()
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('says nothing about failed activations on a quiet day', async () => {
    renderSurface('super_admin')
    await screen.findByRole('heading', { name: 'People' })
    expect(screen.queryByTestId('activation-pressure')).not.toBeInTheDocument()
  })

  it('tells the owner when somebody is working through codes', async () => {
    const adapters = createMockAdapters()
    vi.spyOn(adapters.accounts, 'failedActivations').mockResolvedValue(47)

    renderSurface('super_admin', adapters)
    expect(await screen.findByTestId('activation-pressure')).toHaveTextContent(
      '47 failed activation attempts',
    )
  })

  it('never even asks on a manager’s behalf, since the answer is always a refusal', async () => {
    const adapters = createMockAdapters('franchise_admin')
    const asked = vi.spyOn(adapters.accounts, 'failedActivations').mockResolvedValue(47)

    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    // Mocked high on purpose: if the request were made, the banner would show.
    // The database refuses this role, so making it would only leave a standing
    // 403 on every load of this screen.
    expect(asked).not.toHaveBeenCalled()
    expect(screen.queryByTestId('activation-pressure')).not.toBeInTheDocument()
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
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('stops being able to read or write anything immediately')
    // Deactivation is not departure, and the confirmation says so.
    expect(dialog).toHaveTextContent('They stay on the staff list')
    expect(setActive).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(setActive).toHaveBeenCalledWith(personaFixtures.franchise_admin.profile.id, false)

    // Scoped to the row that changed: another fixture is deactivated already,
    // and a page-wide match would pass even if the wrong person were hit.
    await waitFor(() => {
      const updated = screen.getByText('Demo Manager').closest('tr')!
      expect(within(updated).getByText('Deactivated')).toBeInTheDocument()
    })
    const updated = screen.getByText('Demo Manager').closest('tr')!
    await openRowActions(user, updated)
    expect(within(updated).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
  })

  it('surfaces a refusal instead of failing silently', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    vi.spyOn(adapters.accounts, 'reissue').mockRejectedValue(new Error('nope'))
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'New code' }))

    expect(await screen.findByTestId('accounts-error')).toBeInTheDocument()
  })
})

/**
 * The people states an admin has to recognise and repair, each stating its
 * own reason and next step on the list itself.
 */
describe('the people states', () => {
  it('shows private account email on the Super Admin fixture only', async () => {
    renderSurface('super_admin')

    const owner = (await screen.findByText('Demo Owner')).closest('tr')!
    const ordinary = screen.getByText('Demo Helper').closest('tr')!

    expect(within(owner).getByText('Email: owner.account@example.com')).toBeInTheDocument()
    expect(within(ordinary).queryByText(/^Email:/)).not.toBeInTheDocument()
  })

  it('shows an ordinary account username and allows an admin to reset its password', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    const row = (await screen.findByText('Demo Helper')).closest('tr')!
    expect(within(row).getByTestId(`username-${DEMO_HELPER_ACCOUNT_ID}`)).toHaveTextContent(
      'demo.helper',
    )
    await openRowActions(user, row)
    expect(within(row).getByRole('button', { name: 'New code' })).toBeEnabled()
    expect(within(row).getByRole('button', { name: 'Change username' })).toBeEnabled()
  })

  it('keeps people with no live assignment off the list until asked', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    await screen.findByText('Demo Griller')
    expect(screen.queryByText('Demo Former Staff')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('toggle-departed'))
    const row = (await screen.findByText('Demo Former Staff')).closest('tr')!
    expect(within(row).getByText('Not assigned to any outlet')).toBeInTheDocument()
  })

  it('keeps somebody who left ONE outlet on the list, because they still work', async () => {
    renderSurface('super_admin')

    // Their Kanchrapara assignment ended in the spring; Kalyani did not.
    // Leaving an outlet is not leaving the business, and the list says so by
    // simply still having them on it.
    const row = (await screen.findByText('Demo Returner')).closest('tr')!
    expect(within(row).queryByText('Not assigned to any outlet')).not.toBeInTheDocument()
    expect(within(row).getByTestId(`assignments-${DEMO_RETURNER_ACCOUNT_ID}`)).toHaveTextContent(
      'Shawarmania Kalyani',
    )
  })

  it('shows the invite still outstanding, and the deactivated person still present', async () => {
    renderSurface('franchise_admin')

    const pending = (await screen.findByText('Demo New Starter')).closest('tr')!
    expect(within(pending).getByText('Awaiting activation')).toBeInTheDocument()

    // Access cut, not departed: still on the list — the panic button does not
    // erase a person.
    const cut = (await screen.findByText('Demo Prep Cook')).closest('tr')!
    expect(within(cut).getByText('Deactivated')).toBeInTheDocument()
  })
})

/**
 * The staff facts are the admin's own RLS write; the departure flow sets the
 * two independent facts in one confirmation.
 */
describe('editing a person', () => {
  it('renames and retitles through the staff-facts sheet', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const update = vi.spyOn(adapters.accounts, 'updateStaffFacts')
    renderSurface('franchise_admin', adapters)

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Edit person' }))

    const name = screen.getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Demo Griller Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ fullName: 'Demo Griller Renamed' }),
      ),
    )
    expect(await screen.findByText('Demo Griller Renamed')).toBeInTheDocument()
  })

  it('assigns somebody to a second outlet, keeping everything they had', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    const grant = vi.spyOn(adapters.accounts, 'grantAssignment')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Assign to an outlet' }))

    // Only outlets they do not already work at are offered — assigning
    // somebody where they already are is not a thing to offer.
    const outlets = within(screen.getByLabelText('Outlet'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(outlets).toEqual(['Shawarmania Kanchrapara'])

    await user.click(screen.getByRole('button', { name: 'Assign' }))

    await waitFor(() =>
      expect(grant).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'employee', outletId: OUTLET_KANCHRAPARA_ID }),
      ),
    )

    // Both outlets now, and the first one untouched.
    const updated = (await screen.findByText('Demo Griller')).closest('tr')!
    const assignments = within(updated).getByTestId(`assignments-${DEMO_GRILLER_ACCOUNT_ID}`)
    await waitFor(() => expect(assignments).toHaveTextContent('Shawarmania Kanchrapara'))
    expect(assignments).toHaveTextContent('Shawarmania Kalyani')
  })

  it('replaces and shows a pending activation link when granting an assignment', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo New Starter')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Assign to an outlet' }))

    expect(screen.getByTestId('assign-reissues-code')).toHaveTextContent(
      'Saving replaces it and shows you the new link',
    )
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    const panel = await screen.findByTestId('issued-code')
    expect(panel).toHaveTextContent('Activation link for Demo New Starter')
    expect(within(panel).getByTestId('issued-code-link')).toHaveTextContent(
      /\/activate\?code=[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/,
    )

    const account = (await adapters.accounts.listAccounts()).find(
      (candidate) => candidate.id === PENDING_ACCOUNT_ID,
    )!
    expect(account.assignments.filter((assignment) => assignment.endedOn === null)).toHaveLength(2)
    expect(account.invite).not.toBeNull()
  })

  it('offers a Franchise Admin no role beyond Biller and Employee when assigning', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Assign to an outlet' }))

    const roles = within(screen.getByLabelText('Role there'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(roles).toEqual(['Biller', 'Staff'])
  })

  it('ends one assignment and offers the access cut, because it was their last', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const end = vi.spyOn(adapters.accounts, 'endAssignment')
    const setActive = vi.spyOn(adapters.accounts, 'setActive')
    renderSurface('franchise_admin', adapters)

    const row = (await screen.findByText('Demo Griller')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'End an assignment' }))

    expect(await screen.findByText(/is leaving/)).toBeInTheDocument()
    expect(screen.getByText(/Every day they worked stays on the record/)).toBeInTheDocument()
    // The access cut is offered and pre-selected, not silently bundled — and
    // only because this is the last place they work.
    expect(screen.getByLabelText(/also deactivate their sign-in/i)).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'End this assignment' }))

    await waitFor(() => expect(end).toHaveBeenCalledWith(expect.any(String)))
    expect(setActive).toHaveBeenCalledWith(expect.any(String), false)

    await waitFor(() => expect(screen.queryByText('Demo Griller')).not.toBeInTheDocument())
  })

  it('replaces and shows a pending link after ending, and names deactivation', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo New Starter')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'End an assignment' }))

    expect(screen.getByTestId('end-reissues-code')).toHaveTextContent(
      'Saving replaces it and shows you the new link',
    )
    expect(screen.getByText(/new link will work only after you reactivate it/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'End this assignment' }))

    const panel = await screen.findByTestId('issued-code')
    expect(panel).toHaveTextContent('Activation link for Demo New Starter')
    expect(within(panel).getByTestId('issued-code-inactive')).toHaveTextContent(
      'Reactivate it before this link is used',
    )
  })

  it('leaves the sign-in alone when the person still works somewhere else', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    const setActive = vi.spyOn(adapters.accounts, 'setActive')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Split Shift')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'End an assignment' }))

    // Two live assignments, so there is a choice to make and no deactivation
    // to offer: cutting sign-in for somebody still working the other outlet
    // would be the panic button wearing a departure's clothes.
    expect(await screen.findByTestId('still-works-elsewhere')).toBeInTheDocument()
    expect(screen.queryByLabelText(/also deactivate/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'End this assignment' }))

    // Still on the list, still signed-in-able, still working the other outlet.
    const updated = (await screen.findByText('Demo Split Shift')).closest('tr')!
    await waitFor(() =>
      expect(within(updated).queryByText('Not assigned to any outlet')).not.toBeInTheDocument(),
    )
    expect(setActive).not.toHaveBeenCalled()
  })

  it('refuses a manager assigning themselves, exactly as the database does', async () => {
    const adapters = createMockAdapters('franchise_admin')
    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'People' })

    // The surface offers no row actions on your own row at all, so this is the
    // adapter refusing the write the way the policy would.
    await expect(
      adapters.accounts.grantAssignment({
        personId: personaFixtures.franchise_admin.profile.id,
        role: 'employee',
        outletId: OUTLET_KANCHRAPARA_ID,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('the username an account signs in with', () => {
  it('is on the list, so a typo is visible at all', async () => {
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    expect(within(row).getByText('demo.manager')).toBeInTheDocument()
  })

  it('is read back beside a freshly issued code', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'People' })

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Username'), 'Demo.Newcomer')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    // Normalised, so what is shown is what will actually be signed in with —
    // echoing the raw typing back would hide a case-only difference.
    expect(within(panel).getByTestId('issued-code-username')).toHaveTextContent('demo.newcomer')
    // The nudge survives canonicalisation: the username is shown to be checked, not
    // merely displayed. It is the last cheap moment to catch a typo.
    expect(panel).toHaveTextContent('check this')
  })

  it('is read back when a code is re-issued, not only at creation', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'New code' }))

    expect(await screen.findByTestId('issued-code-username')).toHaveTextContent('demo.manager')
  })

  it('can be corrected, and says the existing code still works', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const change = vi.spyOn(adapters.accounts, 'changeUsername')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Change username' }))

    const field = screen.getByLabelText('Username')
    expect(field).toHaveValue('demo.manager')
    expect(screen.getByText(/still works/)).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'demo.manager.corrected')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(
        personaFixtures.franchise_admin.profile.id,
        'demo.manager.corrected',
      ),
    )
    expect(await screen.findByText('demo.manager.corrected')).toBeInTheDocument()
  })

  it('refuses a username another account already holds', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Change username' }))

    const field = screen.getByLabelText('Username')
    await user.clear(field)
    await user.type(field, 'demo.griller')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent(
      'That username is already in use',
    )
  })

  it('starts the correction with the account username', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')

    const row = (await screen.findByText('Demo Helper')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Change username' }))

    expect(screen.getByLabelText('Username')).toHaveValue('demo.helper')
  })

  it('renders the list as names when the identifier lookup is refused', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    // What a caller with no authority to read identifiers gets: the privileged
    // function refuses, and the screen is names-only rather than blank.
    vi.spyOn(adapters.accounts, 'listAccounts').mockImplementation(async () =>
      (await createMockAdapters().accounts.listAccounts()).map((account) => ({
        ...account,
        username: null,
      })),
    )
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    expect(within(row).queryByText('demo.manager')).not.toBeInTheDocument()
    await openRowActions(user, row)
    expect(within(row).getByRole('button', { name: 'New code' })).toBeInTheDocument()
  })
})

describe('the person form before any outlet exists', () => {
  it('names the real problem instead of showing an empty dropdown', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([])
    renderSurface('super_admin', adapters)

    await screen.findByRole('heading', { name: 'People' })
    await user.click(screen.getByRole('button', { name: 'Add person' }))

    expect(screen.getByTestId('no-outlets')).toHaveTextContent(
      'every account except an owner has to belong to one',
    )
    expect(screen.queryByRole('combobox', { name: 'Outlet' })).not.toBeInTheDocument()
  })
})
