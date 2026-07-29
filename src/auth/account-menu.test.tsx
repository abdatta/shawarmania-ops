import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { Landing } from '@/routes/landing'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'

import { AccountMenu } from './account-menu'

/**
 * Handing the demo over (design D9): it leaves the public landing card and
 * appears in the Super Admin's account menu with a copy action beside it.
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
  const { profile } = personaFixtures[role]
  return {
    mode: 'real',
    userId: profile.id,
    role,
    outletId: profile.outlet_id,
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
  const originalClipboard = navigator.clipboard

  /**
   * Installed *after* `userEvent.setup()`, which replaces `navigator.clipboard`
   * with its own stub — a spy created before it is silently discarded, and the
   * assertion then fails for a reason that has nothing to do with the code.
   */
  function stubClipboard(behaviour: 'copies' | 'refuses') {
    const writeText =
      behaviour === 'copies'
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    })
  })

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

  it('appears in the Super Admin’s account menu, and addresses the demo root', () => {
    renderMenu('super_admin')

    expect(screen.getByTestId('demo-entry')).toBeInTheDocument()
    // `/demo`, not `/demo/owner`. The banner's role switcher is right there,
    // and a recipient should not be pinned to whichever role the owner was
    // looking at when they copied it.
    expect(screen.getByTestId('demo-link')).toHaveAttribute('href', '/demo')
  })

  it('appears for nobody else', () => {
    for (const role of ['franchise_admin', 'biller', 'employee'] as const) {
      const { unmount } = renderMenu(role)
      expect(screen.queryByTestId('demo-entry')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('copies the demo root as an absolute link, and says it did', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard('copies')
    renderMenu('super_admin')

    await user.click(screen.getByTestId('copy-demo-link'))

    expect(writeText).toHaveBeenCalledWith(new URL('/demo', window.location.origin).href)
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
  })

  it('shows the link to select by hand when copying is refused', async () => {
    const user = userEvent.setup()
    stubClipboard('refuses')
    renderMenu('super_admin')

    await user.click(screen.getByTestId('copy-demo-link'))

    // A copy button that silently does nothing is worse than no copy button.
    const fallback = await screen.findByTestId('demo-link-fallback')
    expect(fallback).toHaveTextContent(new URL('/demo', window.location.origin).href)
    expect(screen.queryByText('Link copied.')).not.toBeInTheDocument()
  })
})
