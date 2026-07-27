import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDemoScopeActive } from '@/data-access/demo-scope'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
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

    // Counter.
    await user.click(screen.getByRole('link', { name: 'Counter' }))
    expect(await screen.findByTestId('shift-status')).toHaveTextContent('No shift open')
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Staff.
    await user.click(screen.getByRole('link', { name: 'Staff' }))
    expect(await screen.findByText('Hello, Demo Staff')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Every mock adapter method, including the ones no home calls yet.
    const adapters = createMockAdapters()
    await adapters.outlets.listOutlets()
    await adapters.outlets.getOutlet(OUTLET_KALYANI_ID)
    await adapters.outlets.getOutlet('00000000-0000-4000-a000-00000000ffff')

    expect(fetchSpy).not.toHaveBeenCalled()
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
