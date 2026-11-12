import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { deactivationDay } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import {
  DEMO_DEACTIVATED_BILLER_ACCOUNT_ID,
  DEMO_HELPER_ACCOUNT_ID,
} from '@/data-access/mock/fixtures/accounts'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatBusinessDateShort } from '@/domain'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Role, type Session } from '@/session/session'

import { AccountsSurface } from './accounts-surface'

/**
 * Team, for a deactivated person leaving in two steps
 * (a-deactivated-person-leaves-in-two-steps): the Deactivated section and the
 * second step (design D4), owner access kept to the database (design D5), and
 * Edit's outlets drawn only where they mean something (design D6).
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

function renderTeam(role: Role, prepare?: (data: ReturnType<typeof createDemoData>) => void) {
  const data = createDemoData()
  prepare?.(data)
  const adapters = createMockAdapters(role, data)
  render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <AccountsSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return { adapters, data }
}

async function rowFor(name: string) {
  return (await screen.findByText(name)).closest('tr')!
}

/** The menu's entries, once the row's identity has landed. */
async function menuOf(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
  return within(row)
    .getAllByRole('button')
    .map((button) => button.textContent)
    .filter((label) => label && !/^Actions for /.test(label))
}

async function openEdit(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = await rowFor(name)
  await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
  await user.click(within(row).getByRole('button', { name: 'Edit' }))
}

const kolkataToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

describe('a deactivated person leaves in two steps', () => {
  it('lists the deactivated under Deactivated, newest first, and nobody who has left', async () => {
    const user = userEvent.setup()
    renderTeam('super_admin')
    await rowFor('Demo Helper')

    expect(screen.queryByText('Demo Weekend Biller')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo Former Staff')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toggle-departed')).not.toBeInTheDocument()
    const toggle = screen.getByTestId('toggle-deactivated')
    expect(toggle).toHaveTextContent('Deactivated · 2 · Show')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    const section = screen.getByTestId('deactivated-people')
    const names = within(section)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')
    // Today's deactivation before the one ten days back.
    expect(names[0]).toContain('Demo Prep Cook')
    expect(names[1]).toContain('Demo Weekend Biller')
    await waitFor(() =>
      expect(
        screen.getByTestId(`deactivated-${DEMO_DEACTIVATED_BILLER_ACCOUNT_ID}`),
      ).toHaveTextContent(
        `Deactivated · ${formatBusinessDateShort(
          deactivationDay(
            createDemoData().accounts.find((a) => a.id === DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)!
              .deactivatedAt!,
          ),
        )}`,
      ),
    )
  })

  it('offers a deactivated person Reactivate and Remove', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin')
    await rowFor('Demo Helper')
    await user.click(screen.getByTestId('toggle-deactivated'))

    const menu = await menuOf(user, await rowFor('Demo Weekend Biller'))
    expect(menu).toEqual(['Reactivate', 'Remove'])
  })

  it('leaves Mark as left out of Edit', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin')
    await openEdit(user, 'Demo Helper')

    expect(screen.queryByRole('button', { name: 'Mark as left' })).not.toBeInTheDocument()
  })

  it('deactivates into the Deactivated section, dated today', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin')
    const row = await rowFor('Demo Helper')
    await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Deactivate Demo Helper?')
    expect(dialog).toHaveTextContent('They move to Deactivated')
    expect(dialog).not.toHaveTextContent('mark them as left if')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() =>
      expect(screen.getByTestId('toggle-deactivated')).toHaveTextContent('Deactivated · 3 · Hide'),
    )
    // Said where the thumb is, with the section they moved to already open.
    expect(screen.getByTestId('team-notice')).toHaveTextContent('Demo Helper deactivated')
    expect(screen.getByTestId('toggle-deactivated')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId(`deactivated-${DEMO_HELPER_ACCOUNT_ID}`)).toHaveTextContent(
      `Deactivated · ${formatBusinessDateShort(kolkataToday())}`,
    )

    // Undo puts them back in the main list.
    await user.click(screen.getByTestId('team-notice-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('team-notice')).toHaveTextContent('Demo Helper reactivated'),
    )
    expect(screen.getByTestId('toggle-deactivated')).toHaveTextContent('Deactivated · 2 · Hide')
    expect(screen.queryByTestId(`deactivated-${DEMO_HELPER_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })

  it('removes a deactivated person from Team, naming what is freed', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin')
    await rowFor('Demo Helper')
    await user.click(screen.getByTestId('toggle-deactivated'))
    const row = await rowFor('Demo Weekend Biller')
    await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
    await user.click(within(row).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove Demo Weekend Biller from Team?')
    expect(dialog).toHaveTextContent(
      'Their username demo.weekend.biller and phone number become free for someone else.',
    )
    expect(dialog).toHaveTextContent('Bringing them back means adding them again.')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(dialog).not.toHaveTextContent('Their outlets end')
    expect(await screen.findByTestId('team-notice')).toHaveTextContent(
      'Demo Weekend Biller removed',
    )
    // Removed: off Team for everyone, the manager included.
    await waitFor(() => expect(screen.queryByText('Demo Weekend Biller')).not.toBeInTheDocument())
    expect(screen.getByTestId('toggle-deactivated')).toHaveTextContent('Deactivated · 1 · Hide')
  })
})

describe('a change on its way', () => {
  it('dims the row and says what it is doing until the answer comes', async () => {
    const user = userEvent.setup()
    const { adapters } = renderTeam('franchise_admin')
    // The account function, held open so the moment in between can be read.
    const real = adapters.accounts.setActive.bind(adapters.accounts)
    let answer: () => void = () => undefined
    adapters.accounts.setActive = (id, active) =>
      new Promise<void>((resolve) => {
        answer = () => void real(id, active).then(resolve)
      })

    const row = await rowFor('Demo Helper')
    await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    )

    const working = await screen.findByTestId(`working-${DEMO_HELPER_ACCOUNT_ID}`)
    expect(working).toHaveTextContent('Deactivating…')
    expect(working.closest('tr')).toHaveClass('opacity-60')
    expect(
      within(working.closest('tr')!).queryByRole('button', { name: /^Actions for / }),
    ).not.toBeInTheDocument()

    answer()
    expect(await screen.findByTestId('team-notice')).toHaveTextContent('Demo Helper deactivated')
    expect(screen.queryByTestId(`working-${DEMO_HELPER_ACCOUNT_ID}`)).not.toBeInTheDocument()
  })
})

describe('owner access is the database’s', () => {
  /** Demo Helper, given owner access as well, so the owner has another owner to read. */
  const secondOwner = (data: ReturnType<typeof createDemoData>) => {
    const helper = data.accounts.find((account) => account.id === DEMO_HELPER_ACCOUNT_ID)!
    // Every owner has a private sign-in email.
    helper.accountEmail = 'helper.owner@example.com'
    helper.assignments.push({
      id: 'da000000-0000-4000-a000-0000000000ff',
      role: 'super_admin',
      outletId: null,
      startedOn: '2026-01-01',
      endedOn: null,
    })
  }

  it('offers no owner role in Add person', async () => {
    const user = userEvent.setup()
    renderTeam('super_admin')
    await user.click(await screen.findByRole('button', { name: 'Add person' }))

    const roles = within(screen.getByLabelText('Role'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    // The owner role reads Owner on screen.
    expect(roles).not.toContain('Owner')
  })

  it('draws no Owner access section in Edit', async () => {
    const user = userEvent.setup()
    renderTeam('super_admin')
    await openEdit(user, 'Demo Griller')

    expect(screen.queryByRole('button', { name: 'Grant owner access' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Owner access' })).not.toBeInTheDocument()
  })

  it('offers an owner’s row no Deactivate, and carries their owner row through Save', async () => {
    const user = userEvent.setup()
    const { adapters } = renderTeam('super_admin', secondOwner)

    const menu = await menuOf(user, await rowFor('Demo Helper'))
    expect(menu).toContain('Edit')
    expect(menu).toContain('Change sign-in email')
    expect(menu).not.toContain('Deactivate')
    expect(menu).not.toContain('Reactivate')
    expect(menu).not.toContain('Remove')
    expect(menu).not.toContain('Mark as left')

    // An ordinary edit keeps their owner access exactly as it is.
    const row = await rowFor('Demo Helper')
    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Phone (optional)'))
    await user.type(screen.getByLabelText('Phone (optional)'), '919800000011')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByLabelText('Phone (optional)')).not.toBeInTheDocument())
    const helper = (await adapters.accounts.listAccounts()).find(
      (account) => account.id === DEMO_HELPER_ACCOUNT_ID,
    )!
    expect(helper.phone).toBe('919800000011')
    expect(helper.assignments.some((a) => a.role === 'super_admin' && a.endedOn === null)).toBe(
      true,
    )
  })
})

describe('Edit offers outlets only where they mean something', () => {
  it('shows a one-outlet manager the outlet and role, and nothing to add', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin')
    await openEdit(user, 'Demo Griller')

    expect(screen.getByLabelText('Outlet')).toBeInTheDocument()
    expect(screen.getByLabelText('Access role')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Works at multiple outlets' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add outlet' })).not.toBeInTheDocument()
  })

  it('shows an owner no outlets for another owner, and Save works', async () => {
    const user = userEvent.setup()
    renderTeam('super_admin', (data) => {
      const helper = data.accounts.find((account) => account.id === DEMO_HELPER_ACCOUNT_ID)!
      helper.assignments = [
        {
          id: 'da000000-0000-4000-a000-0000000000fe',
          role: 'super_admin',
          outletId: null,
          startedOn: '2026-01-01',
          endedOn: null,
        },
      ]
    })
    await openEdit(user, 'Demo Helper')

    expect(screen.queryByLabelText('Outlet')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Outlet assignments' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Works at multiple outlets' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add outlet' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('edit-no-assignments')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('still offers the owner Add outlet for a person at one of two outlets', async () => {
    const user = userEvent.setup()
    renderTeam('super_admin')
    await openEdit(user, 'Demo Griller')

    await user.click(screen.getByRole('button', { name: 'Works at multiple outlets' }))
    expect(screen.getByRole('button', { name: 'Add outlet' })).toBeEnabled()
  })
})
