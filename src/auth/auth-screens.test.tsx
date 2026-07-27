import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from '@/routes'

/**
 * Sign-in and activation, at the level a person experiences them: what the
 * screen says when it refuses, and what it does when it does not.
 *
 * The error classes are declared inside the mock rather than imported: the
 * whole module is replaced, so these ARE the classes the screens will see, and
 * `instanceof` in the components matches what the tests throw.
 */
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
    redeemInvite: vi.fn(),
    currentUser: vi.fn(),
    loadOwnProfile: vi.fn(),
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
})

describe('sign in', () => {
  it('signs in and leaves the sign-in screen', async () => {
    const user = userEvent.setup()
    auth.signIn.mockResolvedValue({ userId: 'u-1', email: 'admin.kalyani@example.com' })

    const { router } = renderAt('/sign-in')
    await user.type(screen.getByLabelText('Email'), 'admin.kalyani@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(auth.signIn).toHaveBeenCalledWith('admin.kalyani@example.com', 'a-real-password')
    expect(router.state.location.pathname).not.toBe('/sign-in')
  })

  it('returns to the surface the visitor originally asked for', async () => {
    const user = userEvent.setup()
    auth.signIn.mockResolvedValue({ userId: 'u-1', email: 'x@example.com' })

    // Arriving unauthenticated at a role surface redirects here carrying the
    // destination; signing in has to honour it rather than dumping everyone
    // on a generic home.
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/sign-in', state: { from: '/admin/people' } }],
    })
    render(<RouterProvider router={router} />)

    await user.type(screen.getByLabelText('Email'), 'x@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(router.state.location.pathname).toBe('/admin/people')
  })

  it('says the same thing for a wrong address as for a wrong password', async () => {
    const user = userEvent.setup()
    auth.signIn.mockRejectedValue(
      new auth.SignInError('invalid_credentials', 'That email or password is not right.'),
    )

    renderAt('/sign-in')
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await user.type(screen.getByLabelText('Password'), 'whatever-goes')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'That email or password is not right.',
    )
  })

  it('explains a session that ended, when it was sent here by one', async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/sign-in', state: { reason: 'deactivated' } }],
    })
    render(<RouterProvider router={router} />)

    expect(screen.getByTestId('session-ended')).toHaveTextContent(
      'Your account has been deactivated.',
    )
  })

  it('offers no self-service reset, because there is none', () => {
    renderAt('/sign-in')
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set your password' })).toBeInTheDocument()
  })
})

describe('activation', () => {
  it('redeems the code, sets the password, and signs in', async () => {
    const user = userEvent.setup()
    auth.redeemInvite.mockResolvedValue(undefined)
    auth.signIn.mockResolvedValue({ userId: 'u-2', email: 'new.staff@example.com' })

    renderAt('/activate')
    await user.type(screen.getByLabelText('Email'), 'new.staff@example.com')
    await user.type(screen.getByLabelText('One-time code'), 'ABCDE-FGHJK')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(auth.redeemInvite).toHaveBeenCalledWith(
      'new.staff@example.com',
      'ABCDE-FGHJK',
      'a-real-password',
    )
    expect(auth.signIn).toHaveBeenCalledWith('new.staff@example.com', 'a-real-password')
  })

  it('says what to do when the code will not work', async () => {
    const user = userEvent.setup()
    auth.redeemInvite.mockRejectedValue(
      new auth.ActivationError(
        'invalid_code',
        'That code is not valid — it may have expired or already been used. Ask your manager for a new one.',
      ),
    )

    renderAt('/activate')
    await user.type(screen.getByLabelText('Email'), 'new.staff@example.com')
    await user.type(screen.getByLabelText('One-time code'), 'WRONG-CODE1')
    await user.type(screen.getByLabelText('New password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByTestId('activate-error')).toHaveTextContent(
      'Ask your manager for a new one.',
    )
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('states the password rule before it is broken', () => {
    renderAt('/activate')
    expect(screen.getByText('At least 10 characters.')).toBeInTheDocument()
  })
})
