import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createMockAdapters,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
  OUTLET_MISTAKE_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OutletPage, OutletsSurface } from './outlets-surface'

/**
 * The Franchise Admin's Outlets surface (#51), as a list and a page per outlet
 * since outlets-one-at-a-time.
 *
 * The manager had no Outlets surface at all until #51, and they have one because
 * a counter setup code is minted nowhere else: since outlets-one-at-a-time the
 * tablets are a section of the outlet's own page, so this is their one route to
 * the repair they cannot make anywhere else.
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

function renderAs(role: Role, at = '/outlets') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={createMockAdapters(role)}>
          <Routes>
            <Route path="/outlets" element={<OutletsSurface />} />
            <Route path="/outlets/:outletId" element={<OutletPage />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

const OWNER_WRITES = ['edit-kalyani', 'capture-kalyani', 'close-kalyani', 'reopen-kalyani']

describe('a manager’s outlets', () => {
  it('lists the outlets their assignments name, and no others', async () => {
    renderAs('franchise_admin')

    const list = await screen.findByTestId('outlet-list')
    // The demo manager runs Kalyani. The scoping is the adapter's, mirroring
    // `outlets_select` — this surface passes no filter of its own.
    expect(within(list).getByText('Shawarmania Kalyani')).toBeInTheDocument()
    expect(within(list).queryByText('Shawarmania Kanchrapara')).toBeNull()
  })

  it('lists their one outlet as a list, not a page, so Back never bounces', async () => {
    renderAs('franchise_admin')

    const list = await screen.findByTestId('outlet-list')
    expect(within(list).getAllByRole('link')).toHaveLength(1)
  })

  it('does not list a closed outlet they could not reopen', async () => {
    renderAs('franchise_admin')

    const list = await screen.findByTestId('outlet-list')
    expect(within(list).queryByText(/created by mistake/i)).toBeNull()
  })

  it('offers no way to create an outlet', async () => {
    renderAs('franchise_admin')

    await screen.findByTestId('outlet-list')
    expect(screen.queryByTestId('add-outlet')).toBeNull()
  })

  it('offers no way to edit, capture, close or delete their outlet on its page', async () => {
    renderAs('franchise_admin', `/outlets/${OUTLET_KALYANI_ID}`)

    await screen.findByTestId('outlet-kalyani')
    for (const control of [...OWNER_WRITES, 'delete-kalyani']) {
      expect(screen.queryByTestId(control)).toBeNull()
    }
  })

  it('administers the tablets standing at their outlet, on its page', async () => {
    renderAs('franchise_admin', `/outlets/${OUTLET_KALYANI_ID}`)

    const tablets = await screen.findByTestId('outlet-tablets')
    expect(await within(tablets).findByTestId('add-tablet')).toBeInTheDocument()
    expect(within(tablets).getByRole('button', { name: 'Edit Counter tablet' })).toBeInTheDocument()
    expect(
      within(tablets).getByRole('button', { name: 'Remove Counter tablet' }),
    ).toBeInTheDocument()
  })

  it('sees nothing of an outlet no assignment of theirs names', async () => {
    renderAs('franchise_admin', `/outlets/${OUTLET_KANCHRAPARA_ID}`)

    expect(await screen.findByText('This outlet is not one you can see.')).toBeInTheDocument()
    expect(screen.queryByText('Shawarmania Kanchrapara')).toBeNull()
    expect(screen.queryByTestId('outlet-tablets')).toBeNull()
  })
})

describe('the owner’s outlets', () => {
  it('keeps every write it had', async () => {
    renderAs('super_admin', `/outlets/${OUTLET_KALYANI_ID}`)

    await screen.findByTestId('outlet-kalyani')
    for (const control of ['edit-kalyani', 'capture-kalyani', 'close-kalyani']) {
      expect(screen.getByTestId(control)).toBeInTheDocument()
    }
  })

  it('may add an outlet from the list', async () => {
    renderAs('super_admin')

    expect(await screen.findByTestId('add-outlet')).toBeInTheDocument()
  })

  it('shows no tablets on an outlet that is not trading', async () => {
    renderAs('super_admin', `/outlets/${OUTLET_MISTAKE_ID}`)

    // A closed outlet has no counter to administer; its tablets are moved or
    // removed from a trading outlet's page.
    await screen.findByTestId('outlet-demo-mistake')
    expect(screen.queryByTestId('outlet-tablets')).toBeNull()
  })

  it('opens each outlet’s own page from its row, not a shared one', async () => {
    renderAs('super_admin')

    expect(await screen.findByTestId('open-kalyani')).toHaveAttribute(
      'href',
      `/outlets/${OUTLET_KALYANI_ID}`,
    )
    expect(screen.getByTestId('open-kanchrapara')).toHaveAttribute(
      'href',
      `/outlets/${OUTLET_KANCHRAPARA_ID}`,
    )
  })
})
