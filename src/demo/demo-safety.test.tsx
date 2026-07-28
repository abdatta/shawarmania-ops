import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDemoScopeActive } from '@/data-access/demo-scope'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_MISTAKE_ID } from '@/data-access/mock'
import { getSupabaseClient } from '@/data-access/supabase'
import { appRoutes } from '@/routes'

/**
 * The unit half of the safety proof (design D4, layer 3): mount the real
 * route tree in demo mode, exercise every mock adapter method, and prove
 * that nothing touched the network and that the Supabase client trips.
 * The network-level restatement runs in Playwright (e2e/demo.spec.ts).
 */

function renderDemo(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('demo mode safety', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    sessionStorage.clear()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    sessionStorage.clear()
  })

  it('walks all four role shells off mock data with zero network requests', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/owner')

    // Owner home, served by the mock outlets adapter (async — the fixture
    // rows land a microtask after the header).
    expect(await screen.findByText('All outlets')).toBeInTheDocument()
    expect(await screen.findByText('Shawarmania Kalyani')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Role switcher: Admin.
    await user.click(screen.getByRole('link', { name: 'Admin' }))
    expect(await screen.findByText('Outlet details')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Biller.
    await user.click(screen.getByRole('link', { name: 'Biller' }))
    expect(await screen.findByTestId('shift-status')).toHaveTextContent('No shift open')
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Staff.
    await user.click(screen.getByRole('link', { name: 'Staff' }))
    expect(await screen.findByText('Hello, Demo Staff')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Every mock adapter method, including the ones no home calls yet — and
    // emphatically including the writes. A demo that can provision an account
    // is exactly the case where a real client would leak, so it is exercised
    // here rather than assumed unreachable.
    const adapters = createMockAdapters()
    await adapters.outlets.listOutlets()
    await adapters.outlets.getOutlet(OUTLET_KALYANI_ID)
    await adapters.outlets.getOutlet('00000000-0000-4000-a000-00000000ffff')

    // Deletion, both ways. `outlets` is the one table a client may delete
    // from, which makes it the one adapter method that could destroy something
    // real if a demo session ever reached Supabase — so both outcomes are
    // exercised here rather than assumed unreachable.
    await adapters.outlets.outletReferences(OUTLET_KALYANI_ID)
    await expect(adapters.outlets.deleteOutlet(OUTLET_KALYANI_ID)).rejects.toThrow(/still attached/)
    await adapters.outlets.deleteOutlet(OUTLET_MISTAKE_ID)

    const provisioned = await adapters.accounts.provision({
      fullName: 'Demo Someone',
      email: 'demo.someone@example.com',
      role: 'employee',
      outletId: OUTLET_KALYANI_ID,
    })
    await adapters.accounts.reissue(provisioned.profileId)
    await adapters.accounts.setActive(provisioned.profileId, false)
    await adapters.accounts.setActive(provisioned.profileId, true)
    await adapters.accounts.listAccounts()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offers no sign out: there is no session to end', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/owner')
    await screen.findByTestId('demo-banner')

    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()

    // Including on the Biller shell, whose chrome is built separately.
    await user.click(screen.getByRole('link', { name: 'Biller' }))
    await screen.findByTestId('shift-status')
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('runs the promoted People surface off mock data, writes included', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/owner/people')

    // `owner-people` is `live`, so it renders in demo mode too — served by the
    // mock accounts adapter, with no path to Supabase.
    expect(await screen.findByText('Demo Manager')).toBeInTheDocument()
    expect(screen.getByText('Awaiting activation')).toBeInTheDocument()

    // A write, through the real UI: the code panel appears and no request is made.
    await user.click(screen.getAllByRole('button', { name: /^Actions for /i })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'New code' })[0]!)
    expect(await screen.findByTestId('issued-code')).toBeInTheDocument()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(isDemoScopeActive()).toBe(true)
  })

  it('keeps account management away from the roles that never issue codes', async () => {
    renderDemo('/demo/biller/people')
    expect(await screen.findByText('That page does not exist')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
  })

  it('arms the tripwire while the demo tree is mounted and stands down after', async () => {
    const { unmount } = renderDemo('/demo/owner')
    await screen.findByTestId('demo-banner')

    expect(isDemoScopeActive()).toBe(true)
    expect(() => getSupabaseClient()).toThrow(/Demo mode is active/)

    unmount()
    expect(isDemoScopeActive()).toBe(false)
  })

  it('mock adapter results are copies — mutating one cannot corrupt the fixtures', async () => {
    const adapters = createMockAdapters()
    const first = await adapters.outlets.listOutlets()
    const target = first[0]
    if (!target) throw new Error('fixtures must contain outlets')
    target.name = 'MUTATED'

    const second = await adapters.outlets.listOutlets()
    expect(second.map((outlet) => outlet.name)).not.toContain('MUTATED')
  })

  it('the demo banner offers no dismiss affordance', async () => {
    renderDemo('/demo/owner')
    const banner = await screen.findByTestId('demo-banner')

    // The only interactive elements inside the banner are the role switcher
    // links — no button of any kind, nothing that could hide it.
    expect(banner.querySelectorAll('button')).toHaveLength(0)
    const links = banner.querySelectorAll('a')
    expect(links).toHaveLength(4)
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/demo\//)
    }
  })

  it('an unknown role segment is absent, not greyed out', async () => {
    renderDemo('/demo/nonsense')
    expect(await screen.findByText('That page does not exist')).toBeInTheDocument()
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
  })

  it('a deep link to a hidden surface lands on not-found inside the shell', async () => {
    renderDemo('/demo/admin/inventory')
    expect(await screen.findByText('That page does not exist')).toBeInTheDocument()
    // Inside the shell: the demo banner is still there, because the URL is
    // still a demo URL — the surface is what is absent.
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
  })
})
