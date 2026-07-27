import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from '@/routes'

import { DEMO_CONTINUE_KEY } from './demo-gate'

/**
 * The demo-entry guard (design D5), with the session probe mocked at the
 * seam data-access exposes for it. The end-to-end variant exercises the real
 * probe against a session seeded in the client's own storage.
 */
const hasPersistedRealSession = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('@/data-access/real-session', () => ({ hasPersistedRealSession }))

function renderDemo(path = '/demo/owner') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('demo entry guard', () => {
  beforeEach(() => {
    sessionStorage.clear()
    hasPersistedRealSession.mockReset()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('interposes the interstitial when a real session is present', async () => {
    hasPersistedRealSession.mockResolvedValue(true)
    renderDemo()

    expect(await screen.findByTestId('demo-interstitial')).toBeInTheDocument()
    // No demo surface rendered behind it.
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
    // It names the state and offers exactly the two explicit choices.
    expect(screen.getByRole('button', { name: 'Continue to demo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the app' })).toHaveAttribute('href', '/')
  })

  it('continue is an explicit, tab-scoped choice', async () => {
    hasPersistedRealSession.mockResolvedValue(true)
    const user = userEvent.setup()
    renderDemo()

    await user.click(await screen.findByRole('button', { name: 'Continue to demo' }))
    expect(await screen.findByTestId('demo-banner')).toBeInTheDocument()

    // Held in sessionStorage — dies with the tab, never with the account.
    expect(sessionStorage.getItem(DEMO_CONTINUE_KEY)).toBe('1')
  })

  it('goes straight in when no real session exists', async () => {
    hasPersistedRealSession.mockResolvedValue(false)
    renderDemo()

    expect(await screen.findByTestId('demo-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('demo-interstitial')).not.toBeInTheDocument()
  })

  it('skips the probe entirely once this tab has chosen', async () => {
    sessionStorage.setItem(DEMO_CONTINUE_KEY, '1')
    hasPersistedRealSession.mockResolvedValue(true)
    renderDemo()

    expect(await screen.findByTestId('demo-banner')).toBeInTheDocument()
    expect(hasPersistedRealSession).not.toHaveBeenCalled()
  })
})
