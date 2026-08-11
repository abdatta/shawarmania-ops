import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Assignment } from '@/data-access/adapters'
import type { Profile } from '@/data-access/auth'
import { isDemoScopeActive } from '@/data-access/demo-scope'
import { appRoutes } from '@/routes'

/**
 * What the application root does, in each of the four states it can be in.
 *
 * The root used to render a card describing the product and redirect only from
 * `ready`, so the other three fell through to it. These tests exist because the
 * interesting one is the state that must NOT redirect: a session that could not
 * be confirmed is not a session that is absent, and treating them the same asks
 * somebody to retype a password for a session they still hold
 * (the-root-resolves-instead-of-greeting, design D2).
 *
 * Assertions are on the resolved path rather than on a rendered shell, matching
 * the sign-in suite: mounting a role shell needs Supabase adapters, and where
 * the root sends somebody is the behaviour under test either way.
 */

const auth = vi.hoisted(() => ({
  currentUser: vi.fn(),
  loadOwnProfile: vi.fn(),
  loadOwnAssignments: vi.fn(),
  loadOwnCounterDevice: vi.fn(),
  loadCounterShift: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  previewInvite: vi.fn(),
  redeemInvite: vi.fn(),
  onAuthChange: vi.fn(),
  MIN_PASSWORD_LENGTH: 10,
  SignInError: class extends Error {},
  ActivationError: class extends Error {},
}))

vi.mock('@/data-access/auth', () => auth)

/**
 * The `ready` cases navigate to a role shell, which really mounts and whose
 * surfaces really start reading. Left on the Supabase adapters those reads float
 * off and reject, and Vitest is right to call an unhandled rejection a source of
 * false positives — so the seam is swapped for mocks and the test stays
 * hermetic. Where the root SENDS somebody is what is under test; what the shell
 * then renders belongs to the suites that own those surfaces.
 */
vi.mock('@/data-access/supabase-adapters', async () => {
  const { createMockAdapters } = await import('@/data-access/mock')
  return { createSupabaseAdapters: () => createMockAdapters('franchise_admin') }
})

const PROFILE: Profile = {
  id: 'u-1',
  full_name: 'Synthetic Admin Kal',
  phone: null,
  is_active: true,
  role_title: 'Manager',
  created_at: '2026-07-26T00:00:00+00:00',
}

const MANAGES_KALYANI: Assignment = {
  id: 'a-1',
  role: 'franchise_admin',
  outletId: 'outlet-kalyani',
  startedOn: '2025-08-01',
  endedOn: null,
}

const BILLS_KALYANI: Assignment = {
  id: 'a-biller',
  role: 'biller',
  outletId: 'outlet-kalyani',
  startedOn: '2025-08-01',
  endedOn: null,
}

/** A resolution that never arrives, so `loading` can be observed at all. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

function mountAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

/**
 * The demo branch, which sits outside the session holder. `sessionStorage` is
 * cleared so the demo-entry gate is exercised from a clean tab, exactly as
 * demo-safety.test.tsx does.
 */
function renderDemoOwner() {
  sessionStorage.clear()
  return mountAt('/demo/owner')
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.onAuthChange.mockReturnValue(() => {})
  // A person unless a test says otherwise. The tablet question is asked first
  // on every resolution since counter-devices-and-offline.
  auth.loadOwnCounterDevice.mockResolvedValue(null)
  auth.loadCounterShift.mockResolvedValue(null)
  auth.signOut.mockResolvedValue(undefined)
  auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
  auth.loadOwnProfile.mockResolvedValue(PROFILE)
  auth.loadOwnAssignments.mockResolvedValue([MANAGES_KALYANI])
})

describe('the application root', () => {
  it('waits behind the shell placeholder while the session is unresolved, and sends nobody anywhere', async () => {
    auth.currentUser.mockReturnValue(never())

    const router = mountAt('/')

    expect(await screen.findByText('Loading the app…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')

    // The point of the placeholder: not merely that it is shown, but that no
    // decision was taken while the answer was unknown.
    expect(router.state.location.pathname).toBe('/')
  })

  it('takes a resolved session to the home of the highest role it holds', async () => {
    const router = mountAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })

  it('takes a personal Biller to the staff home without mounting tablet billing', async () => {
    auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'biller.kalyani' })
    auth.loadOwnAssignments.mockResolvedValue([BILLS_KALYANI])

    const router = mountAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/staff'))
    expect(await screen.findByText('Hello, Synthetic Admin Kal')).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'My attendance' })).not.toHaveLength(0)
    expect(screen.queryAllByRole('link', { name: 'Counter' })).toHaveLength(0)
    expect(screen.queryByText(/No shift is open/)).toBeNull()
  })

  it('takes a session that holds nothing to the role root, which says so', async () => {
    auth.loadOwnAssignments.mockResolvedValue([])

    const router = mountAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/staff'))
  })

  it('sends a confirmed signed-out visitor straight to sign-in', async () => {
    auth.currentUser.mockResolvedValue(null)

    const router = mountAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))

    // Nothing described the product on the way past.
    expect(screen.queryByText(/Counter billing, attendance/)).not.toBeInTheDocument()
  })

  it('offers a retry for a session it could not confirm, and never sign-in', async () => {
    // A stored session exists; the read that would confirm it fails. That is
    // `indeterminate`, which becomes `unavailable` and must not become
    // `anonymous`.
    auth.loadOwnProfile.mockRejectedValue(new Error('network down'))

    const router = mountAt('/')

    expect(await screen.findByText(/could not confirm it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('resolves the session on retry rather than leaving the card up', async () => {
    const user = userEvent.setup()
    auth.loadOwnProfile.mockRejectedValueOnce(new Error('network down'))

    const router = mountAt('/')
    await screen.findByRole('button', { name: 'Try again' })

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })

  /**
   * The cost this change exists to remove, pinned so it cannot come back.
   *
   * `useRealSession` is a hook, so before the provider its state was per
   * component: the root resolved, redirected, unmounted, and the role shell
   * mounted and resolved the same session again from nothing. One cold launch at
   * the root read profile and assignments twice, and the root is the installed
   * app's `start_url` (design D5).
   */
  it('resolves the session once for the visit, not once per screen', async () => {
    const router = mountAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))

    expect(auth.loadOwnProfile).toHaveBeenCalledTimes(1)
    expect(auth.loadOwnAssignments).toHaveBeenCalledTimes(1)
  })
})

/**
 * The structural half of design D5, asserted rather than assumed.
 *
 * The session holder must not be mounted above demo mode. If it were,
 * `resolveSession` would call `getSupabaseClient()` inside the demo tree, where
 * it throws — and `resolveSession` catches every throw and returns
 * `indeterminate`, so the tripwire would fire and be silently swallowed. The
 * route tree keeps them apart; this is what proves it stayed that way.
 */
/**
 * The bug the auth suite caught and every mocked test missed (design D11).
 *
 * Accepted credentials and a resolved session are two moments. The provider
 * computed `anonymous` when sign-in loaded, and learns better from its auth
 * listener a tick later. Navigating to the root in between meant the root read
 * that stale `anonymous` and sent the person back to sign-in — signed in,
 * looking at a password field.
 *
 * The existing sign-in test asserted `pathname !== '/sign-in'` immediately after
 * the click, which passed by racing the redirect. These wait for the dust to
 * settle instead, which is the only way to see it.
 */
describe('signing in lands on the shell, not back on sign-in', () => {
  it('waits for the session rather than the credentials', async () => {
    const user = userEvent.setup()

    // Anonymous when the screen loads: the state the stale read used to return.
    auth.currentUser.mockResolvedValue(null)
    auth.signIn.mockImplementation(async () => {
      // What supabase-js does: the session exists from here on.
      auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
      return { userId: 'u-1', username: 'admin.kalyani' }
    })

    const router = mountAt('/sign-in')

    await user.type(await screen.findByLabelText('Username or email'), 'admin.kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })

  it('honours a deep link it was sent to sign in for', async () => {
    const user = userEvent.setup()
    auth.currentUser.mockResolvedValue(null)
    auth.signIn.mockImplementation(async () => {
      auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
      return { userId: 'u-1', username: 'admin.kalyani' }
    })

    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/sign-in', state: { from: '/admin/people' } }],
    })
    render(<RouterProvider router={router} />)

    await user.type(await screen.findByLabelText('Username or email'), 'admin.kalyani')
    await user.type(screen.getByLabelText('Password'), 'a-real-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/people'))
  })
})

describe('demo mode is outside the session holder', () => {
  it('resolves no real session for any demo path', async () => {
    renderDemoOwner()

    expect(await screen.findByTestId('demo-banner')).toBeInTheDocument()
    expect(isDemoScopeActive()).toBe(true)

    // `currentUser` is the provider's very first call. Never reaching it is the
    // sharpest available proof that the provider never mounted here.
    expect(auth.currentUser).not.toHaveBeenCalled()
    expect(auth.loadOwnProfile).not.toHaveBeenCalled()
    expect(auth.loadOwnAssignments).not.toHaveBeenCalled()
  })
})

describe('the screens that need no session', () => {
  /**
   * Pins design D6: the provider supplies session state and does not gate
   * rendering. It sits above sign-in, and sign-in needs no session, so an edit
   * that made the provider wait would put a shimmer in front of the login form —
   * worse than the flash this change removes.
   */
  it('render immediately while the session is still resolving', async () => {
    auth.currentUser.mockReturnValue(never())

    mountAt('/sign-in')

    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Loading the app…')).not.toBeInTheDocument()
  })

  it('render activation immediately too', async () => {
    auth.currentUser.mockReturnValue(never())
    auth.previewInvite.mockResolvedValue('new.staff')

    mountAt('/activate?code=ABCDE-FGHJK')

    expect(await screen.findByTestId('activate-username')).toHaveTextContent('new.staff')
    expect(screen.queryByText('Loading the app…')).not.toBeInTheDocument()
  })
})

/**
 * Where a counter tablet goes, and everywhere it does not.
 *
 * A tablet is a machine principal with no profile, no assignment and no name.
 * The role tree asks a session which roles it holds, which shell it gets and
 * where it lands; none of those are questions a tablet can answer, so the
 * boundary is that it never enters that tree at all.
 */
describe('a counter tablet', () => {
  const TABLET = {
    deviceId: 'device-1',
    outletId: 'outlet-kalyani',
    label: 'Kalyani counter tablet',
  }

  beforeEach(() => {
    auth.currentUser.mockResolvedValue({ userId: 'device-1', username: 'tablet.kalyani' })
    auth.loadOwnCounterDevice.mockResolvedValue(TABLET)
  })

  it('is sent to its own branch from the application root', async () => {
    const router = mountAt('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/counter'))
  })

  it('is sent back there from a role path it could never fill', async () => {
    const router = mountAt('/owner')
    await waitFor(() => expect(router.state.location.pathname).toBe('/counter'))
  })

  it('renders the tablet label rather than a person name', async () => {
    mountAt('/counter')
    expect(await screen.findByText('Kalyani counter tablet')).toBeVisible()
  })

  it('offers no sign-out, because a tablet is set up rather than signed in', async () => {
    mountAt('/counter')
    await screen.findByText('Kalyani counter tablet')
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })

  it('asks for no password anywhere, which is the point of the whole change', async () => {
    // A tripwire rather than an observation. Nothing in this tree has a form
    // yet, so this passes trivially today — and it is exactly the assertion that
    // has to keep passing when the shift-request screen and the billing shell
    // arrive. What a tablet may reach is the database's answer; what it may ASK
    // FOR is this one.
    const { container } = render(
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/counter'] })} />,
    )
    await screen.findAllByText('Kalyani counter tablet')

    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('never asks the person questions on the way', async () => {
    mountAt('/counter')
    await screen.findByText('Kalyani counter tablet')
    expect(auth.loadOwnProfile).not.toHaveBeenCalled()
    expect(auth.loadOwnAssignments).not.toHaveBeenCalled()
  })

  it('and a person who types /counter is sent to their own shell instead', async () => {
    auth.currentUser.mockResolvedValue({ userId: 'u-1', username: 'admin.kalyani' })
    auth.loadOwnCounterDevice.mockResolvedValue(null)

    const router = mountAt('/counter')
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })
})
