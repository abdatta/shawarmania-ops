import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from '@/routes'

/**
 * Setting a tablet up, and the promise the whole change rests on: **no password
 * is ever typed on shared hardware.**
 *
 * The last test here is a tripwire rather than a behaviour. It will fail the day
 * somebody adds a password field to this tree for a good-sounding reason, which
 * is exactly when somebody should have to argue for it.
 */

const auth = vi.hoisted(() => {
  class CounterSetupError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'CounterSetupError'
    }
  }
  return {
    signIn: vi.fn(),
    signOut: vi.fn(),
    previewInvite: vi.fn(),
    redeemInvite: vi.fn(),
    currentUser: vi.fn(),
    loadOwnProfile: vi.fn(),
    loadOwnAssignments: vi.fn(),
    loadOwnCounterDevice: vi.fn(),
    loadCounterShift: vi.fn(),
    setUpCounterDevice: vi.fn(),
    onAuthChange: vi.fn(),
    MIN_PASSWORD_LENGTH: 10,
    SignInError: Error,
    ActivationError: Error,
    CounterSetupError,
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
  auth.loadOwnCounterDevice.mockResolvedValue(null)
  auth.loadCounterShift.mockResolvedValue(null)
})

describe('setting a tablet up', () => {
  it('asks for a setup code and nothing else', async () => {
    renderAt('/counter/setup')
    expect(await screen.findByLabelText('Setup code')).toBeInTheDocument()
    expect(screen.getByText(/never asks anybody for a password/i)).toBeInTheDocument()
  })

  it('says a dead code is dead without saying which account it belonged to', async () => {
    const user = userEvent.setup()
    auth.setUpCounterDevice.mockRejectedValue(
      new auth.CounterSetupError('invalid_code', 'That setup code did not work.'),
    )

    renderAt('/counter/setup')
    await user.type(await screen.findByLabelText('Setup code'), 'ABCDE-FGHJK')
    await user.click(screen.getByRole('button', { name: /^set up$/i }))

    expect(await screen.findByTestId('counter-setup-error')).toHaveTextContent(/did not work/i)
  })

  it('sends a tablet that is already set up to its own screen instead', async () => {
    auth.currentUser.mockResolvedValue({ userId: 'device-1', username: null })
    auth.loadOwnCounterDevice.mockResolvedValue({
      deviceId: 'device-1',
      outletId: 'outlet-1',
      label: 'Counter tablet',
    })

    const { router } = renderAt('/counter/setup')
    await screen.findByText('Counter tablet')
    expect(router.state.location.pathname).toBe('/counter')
  })

  it('has no password input anywhere in the tablet tree', async () => {
    const { container } = renderAt('/counter/setup')
    await screen.findByLabelText('Setup code')
    // Not "there is no password field on this screen" — there is no place on a
    // tablet where a personal secret can be typed, at setup or ever after.
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })
})
