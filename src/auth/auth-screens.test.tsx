import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from '@/routes'

const auth = vi.hoisted(() => {
  class SignInError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'SignInError'
    }
  }
  class ActivationError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'ActivationError'
    }
  }
  return {
    signIn: vi.fn(),
    signOut: vi.fn(),
    previewInvite: vi.fn(),
    redeemInvite: vi.fn(),
    currentUser: vi.fn(),
    loadOwnProfile: vi.fn(),
    // Needed since design D11: sign-in waits for a resolved session before it
    // leaves, and resolving one reads assignments as well as the profile.
    loadOwnAssignments: vi.fn(),
    // Asked before either of those since counter-devices-and-offline: a session
    // is a tablet or a person, and the tablet question comes first.
    loadOwnCounterDevice: vi.fn(),
    loadCounterShift: vi.fn(),
    currentClaims: vi.fn(),
    refreshClaims: vi.fn(),
    onAuthChange: vi.fn(),
    MIN_PASSWORD_LENGTH: 10,
    SignInError,
    ActivationError,
  }
})

vi.mock('@/data-access/auth', () => auth)

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.onAuthChange.mockReturnValue(() => {})
  auth.currentUser.mockResolvedValue(null)
  auth.signOut.mockResolvedValue(undefined)
  auth.loadOwnCounterDevice.mockResolvedValue(null)
  auth.loadCounterShift.mockResolvedValue(null)
  auth.loadOwnProfile.mockResolvedValue({
    id: 'u-1',
    full_name: 'Synthetic Admin Kal',
    phone: null,
    is_active: true,
    role_title: 'Manager',
    created_at: '2026-07-26T00:00:00+00:00',
  })
  auth.loadOwnAssignments.mockResolvedValue([
    {
      id: 'a-1',
      role: 'franchise_admin',
      outletId: 'outlet-kalyani',
      startedOn: '2025-08-01',
      endedOn: null,
    },
  ])
})

/**
 * A sign-in that really produces a session, which is what the screen now waits
 * for: since design D11 it leaves on a resolved session rather than on accepted
 * credentials, so a test whose `currentUser` stays null would sit on the form
 * forever — correctly.
 */
function signInSucceeds() {
  auth.signIn.mockImplementation(async () => {
    auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
    return { userId: 'u-1', username: 'admin.kalyani' }
  })
}

describe('sign in', () => {
  it('signs in with the canonical username and leaves the sign-in screen', async () => {
    const user = userEvent.setup()
    signInSucceeds()

    const { router } = renderAt('/sign-in')
    await user.type(screen.getByLabelText('Username or email'), 'Admin.Kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(auth.signIn).toHaveBeenCalledWith('admin.kalyani', 'a-real-password')
    // Awaited rather than asserted on the spot. Read immediately this used to
    // pass by racing the redirect, which is how it stayed green through the bug
    // design D11 records: the root read a stale `anonymous` and sent the person
    // back here. Waiting for the dust to settle is the only way to see it.
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })

  it('returns to the surface the visitor originally asked for', async () => {
    const user = userEvent.setup()
    signInSucceeds()
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/sign-in', state: { from: '/admin/people' } }],
    })
    render(<RouterProvider router={router} />)

    await user.type(screen.getByLabelText('Username or email'), 'admin.kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/people'))
  })

  it('keeps invalid username and password failures indistinguishable', async () => {
    const user = userEvent.setup()
    auth.signIn.mockRejectedValue(
      new auth.SignInError('invalid_credentials', 'Those sign-in details are not right.'),
    )

    renderAt('/sign-in')
    await user.type(screen.getByLabelText('Username or email'), 'nobody')
    await user.type(screen.getByLabelText('Password'), 'whatever-goes')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'Those sign-in details are not right.',
    )
  })

  it('names a connection problem without commenting on the credentials', async () => {
    const user = userEvent.setup()
    auth.signIn.mockRejectedValue(
      new auth.SignInError(
        'unreachable',
        "Could not reach Shawarmania. Check this device's internet connection and try again.",
      ),
    )

    renderAt('/sign-in')
    await user.type(screen.getByLabelText('Username or email'), 'nobody')
    await user.type(screen.getByLabelText('Password'), 'whatever-goes')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const error = await screen.findByTestId('signin-error')
    expect(error).toHaveTextContent("Check this device's internet connection and try again.")
    expect(error).not.toHaveTextContent(/username|password|details are not right/i)
  })

  it('refuses @-prefixed handles before asking the backend', async () => {
    const user = userEvent.setup()
    renderAt('/sign-in')

    await user.type(screen.getByLabelText('Username or email'), '@admin.kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'Type the username without the @ sign',
    )
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('accepts an associated email permanently', async () => {
    const user = userEvent.setup()
    auth.signIn.mockResolvedValue({ userId: 'u-1', username: 'owner' })
    renderAt('/sign-in')

    await user.type(screen.getByLabelText('Username or email'), 'Owner@Example.com')
    expect(screen.getByText(/Email also works when one is associated/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(auth.signIn).toHaveBeenCalledWith('owner@example.com', 'a-real-password')
  })

  it('routes every forgotten password through an authorized admin', () => {
    renderAt('/sign-in')

    expect(screen.getByText(/Ask a Franchise Admin or Super Admin/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /recover/i })).not.toBeInTheDocument()
  })

  /**
   * One sentence covers both, and there is no route to activation from here.
   * That link could only reach a form asking for a typed code, which no admin is
   * ever shown one to supply (the-root-resolves-instead-of-greeting, design D8).
   */
  it('offers no route to activation, and covers a first password as well as a forgotten one', () => {
    renderAt('/sign-in')

    expect(screen.queryByRole('link', { name: /set your password/i })).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="/activate"]')).toBeNull()
    expect(screen.getByText(/No password yet, or forgotten it\?/)).toBeInTheDocument()
  })
})

describe('activation', () => {
  const LINK = '/activate?code=ABCDE-FGHJK'

  async function openActivation() {
    auth.previewInvite.mockResolvedValue('new.staff')
    renderAt(LINK)
    await screen.findByTestId('activate-username')
  }

  it('shows the username and asks for username plus two matching passwords', async () => {
    const user = userEvent.setup()
    auth.previewInvite.mockResolvedValue('new.staff')
    auth.redeemInvite.mockResolvedValue(undefined)
    auth.signIn.mockResolvedValue({ userId: 'u-2', username: 'new.staff' })

    renderAt(LINK)

    expect(await screen.findByTestId('activate-username')).toHaveTextContent('new.staff')
    expect(screen.queryByLabelText('One-time code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Re-type password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    )

    await user.type(screen.getByLabelText('Username'), 'New.Staff')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.type(screen.getByLabelText('Re-type password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(auth.previewInvite).toHaveBeenCalledWith('ABCDE-FGHJK')
    expect(auth.redeemInvite).toHaveBeenCalledWith('ABCDE-FGHJK', 'new.staff', 'a-real-password')
    expect(auth.signIn).toHaveBeenCalledWith('new.staff', 'a-real-password')
  })

  it('does not consume the code when the typed username differs', async () => {
    const user = userEvent.setup()
    await openActivation()

    await user.type(screen.getByLabelText('Username'), 'other.person')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.type(screen.getByLabelText('Re-type password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByTestId('activate-error')).toHaveTextContent(
      'Type the username shown above',
    )
    expect(auth.redeemInvite).not.toHaveBeenCalled()
  })

  it('does not consume the code when the passwords differ', async () => {
    const user = userEvent.setup()
    await openActivation()

    await user.type(screen.getByLabelText('Username'), 'new.staff')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.type(screen.getByLabelText('Re-type password'), 'a-real-passwrod')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByTestId('activate-error')).toHaveTextContent('are not the same')
    expect(auth.redeemInvite).not.toHaveBeenCalled()
  })

  it('keeps a weak-password refusal on the form', async () => {
    const user = userEvent.setup()
    auth.previewInvite.mockResolvedValue('new.staff')
    auth.redeemInvite.mockRejectedValue(
      new auth.ActivationError('weak_password', 'Choose a password of at least 10 characters.'),
    )
    renderAt(LINK)
    await screen.findByTestId('activate-username')

    await user.type(screen.getByLabelText('Username'), 'new.staff')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Re-type password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByTestId('activate-error')).toHaveTextContent('at least 10 characters')
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
  })

  it('says a dead link is dead before anything has been typed', async () => {
    auth.previewInvite.mockRejectedValue(
      new auth.ActivationError(
        'invalid_code',
        'This link is no longer usable. Ask your manager for a new one.',
      ),
    )

    renderAt(LINK)

    expect(await screen.findByTestId('activate-error')).toHaveTextContent(
      'Ask your manager for a new one.',
    )
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('asks the person to check the connection when activation cannot reach the backend', async () => {
    auth.previewInvite.mockRejectedValue(
      new auth.ActivationError(
        'unavailable',
        "Could not reach Shawarmania. Check this device's internet connection and try again.",
      ),
    )

    renderAt(LINK)

    const error = await screen.findByTestId('activate-error')
    expect(error).toHaveTextContent("Check this device's internet connection and try again.")
    expect(error).not.toHaveTextContent(/expired|already been used/i)
  })

  it('keeps connection guidance on the activation form when redemption cannot connect', async () => {
    const user = userEvent.setup()
    auth.previewInvite.mockResolvedValue('new.staff')
    auth.redeemInvite.mockRejectedValue(
      new auth.ActivationError(
        'unavailable',
        "Could not reach Shawarmania. Check this device's internet connection and try again.",
      ),
    )
    renderAt(LINK)
    await screen.findByTestId('activate-username')

    await user.type(screen.getByLabelText('Username'), 'new.staff')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.type(screen.getByLabelText('Re-type password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByTestId('activate-error')).toHaveTextContent(
      "Check this device's internet connection and try again.",
    )
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
  })

  /**
   * This used to be the opposite assertion: `/activate` with no code took one by
   * hand. It contradicted a requirement already in force — the code SHALL NOT be
   * typed — and asked for a value nobody is ever given, since the issuing panel
   * hands over a QR, the link and a copy action and deliberately prints no raw
   * code (the-root-resolves-instead-of-greeting, design D8).
   */
  it('offers no way to type a code, and says an incomplete link is incomplete', async () => {
    renderAt('/activate')

    expect(await screen.findByTestId('activate-error')).toHaveTextContent(
      'missing its one-time code',
    )
    expect(screen.getByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument()

    // The three things that must not be here: a code field, a form to submit one,
    // and any suggestion that supplying one is the way forward.
    expect(screen.queryByLabelText('One-time code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()

    // Nothing was asked of the backend: there is no code to ask about.
    expect(auth.previewInvite).not.toHaveBeenCalled()

    // And the one route onward.
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
  })
})
