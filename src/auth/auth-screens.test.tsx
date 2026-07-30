import { render, screen } from '@testing-library/react'
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
  it('signs in with the canonical username and leaves the sign-in screen', async () => {
    const user = userEvent.setup()
    auth.signIn.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })

    const { router } = renderAt('/sign-in')
    await user.type(screen.getByLabelText('Username or email'), 'Admin.Kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(auth.signIn).toHaveBeenCalledWith('admin.kalyani', 'a-real-password')
    expect(router.state.location.pathname).not.toBe('/sign-in')
  })

  it('returns to the surface the visitor originally asked for', async () => {
    const user = userEvent.setup()
    auth.signIn.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/sign-in', state: { from: '/admin/people' } }],
    })
    render(<RouterProvider router={router} />)

    await user.type(screen.getByLabelText('Username or email'), 'admin.kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(router.state.location.pathname).toBe('/admin/people')
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

  it('takes the one-time code by hand when there is no link', async () => {
    const user = userEvent.setup()
    auth.previewInvite.mockResolvedValue('new.staff')

    renderAt('/activate')
    await user.type(screen.getByLabelText('One-time code'), 'ABCDE-FGHJK')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByTestId('activate-username')).toHaveTextContent('new.staff')
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })
})
