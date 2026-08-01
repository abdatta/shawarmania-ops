import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { Landing } from '@/routes/landing'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { AccountMenu } from './account-menu'

/**
 * Handing the demo over (design D9): it leaves the public landing card and
 * appears in the Super Admin's account menu as a single **View Demo** entry.
 *
 * The account menu is the first thing in that chrome that is not the same for
 * all four roles, which is why the role assertions here are as specific as they
 * are.
 */

/**
 * A real session, because that is the only kind that has an account menu — a
 * demo shell offers none, there being no session to end.
 */
function sessionFor(role: Role): Session {
  const { profile, assignments } = personaFixtures[role]
  return {
    mode: 'real',
    userId: profile.id,
    assignments,
    ...deriveSessionScope(assignments),
    displayName: profile.full_name,
  }
}

function renderMenu(role: Role) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={createMockAdapters(role)}>
          <AccountMenu onSignOut={() => undefined} />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('the demo’s front door', () => {
  it('is absent from the public landing page', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="/demo"]')).toBeNull()
  })

  it('appears in the Super Admin’s account menu, and targets the demo root', () => {
    renderMenu('super_admin')

    expect(screen.getByTestId('demo-entry')).toBeInTheDocument()
    // `/demo`, not `/demo/owner`. The banner's role switcher is right there,
    // and a recipient should not be pinned to whichever role the owner was
    // looking at when they copied it.
    expect(screen.getByTestId('demo-link')).toHaveAttribute('href', '/demo')
    expect(screen.getByTestId('demo-link')).toHaveTextContent('View Demo')
  })

  it('appears for nobody else', () => {
    for (const role of ['franchise_admin', 'biller', 'employee'] as const) {
      const { unmount } = renderMenu(role)
      expect(screen.queryByTestId('demo-entry')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('offers one entry, the browser handling the sharing of it', () => {
    renderMenu('super_admin')

    // The clipboard may refuse (it does, over plain http on a phone), and a
    // copy button that needs a fallback explaining itself is a lot of menu for
    // something the address bar already does.
    expect(screen.queryByTestId('copy-demo-link')).not.toBeInTheDocument()
  })
})

/**
 * A menu that will not close is a menu that is in the way. `<details>` gives
 * the disclosure but not the dismissal, so the two ordinary ways out — clicking
 * away, and Escape — are held here and are worth asserting.
 */
describe('closing the account menu', () => {
  function openMenu() {
    const menu = screen.getByTestId('account-menu') as HTMLDetailsElement
    return menu
  }

  it('closes when the pointer lands outside it', async () => {
    const user = userEvent.setup()
    renderMenu('super_admin')

    await user.click(screen.getByLabelText('Account'))
    expect(openMenu().open).toBe(true)

    await user.click(document.body)

    expect(openMenu().open).toBe(false)
  })

  it('stays open when the pointer lands inside it', async () => {
    const user = userEvent.setup()
    renderMenu('super_admin')

    await user.click(screen.getByLabelText('Account'))
    await user.click(screen.getByTestId('account-name'))

    expect(openMenu().open).toBe(true)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderMenu('super_admin')

    await user.click(screen.getByLabelText('Account'))
    await user.keyboard('{Escape}')

    expect(openMenu().open).toBe(false)
  })
})

/**
 * The menu states what somebody **holds**, and reaching a surface is not holding
 * a role (owner-reaches-every-outlet, design D1). An owner who manages no outlet
 * reaches every outlet's manager surfaces and is a manager of none of them; the
 * one place in the app that names a person's roles must say so.
 */
describe('what the account menu says you hold', () => {
  it('names the owner role only, for an owner who manages no outlet', () => {
    const { profile } = personaFixtures.super_admin
    const ownerOnly: Session = {
      mode: 'real',
      userId: profile.id,
      assignments: [
        { id: 'a1', role: 'super_admin', outletId: null, startedOn: '2025-06-01', endedOn: null },
      ],
      ...deriveSessionScope([
        { id: 'a1', role: 'super_admin', outletId: null, startedOn: '2025-06-01', endedOn: null },
      ]),
      displayName: profile.full_name,
    }

    render(
      <MemoryRouter>
        <SessionContext.Provider value={ownerOnly}>
          <AdaptersContext.Provider value={createMockAdapters('super_admin')}>
            <AccountMenu onSignOut={() => undefined} />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.queryByText(/Admin/)).not.toBeInTheDocument()
  })

  it('names both, for an owner who does manage one', () => {
    renderMenu('super_admin')

    // The demo owner day-runs Kalyani, and that assignment is a fact about them.
    expect(screen.getByText(/Owner · Admin/)).toBeInTheDocument()
  })
})
