import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CounterRoot } from '@/auth/counter-root'
import { useRealSessionContext } from '@/auth/real-session-context'
import { RealSessionProvider } from '@/auth/real-session-provider'
import { homeFor, mayOpen } from '@/auth/tablet-boundary'
import type { RealSessionState } from '@/auth/use-real-session'
import type { Assignment } from '@/data-access/adapters'
import { AUTH_STORAGE_KEY, DEVICE_EMAIL_DOMAIN } from '@/data-access/auth'
import { appRoutes } from '@/routes'
import type { CounterDeviceSession } from '@/session/counter-session'
import { deriveSessionScope, ROLE_SEGMENTS } from '@/session/session'
import { ChangeGatesForTest } from '@/test/change-gates'

/**
 * The tablet boundary, walked over the live route table
 * (a-tablet-keeps-its-login, design D3).
 *
 * The paths come from `appRoutes` itself, every one beneath
 * `RealSessionProvider`, so **a route added later is in this matrix the day it
 * is added**. Where each path is expected to land is computed from where it
 * lives: beneath a tablet's home it stays put for that tablet, and everywhere
 * else it sends both kinds of tablet home. Nothing lets a page in quietly, and
 * growing the counter is not a boundary edit.
 *
 * "No password field" is watched with a MutationObserver over the whole render,
 * not read off the final DOM, because a flash of the login form is the bug.
 */

const harness = vi.hoisted(() => ({
  state: { status: 'loading' } as unknown,
}))

vi.mock('@/auth/use-real-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/use-real-session')>()),
  useRealSession: () => ({
    state: harness.state,
    revalidate: () => {},
    endSession: async () => {},
  }),
}))

// What a shell renders is its own suite's business; which one mounts is ours.
vi.mock('@/features/counter/counter-shell', () => ({
  CounterShell: () => <div data-testid="counter-shell">Counter</div>,
}))
vi.mock('@/features/kitchen/kitchen-shell', () => ({
  KitchenShell: () => <div data-testid="kitchen-shell">Kitchen</div>,
}))
vi.mock('@/features/billing/use-counter-state', () => ({ useCounterState: () => ({}) }))
vi.mock('@/change-gates/use-change-gate-refresh', () => ({ useChangeGateRefresh: () => {} }))
vi.mock('@/change-gates/use-device-health-report', () => ({ useDeviceHealthReport: () => {} }))
vi.mock('@/data-access/supabase-adapters', async () => {
  const { createMockAdapters } = await import('@/data-access/mock')
  return { createSupabaseAdapters: () => createMockAdapters('franchise_admin') }
})

// ---------------------------------------------------------------------------
// The paths, from the table.

const PARAM_SAMPLES: Record<string, string> = {
  roleSegment: 'admin',
  gateKey: 'probe',
  outletId: 'outlet-kalyani',
  fixedCostId: 'fixed-cost-1',
  channel: 'zomato',
}

function join(parent: string, path: string | undefined): string {
  if (path === undefined) return parent
  if (path.startsWith('/')) return path
  return `${parent.replace(/\/$/, '')}/${path}`
}

function fill(path: string): string {
  return path.replace(/:(\w+)/g, (_, name: string) => PARAM_SAMPLES[name] ?? `sample-${name}`)
}

function collect(routes: RouteObject[], parent: string, into: Set<string>) {
  for (const route of routes) {
    const path = join(parent, route.path)
    if (route.path === '*') {
      into.add(fill(join(parent, 'no-such-page')))
    } else if (route.index || route.path !== undefined) {
      into.add(fill(path) || '/')
    }
    if (route.children) collect(route.children, path, into)
  }
}

/** Every path beneath the real session's provider, with its params filled. */
function realPaths(routes: RouteObject[]): string[] {
  const branch = routes.find((route) => route.Component === RealSessionProvider)
  if (!branch?.children) throw new Error('The real branch is not where the matrix expects it')
  const paths = new Set<string>()
  collect(branch.children, '', paths)
  paths.add('/no-such-page')
  for (const segment of Object.values(ROLE_SEGMENTS)) paths.add(`/${segment}`)
  paths.add('/activate?code=ABCD2345')
  return [...paths].sort()
}

const PATHS = realPaths(appRoutes)

// ---------------------------------------------------------------------------
// The sessions.

const COUNTER: CounterDeviceSession = {
  kind: 'counter-device',
  device: { deviceId: 'device-1', outletId: 'outlet-kalyani', label: 'Cafe 2', kind: 'counter' },
  shift: null,
}
const KITCHEN: CounterDeviceSession = {
  kind: 'counter-device',
  device: { deviceId: 'device-2', outletId: 'outlet-kalyani', label: 'Kitchen', kind: 'kitchen' },
  shift: null,
}
const MANAGES_KALYANI: Assignment = {
  id: 'a-1',
  role: 'franchise_admin',
  outletId: 'outlet-kalyani',
  startedOn: '2025-08-01',
  endedOn: null,
}
const PERSON: RealSessionState = {
  status: 'ready',
  session: {
    mode: 'real',
    userId: 'u-1',
    assignments: [MANAGES_KALYANI],
    ...deriveSessionScope([MANAGES_KALYANI]),
    displayName: 'Synthetic Admin Kal',
  },
}

function storeTabletSession() {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({ user: { id: 'device-1', email: `tablet-device-1@${DEVICE_EMAIL_DOMAIN}` } }),
  )
}

// ---------------------------------------------------------------------------
// The harness.

/** Records whether anything matching `selector` was ever attached. */
function watchFor(selector: string) {
  let seen = false
  const check = (node: Node) => {
    if (!(node instanceof Element)) return
    if (node.matches(selector) || node.querySelector(selector)) seen = true
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(check)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return {
    get seen() {
      return seen || document.querySelector(selector) !== null
    },
    stop: () => observer.disconnect(),
  }
}

const PASSWORD = 'input[type=password]'

async function visit(path: string, state: RealSessionState, gateOn: boolean, routes = appRoutes) {
  harness.state = state
  const password = watchFor(PASSWORD)
  const counterShell = watchFor('[data-testid=counter-shell]')
  const kitchenShell = watchFor('[data-testid=kitchen-shell]')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ChangeGatesForTest on={{ 'a-tablet-keeps-its-login': gateOn }}>
      <RouterProvider router={router} />
    </ChangeGatesForTest>,
  )
  // Let redirects chain (the person's /counter → / → /admin is two of them).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { router, password, counterShell, kitchenShell }
}

function stayFor(device: CounterDeviceSession, path: string): boolean {
  return mayOpen(device.device, new URL(path, 'http://x').pathname)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// ---------------------------------------------------------------------------

describe('the paths the matrix walks', () => {
  it('come from the live route table, so a broken flattener cannot pass', () => {
    expect(PATHS.length).toBeGreaterThan(20)
    expect(PATHS).toEqual(
      expect.arrayContaining([
        '/',
        '/sign-in',
        '/activate',
        '/counter/setup',
        '/counter',
        '/kitchen',
        '/no-such-page',
        '/admin/team',
        '/admin/ledger/fixed-costs/fixed-cost-1',
        '/admin/no-such-page',
      ]),
    )
    expect(PATHS.some((path) => path.startsWith('/demo'))).toBe(false)
  })
})

describe('the addresses a tablet may open', () => {
  it('are a counter’s home and everything beneath it, but not setup', () => {
    const counter = { kind: 'counter' as const }
    expect(homeFor(counter)).toBe('/counter')
    expect(homeFor({})).toBe('/counter')
    for (const open of ['/counter', '/counter/', '/counter/expenses', '/counter/expenses/today']) {
      expect(mayOpen(counter, open)).toBe(true)
    }
    for (const shut of [
      '/counter/setup',
      '/counter/setup/',
      '/counterfeit',
      '/kitchen',
      '/sign-in',
      '/',
      '/admin',
    ]) {
      expect(mayOpen(counter, shut)).toBe(false)
    }
  })

  it('are a kitchen’s home and everything beneath it', () => {
    const kitchen = { kind: 'kitchen' as const }
    expect(homeFor(kitchen)).toBe('/kitchen')
    for (const open of ['/kitchen', '/kitchen/', '/kitchen/stock']) {
      expect(mayOpen(kitchen, open)).toBe(true)
    }
    for (const shut of [
      '/kitchens',
      '/counter',
      '/counter/expenses',
      '/counter/setup',
      '/activate',
    ]) {
      expect(mayOpen(kitchen, shut)).toBe(false)
    }
  })
})

describe('with a-tablet-keeps-its-login on', () => {
  describe.each([
    ['counter', COUNTER, 'counter-shell'],
    ['kitchen', KITCHEN, 'kitchen-shell'],
  ] as const)('a set-up %s tablet', (_, device, shell) => {
    it.each(PATHS)(
      'opens %s and lands on its own branch, with no password field ever drawn',
      async (path) => {
        storeTabletSession()
        const { router, password, counterShell, kitchenShell } = await visit(
          path,
          { status: 'counter', device },
          true,
        )
        const landing = stayFor(device, path)
          ? new URL(path, 'http://x').pathname
          : homeFor(device.device)
        await waitFor(() => expect(router.state.location.pathname).toBe(landing))
        expect(await screen.findByTestId(shell)).toBeInTheDocument()
        expect(password.seen).toBe(false)
        // Never the other kind's screen, even on the way past.
        expect((shell === 'counter-shell' ? kitchenShell : counterShell).seen).toBe(false)
      },
    )
  })

  it.each(PATHS)(
    'holds %s behind a wait while a stored tablet session resolves, and draws no password field',
    async (path) => {
      storeTabletSession()
      const { router, password } = await visit(path, { status: 'loading' }, true)
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
      expect(router.state.location.pathname).toBe(new URL(path, 'http://x').pathname)
      expect(password.seen).toBe(false)
    },
  )

  it.each(['/sign-in', '/activate', '/admin'])(
    'offers a retry, not %s, when a stored tablet session cannot be confirmed',
    async (path) => {
      storeTabletSession()
      const { password } = await visit(path, { status: 'unavailable' }, true)
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(password.seen).toBe(false)
    },
  )

  it.each(['/counter', '/kitchen', '/counter/setup'])(
    'never draws a tablet screen for a person at %s',
    async (path) => {
      const { router, counterShell, kitchenShell } = await visit(path, PERSON, true)
      await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
      expect(counterShell.seen).toBe(false)
      expect(kitchenShell.seen).toBe(false)
    },
  )

  it.each(['/counter', '/kitchen'])('sends a signed-out visitor at %s to sign-in', async (path) => {
    const { router, counterShell, kitchenShell } = await visit(path, { status: 'anonymous' }, true)
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(counterShell.seen).toBe(false)
    expect(kitchenShell.seen).toBe(false)
  })

  it('still lets a signed-out visitor, and a fresh browser, see the sign-in form', async () => {
    const { password } = await visit('/sign-in', { status: 'loading' }, true)
    expect(password.seen).toBe(true)
  })
})

/**
 * The owner's two questions (2026-10-31), as tests against a copy of the table
 * with a page added to it: does a new page leak to a tablet, and can the counter
 * grow a page of its own without editing the boundary?
 */
describe('a page added after this change', () => {
  function withRealChildren(extra: (children: RouteObject[]) => RouteObject[]): RouteObject[] {
    return appRoutes.map((route) =>
      route.Component === RealSessionProvider
        ? ({ ...route, children: extra(route.children ?? []) } as RouteObject)
        : route,
    )
  }

  it('outside the tablet branches, such as a forgotten-password page, is closed to a tablet', async () => {
    const routes = withRealChildren((children) => [
      ...children,
      {
        path: '/forgot-password',
        Component: () => (
          <form>
            <label>
              New password <input type="password" />
            </label>
          </form>
        ),
      },
    ])
    expect(realPaths(routes)).toContain('/forgot-password')

    storeTabletSession()
    const { router, password } = await visit(
      '/forgot-password',
      { status: 'counter', device: COUNTER },
      true,
      routes,
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/counter'))
    expect(password.seen).toBe(false)
  })

  it('beneath the counter, such as counter Expenses, opens for a counter tablet only', async () => {
    // How a counter page would be mounted: beneath `/counter`, whose own screen
    // still decides what everyone who is not a counter tablet sees.
    function CounterBranch() {
      const { state } = useRealSessionContext()
      return state.status === 'counter' && state.device.device.kind !== 'kitchen' ? (
        <Outlet />
      ) : (
        <CounterRoot />
      )
    }
    const routes = withRealChildren((children) =>
      children.map((route) =>
        route.path === '/counter'
          ? {
              path: '/counter',
              Component: CounterBranch,
              children: [
                { index: true, Component: CounterRoot },
                {
                  path: 'expenses',
                  Component: () => <div data-testid="counter-expenses">Expenses</div>,
                },
              ],
            }
          : route,
      ),
    )
    expect(realPaths(routes)).toContain('/counter/expenses')

    storeTabletSession()
    const counter = await visit(
      '/counter/expenses',
      { status: 'counter', device: COUNTER },
      true,
      routes,
    )
    expect(counter.router.state.location.pathname).toBe('/counter/expenses')
    expect(screen.getByTestId('counter-expenses')).toBeInTheDocument()
    cleanup()

    const expenses = watchFor('[data-testid=counter-expenses]')
    const kitchen = await visit(
      '/counter/expenses',
      { status: 'counter', device: KITCHEN },
      true,
      routes,
    )
    await waitFor(() => expect(kitchen.router.state.location.pathname).toBe('/kitchen'))
    cleanup()
    localStorage.clear()

    const person = await visit('/counter/expenses', PERSON, true, routes)
    await waitFor(() => expect(person.router.state.location.pathname).toBe('/admin'))
    expect(expenses.seen).toBe(false)
    expenses.stop()
  })
})

describe('with a-tablet-keeps-its-login off', () => {
  it('shows the sign-in form on a set-up tablet, as before', async () => {
    storeTabletSession()
    const { router, password } = await visit(
      '/sign-in',
      { status: 'counter', device: COUNTER },
      false,
    )
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(password.seen).toBe(true)
  })

  it('shows the sign-in form while a stored tablet session resolves, as before', async () => {
    storeTabletSession()
    const { password } = await visit('/sign-in', { status: 'loading' }, false)
    expect(password.seen).toBe(true)
  })
})
