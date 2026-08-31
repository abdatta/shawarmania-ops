import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Outlet, RouterProvider, createMemoryRouter } from 'react-router'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { NavAttentionBadge } from '@/features/attention/nav-badge'
import { roleSurfaceRoutes } from '@/routes/surfaces'
import { SessionContext } from '@/session/context'
import { chooseOutlet } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

/**
 * What the merge (#48) has to be true for, over and above the two channels'
 * own suites.
 *
 *  1. **The switch hides nothing.** The navigation entry badges the sum, and
 *     each segment carries its own count without being selected. A tab reading
 *     three over a page showing one is the exact defect the outlet chips below
 *     were built to avoid, one level up (spec: attention-badges).
 *  2. **The channel is an address.** A link opens on the channel it names, the
 *     retired per-channel URLs still land somewhere useful, and the entry with
 *     no channel in it opens on the one holding work.
 *  3. **Only the container is shared.** A repair on one channel leaves the
 *     other's health, waiting work and history exactly as they were — which is
 *     the assertion that stops this merge if it fails.
 */

type Adapters = ReturnType<typeof createMockAdapters>

/**
 * The real route table, under the role branch it actually hangs from.
 *
 * Built rather than mocked because two of the things under test are routing:
 * the gate lookup for the merged path, and the redirects that replaced the two
 * retired addresses. A hand-written `<Route>` would prove neither.
 */
function renderApp(at: string, adapters: Adapters) {
  const router = createMemoryRouter(
    [{ path: '/demo/:roleSegment', element: <Outlet />, children: roleSurfaceRoutes }],
    { initialEntries: [at] },
  )
  render(
    <SessionContext.Provider value={demoSessionFor('super_admin')}>
      <AdaptersContext.Provider value={adapters}>
        <NavAttentionBadge source="delivery-needs-you" surface="Delivery" />
        <RouterProvider router={router} />
      </AdaptersContext.Provider>
    </SessionContext.Provider>,
  )
  return router
}

/**
 * The same adapters, answering a fixed amount of waiting work per cell.
 *
 * A cell is one channel at one outlet, which is the grain everything on this
 * surface is a sum of. Kanchrapara defaults to nothing so a test that only
 * cares about one outlet reads cleanly.
 */
function countingAdapters(counts: {
  zomato: number
  swiggy: number
  zomatoElsewhere?: number
  swiggyElsewhere?: number
}): Adapters {
  const real = createMockAdapters('super_admin')
  const answer = (here: number, elsewhere: number) => async () => [
    { outletId: OUTLET_KALYANI_ID, needing: here },
    { outletId: OUTLET_KANCHRAPARA_ID, needing: elsewhere },
  ]
  return {
    ...real,
    aggregatorSync: {
      ...real.aggregatorSync,
      countNeedsOwner: answer(counts.zomato, counts.zomatoElsewhere ?? 0),
    },
    swiggySync: {
      ...real.swiggySync,
      countNeedsOwner: answer(counts.swiggy, counts.swiggyElsewhere ?? 0),
    },
  }
}

function segment(channel: 'zomato' | 'swiggy'): HTMLElement {
  return screen.getByTestId(`delivery-channel-${channel}`)
}

describe('the Delivery surface, as one entry over two channels', () => {
  /**
   * The two controls nest, and each row decomposes the one above it.
   *
   * The grid below is 1 / 2 / 3 / 4 across two channels and two outlets, for the
   * reason the demo's own fixture is: a symmetric grid shows identical digits
   * whichever way round the arithmetic works, so it proves nothing.
   */
  it('badges the entry with everything, splits it by outlet, then by channel', async () => {
    renderApp(
      '/demo/owner/ledger/delivery/zomato',
      countingAdapters({ zomato: 1, swiggy: 3, zomatoElsewhere: 2, swiggyElsewhere: 4 }),
    )

    // The tab's number is every channel at every outlet.
    await waitFor(() =>
      expect(screen.getByTestId('nav-badge-delivery-needs-you')).toHaveTextContent('10'),
    )

    // The chips split that by outlet, across BOTH channels — 1+3 here, 2+4
    // there — and they add back up to the tab. A chip means the same thing on
    // this surface as it does on attendance: this outlet's work on this screen.
    expect(
      await screen.findByTestId(`delivery-outlet-needing-${OUTLET_KALYANI_ID}`),
    ).toHaveTextContent('4')
    expect(
      screen.getByTestId(`delivery-outlet-needing-${OUTLET_KANCHRAPARA_ID}`),
    ).toHaveTextContent('6')

    // And the switch splits the SELECTED outlet's chip by channel: 1 and 3 add
    // back up to Kalyani's 4, not to the tab's 10.
    expect(screen.getByTestId('delivery-needing-zomato')).toHaveTextContent('1')
    expect(screen.getByTestId('delivery-needing-swiggy')).toHaveTextContent('3')
    expect(segment('zomato')).toHaveAttribute('aria-pressed', 'true')
    expect(segment('swiggy')).toHaveAttribute('aria-pressed', 'false')

    // Spoken, not only shown. A count that reads as a bare digit to a screen
    // reader has told somebody a number without saying what it counts.
    expect(within(segment('swiggy')).getByText(/^Swiggy: 3 items need you$/)).toBeInTheDocument()
  })

  it('re-splits the switch when the reader moves to another outlet', async () => {
    const user = userEvent.setup()
    renderApp(
      '/demo/owner/ledger/delivery/zomato',
      countingAdapters({ zomato: 1, swiggy: 3, zomatoElsewhere: 2, swiggyElsewhere: 4 }),
    )

    expect(await screen.findByTestId('delivery-needing-swiggy')).toHaveTextContent('3')

    // The switch sits beneath the chips, and everything beneath them is about
    // the chosen outlet. A switch that kept showing every outlet's total would
    // be the one control on the page that ignored the filter above it.
    await user.click(screen.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`))

    await waitFor(() =>
      expect(screen.getByTestId('delivery-needing-swiggy')).toHaveTextContent('4'),
    )
    expect(screen.getByTestId('delivery-needing-zomato')).toHaveTextContent('2')
  })

  it('says what waits behind a channel nobody has selected', async () => {
    renderApp('/demo/owner/ledger/delivery/zomato', countingAdapters({ zomato: 0, swiggy: 2 }))

    // Nothing on the selected channel, two behind the other — and the reader
    // finds that out without a single tap.
    expect(await screen.findByTestId('delivery-needing-swiggy')).toHaveTextContent('2')
    expect(screen.queryByTestId('delivery-needing-zomato')).not.toBeInTheDocument()
  })

  it('opens on the channel a link names', async () => {
    renderApp('/demo/owner/ledger/delivery/swiggy', createMockAdapters('super_admin'))

    expect(await screen.findByTestId('delivery-channel-swiggy')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Swiggy's page, not Zomato's dressed as it: the child channel Zomato tows
    // is absent, which is the difference the shared component is configured by.
    expect(screen.queryByTestId('hyperpure-health')).not.toBeInTheDocument()
  })

  it.each([
    ['zomato', '/demo/owner/ledger/zomato'],
    ['swiggy', '/demo/owner/ledger/swiggy'],
  ] as const)('sends the retired %s address to its own channel', async (channel, from) => {
    // The old gates are `hidden`, so these paths would answer a URL the owner
    // may have on their phone with a 404. They redirect to the channel they
    // name rather than to whatever the arrival rule would have picked.
    const router = renderApp(from, createMockAdapters('super_admin'))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/demo/owner/ledger/delivery/${channel}`),
    )
    expect(await screen.findByTestId(`delivery-channel-${channel}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('opens the entry on the one channel holding work, and says so in the address', async () => {
    // Tapping the navigation entry names no channel. Where exactly one has
    // something waiting there is an unambiguous answer, and the address is
    // rewritten to it so copying the URL or reloading lands in the same place.
    const router = renderApp(
      '/demo/owner/ledger/delivery',
      countingAdapters({ zomato: 0, swiggy: 2 }),
    )

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/demo/owner/ledger/delivery/swiggy'),
    )
    expect(segment('swiggy')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the entry on the first channel when the answer is not unambiguous', async () => {
    const router = renderApp(
      '/demo/owner/ledger/delivery',
      countingAdapters({ zomato: 2, swiggy: 1 }),
    )

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/demo/owner/ledger/delivery/zomato'),
    )
  })

  it('puts the chosen channel in the address, so it can be sent to somebody', async () => {
    const user = userEvent.setup()
    const router = renderApp(
      '/demo/owner/ledger/delivery/zomato',
      createMockAdapters('super_admin'),
    )

    await user.click(await screen.findByTestId('delivery-channel-swiggy'))

    expect(router.state.location.pathname).toBe('/demo/owner/ledger/delivery/swiggy')
  })

  /**
   * The test that can stop the merge.
   *
   * `aggregator-settlement-sync` requires the channels to stay independent in
   * substance — separate adapter instances against separate sessions — and the
   * merge relaxes that for the container alone. If a Swiggy repair can quiet
   * Zomato, the container is sharing something it must not.
   */
  it('leaves a lapsed Zomato lapsed when Swiggy is repaired', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    renderApp('/demo/owner/ledger/delivery/swiggy', adapters)

    // Kanchrapara starts with both channels signed out and a week that will not
    // reconcile on each — the state where an accidental sharing would show.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    const zomatoBefore = await adapters.aggregatorSync.getHealth(OUTLET_KANCHRAPARA_ID)
    const zomatoHistoryBefore = await adapters.aggregatorSync.listEvents(OUTLET_KANCHRAPARA_ID)

    await user.click(await screen.findByTestId('needs-reconnect-swiggy'))
    await waitFor(() => expect(screen.getByText('Swiggy sent you a code')).toBeInTheDocument(), {
      timeout: 8_000,
    })
    await user.type(screen.getByLabelText(/one time password.*swiggy/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign back in/i }))
    await waitFor(
      async () => {
        const events = await adapters.swiggySync.listEvents(OUTLET_KANCHRAPARA_ID)
        expect(events.find((row) => row.event.kind === 'session-lapsed')?.resolvedAt).not.toBeNull()
      },
      { timeout: 8_000 },
    )

    // Zomato's own records did not move: no code typed for Swiggy signed
    // anything else in.
    const zomatoAfter = await adapters.aggregatorSync.getHealth(OUTLET_KANCHRAPARA_ID)
    expect(zomatoAfter).toEqual(zomatoBefore)
    expect(await adapters.aggregatorSync.listEvents(OUTLET_KANCHRAPARA_ID)).toEqual(
      zomatoHistoryBefore,
    )

    // And the surface agrees, through the same switch: Zomato is still signed
    // out and still asking.
    await user.click(segment('zomato'))
    // Matched by the action rather than by which repair card it is: Zomato's
    // card collapses with Hyperpure's when both are out, and which of the two
    // variants shows is not what this test is about.
    expect(await screen.findByRole('button', { name: /reconnect zomato/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /does not add up/i })).toBeInTheDocument()
  }, 40_000)
})
