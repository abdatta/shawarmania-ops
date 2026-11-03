import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { ChangeGateKey } from '@/change-gates/gates'
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
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { AccountsSurface } from './accounts-surface'

/**
 * Team, for a deactivated person leaving in two steps
 * (a-deactivated-person-leaves-in-two-steps): the Deactivated section and the
 * second step (`deactivate-then-leave`, design D4), owner access kept to the
 * database (`owner-access-in-the-database`, design D5), and Edit's outlets
 * drawn only where they mean something (design D6, no gate).
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

function renderTeam(
  role: Role,
  gates: Partial<Record<ChangeGateKey, boolean>> = {},
  prepare?: (data: ReturnType<typeof createDemoData>) => void,
) {
  const data = createDemoData({ accountGates: (key) => gates[key] === true })
  prepare?.(data)
  const adapters = createMockAdapters(role, data)
  render(
    <MemoryRouter>
      <ChangeGatesForTest on={gates}>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>
            <AccountsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
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

describeChangeGate('deactivate-then-leave', (on) => {
  const gates = { 'deactivate-then-leave': on }

  it(
    on
      ? 'lists the deactivated under Deactivated, newest first, and nobody who has left'
      : 'keeps the deactivated in the list and the departed behind Show people who have left',
    async () => {
      const user = userEvent.setup()
      renderTeam('super_admin', gates)
      await rowFor('Demo Helper')

      if (on) {
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
      } else {
        expect(screen.getByText('Demo Weekend Biller')).toBeInTheDocument()
        expect(screen.queryByTestId('toggle-deactivated')).not.toBeInTheDocument()
        expect(screen.getByTestId('toggle-departed')).toHaveTextContent(
          'Show people who have left (1)',
        )
      }
    },
  )

  it(
    on
      ? 'offers a deactivated person Reactivate and Remove'
      : 'offers a deactivated person Reactivate beside the others',
    async () => {
      const user = userEvent.setup()
      renderTeam('franchise_admin', gates)
      await rowFor('Demo Helper')
      if (on) await user.click(screen.getByTestId('toggle-deactivated'))

      const menu = await menuOf(user, await rowFor('Demo Weekend Biller'))
      if (on) expect(menu).toEqual(['Reactivate', 'Remove'])
      else expect(menu).toContain('Reactivate')
    },
  )

  it(on ? 'leaves Mark as left out of Edit' : 'offers Mark as left in Edit', async () => {
    const user = userEvent.setup()
    renderTeam('franchise_admin', gates)
    await openEdit(user, 'Demo Helper')

    const leave = screen.queryByRole('button', { name: 'Mark as left' })
    if (on) expect(leave).not.toBeInTheDocument()
    else expect(leave).toBeInTheDocument()
  })

  it(
    on
      ? 'deactivates into the Deactivated section, dated today'
      : 'deactivates in place, with today’s words',
    async () => {
      const user = userEvent.setup()
      renderTeam('franchise_admin', gates)
      const row = await rowFor('Demo Helper')
      await user.click(await within(row).findByRole('button', { name: /^Actions for /i }))
      await user.click(within(row).getByRole('button', { name: 'Deactivate' }))

      const dialog = await screen.findByRole('dialog')
      if (on) {
        expect(dialog).toHaveTextContent('Deactivate Demo Helper?')
        expect(dialog).toHaveTextContent('They move to Deactivated')
        expect(dialog).not.toHaveTextContent('mark them as left if')
      } else {
        expect(dialog).toHaveTextContent('Deactivate this account?')
        expect(dialog).toHaveTextContent('mark them as left if they no longer work here')
      }
      await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

      if (on) {
        await waitFor(() =>
          expect(screen.getByTestId('toggle-deactivated')).toHaveTextContent(
            'Deactivated · 3 · Hide',
          ),
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
        expect(
          screen.queryByTestId(`deactivated-${DEMO_HELPER_ACCOUNT_ID}`),
        ).not.toBeInTheDocument()
      } else {
        expect(screen.queryByTestId('team-notice')).not.toBeInTheDocument()
        await waitFor(() =>
          expect(
            within(screen.getByText('Demo Helper').closest('tr')!).getByText('Deactivated'),
          ).toBeInTheDocument(),
        )
      }
    },
  )

  if (on) {
    it('removes a deactivated person from Team, naming what is freed', async () => {
      const user = userEvent.setup()
      renderTeam('franchise_admin', gates)
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
  }
})

describeChangeGate('owner-access-in-the-database', (on) => {
  const gates = { 'owner-access-in-the-database': on }
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

  it(
    on ? 'offers no owner role in Add person' : 'offers the owner role in Add person',
    async () => {
      const user = userEvent.setup()
      renderTeam('super_admin', gates)
      await user.click(await screen.findByRole('button', { name: 'Add person' }))

      const roles = within(screen.getByLabelText('Role'))
        .getAllByRole('option')
        .map((option) => option.textContent)
      // The owner role reads Owner on screen.
      if (on) expect(roles).not.toContain('Owner')
      else expect(roles).toContain('Owner')
    },
  )

  it(
    on ? 'draws no Owner access section in Edit' : 'offers Grant owner access in Edit',
    async () => {
      const user = userEvent.setup()
      renderTeam('super_admin', gates)
      await openEdit(user, 'Demo Griller')

      const grant = screen.queryByRole('button', { name: 'Grant owner access' })
      if (on) {
        expect(grant).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Owner access' })).not.toBeInTheDocument()
      } else {
        expect(grant).toBeInTheDocument()
      }
    },
  )

  it(
    on
      ? 'offers an owner’s row no Deactivate, and carries their owner row through Save'
      : 'offers an owner’s row Deactivate',
    async () => {
      const user = userEvent.setup()
      const { adapters } = renderTeam('super_admin', gates, secondOwner)

      const menu = await menuOf(user, await rowFor('Demo Helper'))
      expect(menu).toContain('Edit')
      expect(menu).toContain('Change sign-in email')
      if (!on) {
        expect(menu).toContain('Deactivate')
        return
      }
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
      await waitFor(() =>
        expect(screen.queryByLabelText('Phone (optional)')).not.toBeInTheDocument(),
      )
      const helper = (await adapters.accounts.listAccounts()).find(
        (account) => account.id === DEMO_HELPER_ACCOUNT_ID,
      )!
      expect(helper.phone).toBe('919800000011')
      expect(helper.assignments.some((a) => a.role === 'super_admin' && a.endedOn === null)).toBe(
        true,
      )
    },
  )
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
    renderTeam('super_admin', {}, (data) => {
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
