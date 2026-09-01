import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OutletsSurface } from './outlets-surface'

/**
 * The Franchise Admin's Outlets surface, and what an outlet card says (#51).
 *
 * The manager had no Outlets surface at all until this change, and the gap
 * became a hole when Tablets stopped being a top-level entry: `admin-devices`
 * is the only place a counter setup code is minted, so this is their one route
 * to the repair they cannot make anywhere else.
 *
 * **Everything asserted here about what is *offered* is courtesy, not the
 * boundary.** Create, edit, close, reopen and delete are refused by
 * `outlets_insert`, `outlets_update` and `outlets_delete` in Postgres, and
 * `supabase/tests/09_outlet_and_staff_setup.sql` proves it against requests
 * that never went near a screen.
 */

function sessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderAs(role: Role) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={createMockAdapters(role)}>
          <OutletsSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

const WRITES = [/Capture position here/, /Capture again/, /^Edit$/, /Mark closed/, /Reopen/]

describe('a manager’s outlets', () => {
  it('lists the outlets their assignments name, and no others', async () => {
    renderAs('franchise_admin')

    const list = await screen.findByTestId('outlet-list')
    // The demo manager runs Kalyani. The scoping is the adapter's, mirroring
    // `outlets_select` — this surface passes no filter of its own.
    expect(within(list).getByText('Shawarmania Kalyani')).toBeInTheDocument()
    expect(within(list).queryByText('Shawarmania Kanchrapara')).toBeNull()
  })

  it('offers no way to create, edit, close or delete one', async () => {
    renderAs('franchise_admin')

    await screen.findByTestId('outlet-list')
    expect(screen.queryByTestId('add-outlet')).toBeNull()
    for (const write of WRITES) {
      expect(screen.queryByRole('button', { name: write })).toBeNull()
    }
  })

  it('does not list a closed outlet they could not reopen', async () => {
    renderAs('franchise_admin')

    const list = await screen.findByTestId('outlet-list')
    expect(within(list).queryByText(/created by mistake/i)).toBeNull()
  })

  it('reaches the tablet administration for the outlet it stands in', async () => {
    renderAs('franchise_admin')

    await screen.findByTestId('outlet-list')
    // Not the shared Tablets page with its picker still on it: the address
    // names the outlet, so it opens on this counter.
    expect(screen.getByTestId('tablets-kalyani')).toHaveAttribute(
      'href',
      `/demo/admin/devices/${OUTLET_KALYANI_ID}`,
    )
  })
})

describe('the owner’s outlets', () => {
  it('keeps every write it had', async () => {
    renderAs('super_admin')

    await screen.findByTestId('outlet-list')
    expect(screen.getByTestId('add-outlet')).toBeInTheDocument()
    for (const write of [/Capture/, /^Edit$/, /Mark closed|Reopen/]) {
      expect(screen.getAllByRole('button', { name: write }).length).toBeGreaterThan(0)
    }
  })

  it('reaches each outlet’s own tablets, not a shared page', async () => {
    renderAs('super_admin')

    await screen.findByTestId('outlet-list')
    expect(screen.getByTestId('tablets-kalyani')).toHaveAttribute(
      'href',
      `/demo/owner/devices/${OUTLET_KALYANI_ID}`,
    )
    expect(screen.getByTestId('tablets-kanchrapara')).toHaveAttribute(
      'href',
      `/demo/owner/devices/${OUTLET_KANCHRAPARA_ID}`,
    )
  })
})

describe('what an outlet is raising', () => {
  /**
   * The Alerts surface was deleted in the same change, so this is text on the
   * card and nothing to click through to. Asserted as such, because a chip
   * pointing at a screen that no longer exists is what that change was getting
   * rid of.
   */
  it('is stated on the card, and is not a link', async () => {
    renderAs('super_admin')

    await screen.findByTestId('outlet-list')
    const raising = screen.getByTestId('raising-kalyani')
    expect(raising).toHaveTextContent(/What this outlet is raising/i)
    expect(within(raising).queryByRole('link')).toBeNull()
    expect(within(raising).queryByRole('button')).toBeNull()
  })

  it('names what the counter tablet is holding', async () => {
    renderAs('super_admin')

    await screen.findByTestId('outlet-list')
    // The demo tablets carry unsent bills on purpose, so the line has a
    // subject from the moment the surface opens.
    expect(await screen.findByTestId('raising-kalyani')).toHaveTextContent(
      /holding 1 bill it has not managed to send/i,
    )
    expect(screen.getByTestId('raising-kanchrapara')).toHaveTextContent(
      /holding 3 bills it has not managed to send/i,
    )
  })

  it('says an outlet with no tablet cannot bill, and where the code comes from', async () => {
    const adapters = createMockAdapters('super_admin')
    adapters.counter.listDevices = () => Promise.resolve([])
    render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <OutletsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('raising-kalyani')).toHaveTextContent(
      /No tablet is set up at this counter.*Tablets issues a setup code/i,
    )
  })

  it('says an unreadable tablet is unreadable, never that there is none', async () => {
    const adapters = createMockAdapters('super_admin')
    adapters.counter.listDevices = () => Promise.reject(new Error('offline'))
    render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <OutletsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    // Sending somebody to mint a setup code for hardware standing there working
    // is worse than saying nothing.
    const raising = await screen.findByTestId('raising-kalyani')
    expect(raising).toHaveTextContent(/could not be read just now/i)
    expect(raising).not.toHaveTextContent(/No tablet is set up/i)
  })

  it('says so plainly when an outlet is raising nothing', async () => {
    const adapters = createMockAdapters('super_admin')
    adapters.counter.listDevices = () =>
      Promise.resolve([
        {
          id: 'device-1',
          outletId: OUTLET_KALYANI_ID,
          label: 'Counter tablet',
          setUpAt: '2026-08-01T00:00:00Z',
          lastSeenAt: new Date().toISOString(),
          lastReportedUnresolved: 0,
          lastReportedOldestUnresolvedAt: null,
        },
      ])
    render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <OutletsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    // An absent list would leave the reader unable to tell "nothing wrong" from
    // "not loaded", on a screen whose whole question is whether the shop is
    // all right.
    expect(await screen.findByTestId('raising-kalyani')).toHaveTextContent(
      /Nothing\. The counter tablet is reporting in and holding no unsent bills\./i,
    )
  })
})
