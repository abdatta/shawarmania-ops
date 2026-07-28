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

/** Row actions live behind a kebab menu now, so a test has to open it first. */
async function openRowActions(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: /^Actions for /i }))
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
    // Provisioning an Employee also answers the staff-list question, and
    // "add them to it" needs a code (outlet-and-staff-setup).
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

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Full name'), 'New Starter')
    await user.type(screen.getByLabelText('Email'), 'new.starter@example.com')
    await user.selectOptions(screen.getByLabelText('Outlet'), OUTLET_KALYANI_ID)
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    const link = within(panel).getByTestId('issued-code-link').textContent!
    const code = new URL(link).searchParams.get('code')!

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    // The address is on the panel for the admin to check, and never in the URL
    // — it would buy nothing and would land in history and link previews.
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
    const adapters = createMockAdapters()
    const asked = vi.spyOn(adapters.accounts, 'failedActivations').mockResolvedValue(47)

    renderSurface('franchise_admin', adapters)
    await screen.findByRole('heading', { name: 'Access' })

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
 * Provisioning an Employee and the staff roster. The account is one write and
 * the roster row is another, made by this session under RLS — so the interesting
 * cases are the choice itself and what happens when only the first one lands.
 */
describe('the staff list, while provisioning', () => {
  async function openEmployeeForm(role: Role, adapters?: DataAdapters) {
    const user = userEvent.setup()
    const rendered = adapters ? renderSurface(role, adapters) : renderSurface(role)
    await screen.findByRole('heading', { name: role === 'super_admin' ? 'People' : 'Access' })
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    if (role === 'super_admin') {
      await user.selectOptions(screen.getByLabelText('Outlet'), OUTLET_KALYANI_ID)
    }
    return { user, ...rendered }
  }

  it('asks about the roster rather than deciding silently', async () => {
    await openEmployeeForm('franchise_admin')

    expect(screen.getByRole('group', { name: 'Staff list' })).toBeInTheDocument()
    expect(screen.getByLabelText('Add them to the staff list')).toBeChecked()
    expect(screen.getByLabelText('Not on the staff list')).toBeInTheDocument()
  })

  it('offers no roster choice for a role that is not an Employee', async () => {
    const { user } = await openEmployeeForm('franchise_admin')

    await user.selectOptions(screen.getByLabelText('Role'), 'biller')
    expect(screen.queryByRole('group', { name: 'Staff list' })).not.toBeInTheDocument()
  })

  it('creates the account and the roster row together', async () => {
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.employees, 'createEmployee')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Email'), 'newcomer@example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Demo Newcomer',
          profileId: expect.any(String),
        }),
      ),
    )
    // The one write still carries no code: the database issues it. Asserting a
    // literal here would be asserting the app's own arithmetic.
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ employeeCode: expect.anything() }),
    )
    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()
  })

  it('never asks for a staff code, and provisions anyway', async () => {
    // This replaces an assertion that provisioning was *refused* without a
    // staff code. The claim it protected — an incomplete answer must not
    // half-configure somebody — is unchanged and still covered by the
    // “link to someone without saying who” test below. What has gone is the
    // question itself: there is no field left to leave unanswered.
    const adapters = createMockAdapters()
    const provision = vi.spyOn(adapters.accounts, 'provision')
    const create = vi.spyOn(adapters.employees, 'createEmployee')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    expect(screen.queryByLabelText('Staff code')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Email'), 'newcomer@example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()
    expect(provision).toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ employeeCode: expect.anything() }),
    )
  })

  it('writes nothing at all when the name is missing', async () => {
    // `required` on the input is inert: this form carries `noValidate`, like
    // every other form in the app. The guard refuses, and
    // `profiles_full_name_not_blank` refuses the write.
    const adapters = createMockAdapters()
    const provision = vi.spyOn(adapters.accounts, 'provision')
    const create = vi.spyOn(adapters.employees, 'createEmployee')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Email'), 'nameless@example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('needs a name')
    expect(provision).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    // No code is issued for an account that was never created. An admin left
    // holding a code for nobody is the failure this ordering exists to avoid.
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('treats a name of only spaces as no name at all', async () => {
    const adapters = createMockAdapters()
    const provision = vi.spyOn(adapters.accounts, 'provision')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), '   ')
    await user.type(screen.getByLabelText('Email'), 'spaces@example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('needs a name')
    expect(provision).not.toHaveBeenCalled()
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('writes nothing at all when the email address is missing', async () => {
    // `type="email"` is inert for exactly the same reason `required` is, and a
    // blank address provisions an account nobody can ever sign in to.
    const adapters = createMockAdapters()
    const provision = vi.spyOn(adapters.accounts, 'provision')
    const create = vi.spyOn(adapters.employees, 'createEmployee')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Unreachable')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('email address is needed')
    expect(provision).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(screen.queryByTestId('issued-code')).not.toBeInTheDocument()
  })

  it('refuses to link without saying to whom', async () => {
    const adapters = createMockAdapters()
    const provision = vi.spyOn(adapters.accounts, 'provision')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Vague')
    await user.type(screen.getByLabelText('Email'), 'vague@example.com')
    await user.click(screen.getByLabelText('They are already on the staff list'))
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('Choose who they already')
    expect(provision).not.toHaveBeenCalled()
  })

  it('links to somebody already on the list instead of inventing a second row', async () => {
    const adapters = createMockAdapters()
    const link = vi.spyOn(adapters.employees, 'linkAccount')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Griller')
    await user.type(screen.getByLabelText('Email'), 'griller@example.com')
    await user.click(screen.getByLabelText('They are already on the staff list'))
    await user.selectOptions(screen.getByLabelText('Person on the staff list'), [
      'Demo Griller · KAL-02',
    ])
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    await waitFor(() => expect(link).toHaveBeenCalled())
  })

  it('writes no roster row when told not to', async () => {
    const adapters = createMockAdapters()
    const create = vi.spyOn(adapters.employees, 'createEmployee')
    const link = vi.spyOn(adapters.employees, 'linkAccount')
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Contractor')
    await user.type(screen.getByLabelText('Email'), 'contractor@example.com')
    await user.click(screen.getByLabelText('Not on the staff list'))
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    await screen.findByTestId('issued-code')
    expect(create).not.toHaveBeenCalled()
    expect(link).not.toHaveBeenCalled()
  })

  it('still hands over the code when only the roster write fails', async () => {
    const adapters = createMockAdapters()
    vi.spyOn(adapters.employees, 'createEmployee').mockRejectedValue(new Error('nope'))
    const { user } = await openEmployeeForm('franchise_admin', adapters)

    await user.type(screen.getByLabelText('Full name'), 'Demo Half Done')
    await user.type(screen.getByLabelText('Email'), 'half.done@example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    // The account exists and the code is valid — saying "that failed" would
    // send an admin off to create a second account for the same person.
    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()
    const error = await screen.findByTestId('accounts-error')
    expect(error).toHaveTextContent('has an account and the code below works')
    expect(error).toHaveTextContent('not on the staff list yet')
    expect(error).toHaveTextContent('Finish it on Staff')
  })

  it('says on the list who cannot check in', async () => {
    renderSurface('franchise_admin')

    // `Demo New Starter` is provisioned and on no roster.
    expect(
      await screen.findByTestId('off-roster-d1000000-0000-4000-a000-000000000008'),
    ).toHaveTextContent('Not on the staff list — cannot check in')
  })
})

/**
 * The address is typed once and, until now, never seen again — and a typo
 * produced an account that refused its own code, refused sign-in, and gave the
 * same uninformative answer either way.
 */
describe('the email address an account signs in with', () => {
  it('is on the list, so a typo is visible at all', async () => {
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    expect(within(row).getByText('demo.manager@example.com')).toBeInTheDocument()
  })

  it('is read back beside a freshly issued code', async () => {
    const user = userEvent.setup()
    renderSurface('franchise_admin')
    await screen.findByRole('heading', { name: 'Access' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Full name'), 'Demo Newcomer')
    await user.type(screen.getByLabelText('Email'), 'Demo.Newcomer@Example.com')
    await user.click(screen.getByRole('button', { name: 'Create and issue a code' }))

    const panel = await screen.findByTestId('issued-code')
    // Normalised, so what is shown is what will actually be signed in with —
    // echoing the raw typing back would hide a case-only difference.
    expect(within(panel).getByTestId('issued-code-email')).toHaveTextContent(
      'demo.newcomer@example.com',
    )
    // The nudge survives the trim: the address is shown to be checked, not
    // merely displayed. It is the last cheap moment to catch a typo.
    expect(panel).toHaveTextContent('check this')
  })

  it('is read back when a code is re-issued, not only at creation', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'New code' }))

    expect(await screen.findByTestId('issued-code-email')).toHaveTextContent(
      'demo.manager@example.com',
    )
  })

  it('can be corrected, and says the existing code still works', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    const change = vi.spyOn(adapters.accounts, 'changeEmail')
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Change email' }))

    const field = screen.getByLabelText('Email')
    expect(field).toHaveValue('demo.manager@example.com')
    expect(screen.getByText(/still works/)).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'demo.manager@corrected.example.com')
    await user.click(screen.getByRole('button', { name: 'Save this address' }))

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(
        personaFixtures.franchise_admin.profile.id,
        'demo.manager@corrected.example.com',
      ),
    )
    expect(await screen.findByText('demo.manager@corrected.example.com')).toBeInTheDocument()
  })

  it('refuses an address another account already holds', async () => {
    const user = userEvent.setup()
    renderSurface('super_admin')

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    await openRowActions(user, row)
    await user.click(within(row).getByRole('button', { name: 'Change email' }))

    const field = screen.getByLabelText('Email')
    await user.clear(field)
    await user.type(field, 'demo.griller@example.com')
    await user.click(screen.getByRole('button', { name: 'Save this address' }))

    expect(await screen.findByTestId('accounts-error')).toHaveTextContent('already has an account')
  })

  it('renders the list as names when the address lookup is refused', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    // What a caller with no authority to read addresses gets: the privileged
    // function refuses, and the screen is names-only rather than blank.
    vi.spyOn(adapters.accounts, 'listAccounts').mockImplementation(async () =>
      (await createMockAdapters().accounts.listAccounts()).map((account) => ({
        ...account,
        email: null,
      })),
    )
    renderSurface('super_admin', adapters)

    const row = (await screen.findByText('Demo Manager')).closest('tr')!
    expect(within(row).queryByText(/@example\.com/)).not.toBeInTheDocument()
    await openRowActions(user, row)
    expect(within(row).getByRole('button', { name: 'New code' })).toBeInTheDocument()
  })
})

describe('the account form before any outlet exists', () => {
  it('names the real problem instead of showing an empty dropdown', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters()
    vi.spyOn(adapters.outlets, 'listOutlets').mockResolvedValue([])
    renderSurface('super_admin', adapters)

    await screen.findByRole('heading', { name: 'People' })
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    expect(screen.getByTestId('no-outlets')).toHaveTextContent(
      'every account except an owner has to belong to one',
    )
    expect(screen.queryByRole('combobox', { name: 'Outlet' })).not.toBeInTheDocument()
  })
})
