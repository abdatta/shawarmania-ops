import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDemoScopeActive } from '@/data-access/demo-scope'
import {
  createDemoStore,
  createMockAdapters,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
  OUTLET_MISTAKE_ID,
} from '@/data-access/mock'
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
    // The card's own heading, not the switcher option that carries the same
    // name — the assertion is that the outlet's figures rendered.
    expect(await screen.findByRole('heading', { name: 'Shawarmania Kalyani' })).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Role switcher: Admin.
    await user.click(screen.getByRole('link', { name: 'Admin' }))
    expect(await screen.findByText('Outlet details')).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()

    // Biller. The counter chrome names whoever holds the open shift, which the
    // demo store starts with — a walkthrough lands able to ring a bill rather
    // than behind a PIN nobody was handed.
    await user.click(screen.getByRole('link', { name: 'Biller' }))
    expect(await screen.findByTestId('shift-status')).toHaveTextContent('Demo Biller')
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
    const today = createDemoStore().today
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
      username: 'demo.someone',
      role: 'employee',
      outletIds: [OUTLET_KALYANI_ID],
    })
    await adapters.accounts.reissue(provisioned.profileId)
    await adapters.accounts.setActive(provisioned.profileId, false)
    await adapters.accounts.setActive(provisioned.profileId, true)
    await adapters.accounts.listAccounts()

    // The operational and counter adapters this change added, reads and writes
    // alike. Settling a bill and closing a day are the two writes that would
    // matter most if a demo session ever reached Supabase, so neither is
    // assumed unreachable.
    const outletId = OUTLET_KALYANI_ID
    const menu = await adapters.menu.listMenu(outletId)
    const firstItem = menu[0]?.items[0]
    if (!firstItem) throw new Error('fixtures must contain a menu item')
    await adapters.menu.setItemAvailability(firstItem.id, false)
    await adapters.menu.setItemAvailability(firstItem.id, true)
    await adapters.menu.createItem({
      outletId,
      categoryId: menu[0]!.category.id,
      name: 'Demo Extra',
      pricePaise: 10000,
      isVeg: true,
    })

    const stock = await adapters.inventory.listItems(outletId)
    const firstStock = stock[0]
    if (!firstStock) throw new Error('fixtures must contain a stock item')
    await adapters.inventory.listMovements(firstStock.id)
    await adapters.inventory.getItem(firstStock.id)
    await adapters.inventory.recordMovement({
      inventoryItemId: firstStock.id,
      movementType: 'used',
      quantity: 1,
      businessDate: today,
    })

    await adapters.expenses.listExpenses(outletId, today)
    await adapters.expenses.createExpense({
      outletId,
      businessDate: today,
      category: 'other',
      amountPaise: 10000,
      paymentMethod: 'cash',
    })

    const billerBilling = createMockAdapters('biller').billing
    const openShift = billerBilling.getCounterState().shift
    if (!openShift) throw new Error('the demo store must start with a shift open')
    await billerBilling.listBillers(outletId)
    await billerBilling.settleBill({
      clientId: '0e000000-0000-4000-8000-000000000001',
      outletId,
      shiftId: openShift.id,
      businessDate: today,
      payments: [{ method: 'cash', amountPaise: firstItem.price_paise }],
      lines: [
        {
          menuItemId: firstItem.id,
          itemName: firstItem.name,
          unitPricePaise: firstItem.price_paise,
          quantity: 1,
        },
      ],
    })
    await billerBilling.correctBillPayment('0e000000-0000-4000-8000-000000000001', 0, [
      { method: 'upi', amountPaise: firstItem.price_paise },
    ])

    await adapters.dailyCash.getDay(outletId, today)
    await adapters.dailyCash.recordWithdrawal({
      outletId,
      businessDate: today,
      amountPaise: 10000,
      withdrawnBy: 'Demo Owner',
    })
    await adapters.dailyCash.closeDay({
      outletId,
      businessDate: today,
      actualClosingPaise: 100000,
    })

    // The owner's own adapters. `insights` reads across both outlets and
    // `alerts` writes, so between them they cover the two shapes that would
    // leak if a demo session ever reached Supabase.
    const period = { from: today, to: today }
    await adapters.insights.outletDay(outletId, today)
    await adapters.insights.periodSummary(outletId, period, 'consumption')
    await adapters.insights.comparison([outletId, OUTLET_KANCHRAPARA_ID], period, 'cash')

    await adapters.alerts.listAlerts()
    const raised = await adapters.alerts.raiseAlert({
      outletId,
      category: 'other',
      priority: 'normal',
      subject: 'Demo alert',
      message: 'Raised while proving the demo cannot reach the network.',
    })
    await adapters.alerts.getAlert(raised.id)
    await adapters.alerts.respond(raised.id, 'Seen.')
    await adapters.alerts.setStatus(raised.id, 'acknowledged')

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
    const user = userEvent.setup()
    renderDemo('/demo/owner')
    const banner = await screen.findByTestId('demo-banner')

    // The role switcher's four links all stay inside /demo.
    const switcher = within(banner).getByRole('navigation', { name: 'Demo role switcher' })
    const links = switcher.querySelectorAll('a')
    expect(links).toHaveLength(4)
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/demo\//)
    }

    // The one link that does not is the way out, and leaving is not dismissing:
    // it goes to the root, so the banner goes only once the demo it warns about
    // has gone with it.
    expect(screen.getByTestId('demo-exit')).toHaveAttribute('href', '/')

    // The invariant itself, rather than a proxy for it: press **every** control
    // in this strip and the strip is still there afterwards. Counting buttons
    // used to stand in for this, and stopped being able to the moment the
    // banner gained one that does something other than dismiss it.
    const controls = [...banner.querySelectorAll('button')]
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      await user.click(control)
      expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
      // Anything that opened a dialog is dismissed again, so the next control
      // is genuinely clicked rather than blocked by an overlay.
      const cancel = screen.queryByRole('button', { name: 'Cancel' })
      if (cancel) await user.click(cancel)
    }
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
  })

  it('leaves the demo entirely rather than hiding the banner', async () => {
    const user = userEvent.setup()
    const { router } = renderDemo('/demo/owner')
    await screen.findByTestId('demo-banner')

    await user.click(screen.getByTestId('demo-exit'))

    // Out of the demo tree, so the tripwire stands down and the banner is gone
    // because the fabricated data is.
    //
    // Asserted as "no longer under /demo" rather than "parked at /", which is
    // what it used to say. The exit still points at the root — that href is
    // asserted above and has not moved — but since
    // the-root-resolves-instead-of-greeting the root resolves onward instead of
    // rendering a card, so a visitor with no session continues to sign-in. That
    // is the intended destination and not demo mode's business; what demo mode
    // owes is that leaving leaves.
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/^\/demo/))
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
    expect(isDemoScopeActive()).toBe(false)

    // And where it actually landed, stated once so the chain is readable rather
    // than implied by a negative.
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('an unknown role segment is absent, not greyed out', async () => {
    renderDemo('/demo/nonsense')
    expect(await screen.findByText('That page does not exist')).toBeInTheDocument()
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
  })

  it('a deep link to a hidden surface lands on not-found inside the shell', async () => {
    // `staff-profile` is `hidden`. My shift used to be, and became a demo
    // surface with ui-billing-lifecycle. The assertion follows whichever gate
    // remains hidden rather than pinning a surface that is expected to evolve.
    renderDemo('/demo/staff/profile')
    expect(await screen.findByText('That page does not exist')).toBeInTheDocument()
    // Inside the shell: the demo banner is still there, because the URL is
    // still a demo URL — the surface is what is absent.
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
  })
})
