import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { ALL_OFF_SERVICE_SETTINGS } from '@/domain'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KANCHRAPARA_ID,
  OUTLET_KALYANI_ID,
} from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OutletPage } from './outlets-surface'

/**
 * How an outlet serves, on its own page (each-outlet-chooses-how-it-serves,
 * #60): two switches for a newcomer, settings that grow beneath a switch only
 * while it is on, and read-only answers for a manager.
 *
 * Most of these grow a page from nothing chosen, which no demo outlet is any
 * more: Kalyani carries the owner's own settings and Kanchrapara every switch
 * on. So these tests clear Kalyani's choices first and say so, rather than
 * borrowing whatever the demo happens to hold.
 */

/** The demo, with Kalyani's order settings back to a newcomer's. */
function nothingChosenAtKalyani() {
  const data = createDemoData()
  data.store.serviceSettings.set(OUTLET_KALYANI_ID, { ...ALL_OFF_SERVICE_SETTINGS })
  return data
}

function sessionFor(role: Role, mode: 'demo' | 'real' = 'demo'): Session {
  const persona = personaFixtures[role]
  const core = {
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
  }
  return mode === 'demo' ? { mode, ...core, persona } : { mode, ...core }
}

function renderPage(
  outletId: string,
  {
    role = 'super_admin' as Role,
    mode = 'demo' as 'demo' | 'real',
    data = nothingChosenAtKalyani(),
  } = {},
) {
  render(
    <MemoryRouter initialEntries={[`/outlets/${outletId}`]}>
      <SessionContext.Provider value={sessionFor(role, mode)}>
        <AdaptersContext.Provider value={createMockAdapters(role, data)}>
          <Routes>
            <Route path="/outlets/:outletId" element={<OutletPage />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return data
}

describe('the outlet page’s Orders', () => {
  it('saves and cancels order settings and shortcuts independently when both have drafts', async () => {
    const person = userEvent.setup()
    const data = renderPage(OUTLET_KALYANI_ID)
    const adapters = createMockAdapters('super_admin', data)
    const original = (await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets
    const collection = await screen.findByRole('switch', { name: 'Collect customer details' })
    await screen.findByTestId('preset-percent-1000')
    await person.click(collection)
    await person.click(screen.getByRole('button', { name: 'Remove the 10% preset' }))
    await person.click(screen.getByTestId('service-save'))
    await screen.findByTestId('service-saved')
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)?.collectCustomerDetails).toBe(false)
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toEqual(original)
    expect(screen.getByTestId('presets-save')).toBeInTheDocument()
    await person.click(collection)
    await person.click(screen.getByTestId('presets-cancel'))
    expect(collection).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('service-save')).toBeInTheDocument()
    expect(screen.getByTestId('preset-percent-1000')).toBeInTheDocument()
    await person.click(screen.getByRole('button', { name: 'Remove the 10% preset' }))
    await person.click(screen.getByTestId('presets-save'))
    await screen.findByTestId('presets-saved')
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toEqual(
      original.slice(1),
    )
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)?.collectCustomerDetails).toBe(false)
    expect(collection).toHaveAttribute('aria-checked', 'true')
    await person.click(screen.getByRole('button', { name: 'Remove the 15% preset' }))
    await person.click(screen.getByTestId('service-cancel'))
    expect(collection).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('presets-save')).toBeInTheDocument()
    expect(screen.queryByTestId('preset-percent-1500')).not.toBeInTheDocument()
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toEqual(
      original.slice(1),
    )
  })

  it.each(['super_admin', 'franchise_admin'] as const)(
    'lets %s save customer collection independently of service types',
    async (role) => {
      const person = userEvent.setup()
      const data = renderPage(OUTLET_KALYANI_ID, { role })
      const control = await screen.findByRole('switch', { name: 'Collect customer details' })
      expect(control).toHaveAttribute('aria-checked', 'true')
      await person.click(control)
      await person.click(screen.getByTestId('service-save'))
      await waitFor(() =>
        expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)?.collectCustomerDetails).toBe(
          false,
        ),
      )
      expect(
        await createMockAdapters(role, data).outlets.getServiceSettings(OUTLET_KALYANI_ID),
      ).toMatchObject({ collectCustomerDetails: false })
      expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)?.dineInOffered).toBe(false)
      expect(control).toHaveAttribute('aria-checked', 'false')
    },
  )
  it('shows customer collection on independently of service choices', async () => {
    renderPage(OUTLET_KALYANI_ID)

    const orders = await screen.findByTestId('service-orders')
    expect(within(orders).getAllByRole('switch')).toHaveLength(2)
    expect(within(orders).getByRole('switch', { name: 'Dine-in and takeaway' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(
      within(orders).getByRole('switch', { name: 'Collect customer details' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('service-offer-dine_in')).toBeNull()
    expect(screen.queryByTestId('service-packaging-switch')).toBeNull()
    // Nothing changed, so nothing to save.
    expect(screen.queryByTestId('service-save')).toBeNull()
  })

  it('sits between Details and Tablets', async () => {
    renderPage(OUTLET_KALYANI_ID)

    await screen.findByTestId('service-orders')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings.indexOf('Orders')).toBe(headings.indexOf('Details') + 1)
    expect(headings).not.toContain('Packaging')
  })

  it('opens each setting’s options inside its own tile, on the other tone', async () => {
    const person = userEvent.setup()
    renderPage(OUTLET_KALYANI_ID)

    await person.click(await screen.findByTestId('service-orders-switch'))
    const outer = screen.getByTestId('service-orders-switch').closest('[data-depth]')!
    const offer = screen.getByTestId('service-offer-dine_in').closest('[data-depth]')!
    expect(outer).toHaveAttribute('data-depth', '1')
    expect(offer).toHaveAttribute('data-depth', '2')
    expect(outer.contains(offer)).toBe(true)
    expect(outer.className).toContain('bg-surface-raised')
    expect(offer.className).not.toContain('bg-surface-raised')
  })

  it('grows Orders: both types, and tables only with dine-in', async () => {
    const person = userEvent.setup()
    const data = renderPage(OUTLET_KALYANI_ID)

    await person.click(await screen.findByTestId('service-orders-switch'))
    expect(screen.getByTestId('service-offer-dine_in')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('service-offer-takeaway')).toHaveAttribute('aria-pressed', 'true')
    // There is no Can skip: where both are offered, the counter always asks.
    expect(screen.queryByTestId('service-can-skip')).toBeNull()
    expect(screen.getByTestId('service-tables-switch')).toHaveAttribute('aria-checked', 'false')

    // A switch and nothing under it: there is no count of tables to keep.
    await person.click(screen.getByTestId('service-tables-switch'))
    expect(screen.queryByRole('textbox', { name: /tables/i })).toBeNull()

    // Taking dine-in away takes its tables with it.
    await person.click(screen.getByTestId('service-offer-dine_in'))
    expect(screen.queryByTestId('service-tables-switch')).toBeNull()
    // And the last type offered stays offered: off is the section's own switch.
    await person.click(screen.getByTestId('service-offer-takeaway'))
    expect(screen.getByTestId('service-offer-takeaway')).toHaveAttribute('aria-pressed', 'true')

    await person.click(screen.getByTestId('service-offer-dine_in'))
    // Offered again, dine-in's tables start off rather than coming back.
    expect(screen.getByTestId('service-tables-switch')).toHaveAttribute('aria-checked', 'false')
    await person.click(screen.getByTestId('service-tables-switch'))
    await person.click(screen.getByTestId('service-save'))

    await waitFor(() => expect(screen.queryByTestId('service-save')).toBeNull())
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)).toMatchObject({
      dineInOffered: true,
      takeawayOffered: true,
      tableNumbers: true,
      packagingMode: 'off',
    })
  })

  it('says it saved, in place of the buttons, and then folds away', async () => {
    const person = userEvent.setup()
    renderPage(OUTLET_KALYANI_ID)

    await person.click(await screen.findByTestId('service-orders-switch'))
    await person.click(screen.getByTestId('service-save'))

    const saved = await screen.findByTestId('service-saved')
    expect(saved).toHaveTextContent('Saved')
    expect(screen.queryByTestId('service-save')).toBeNull()
    expect(screen.queryByTestId('service-cancel')).toBeNull()
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Orders saved.')).toBe(
      true,
    )
    expect(screen.getByTestId('service-save-bar')).toHaveAttribute('data-open')

    // Held long enough to read, then the bar folds and the words go.
    await waitFor(
      () => expect(screen.getByTestId('service-save-bar')).not.toHaveAttribute('data-open'),
      { timeout: 3000 },
    )
    await waitFor(() => expect(screen.queryByTestId('service-saved')).toBeNull(), {
      timeout: 3000,
    })
    // And the page kept what was saved, with nothing left to save.
    expect(screen.getByTestId('service-orders-switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('brings Save back at once if a setting is touched while it says saved', async () => {
    const person = userEvent.setup()
    renderPage(OUTLET_KALYANI_ID)

    await person.click(await screen.findByTestId('service-orders-switch'))
    await person.click(screen.getByTestId('service-save'))
    await screen.findByTestId('service-saved')

    await person.click(screen.getByTestId('service-tables-switch'))
    expect(screen.queryByTestId('service-saved')).toBeNull()
    expect(screen.getByTestId('service-save')).toBeInTheDocument()
  })

  it('offers packaging only inside Takeaway, flat first, and not before a price', async () => {
    const person = userEvent.setup()
    const data = renderPage(OUTLET_KALYANI_ID)

    await person.click(await screen.findByTestId('service-orders-switch'))
    const takeawayOnly = () => screen.getByTestId('service-offer-dine_in')
    await person.click(takeawayOnly())
    await person.click(screen.getByTestId('service-packaging-switch'))

    const chargeBy = screen.getByRole('group', { name: 'Charge packaging by' })
    const [first] = within(chargeBy).getAllByRole('button')
    expect(first).toHaveTextContent('Flat per order')
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Charge per order')).toBeInTheDocument()
    expect(screen.getByTestId('service-gold-free')).toHaveAttribute('aria-checked', 'false')
    // Packaging sits inside the Packaging tile, which sits inside Orders.
    const packagingTile = screen.getByTestId('service-packaging-switch').closest('[data-depth]')!
    expect(packagingTile).toHaveAttribute('data-depth', '2')
    expect(packagingTile.contains(chargeBy)).toBe(true)

    await person.click(screen.getByTestId('service-save'))
    expect(screen.getByTestId('service-error')).toHaveTextContent('Type the packaging price')
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)?.packagingMode).toBe('off')

    // No ceiling.
    await person.type(screen.getByTestId('service-packaging-price'), '600')
    await person.click(screen.getByTestId('service-charge-by-per_bag'))
    await person.click(screen.getByTestId('service-gold-free'))
    await person.click(screen.getByTestId('service-save'))

    await waitFor(() => expect(screen.queryByTestId('service-save')).toBeNull())
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)).toMatchObject({
      dineInOffered: false,
      takeawayOffered: true,
      packagingMode: 'per_bag',
      packagingPricePaise: 60_000,
      packagingFreeForGold: true,
    })
  })

  it('takes packaging away with Takeaway', async () => {
    const person = userEvent.setup()
    renderPage(OUTLET_KANCHRAPARA_ID)

    expect(await screen.findByTestId('service-packaging-price')).toHaveValue('5')
    await person.click(screen.getByTestId('service-offer-takeaway'))
    expect(screen.queryByTestId('service-packaging-switch')).toBeNull()
    await person.click(screen.getByTestId('service-offer-takeaway'))
    expect(screen.getByTestId('service-packaging-switch')).toHaveAttribute('aria-checked', 'false')
    // Cancel puts back what is stored.
    await person.click(screen.getByTestId('service-cancel'))
    expect(screen.getByTestId('service-packaging-price')).toHaveValue('5')
  })

  it('lets a manager change how the outlet they manage serves', async () => {
    const person = userEvent.setup()
    const data = renderPage(OUTLET_KALYANI_ID, { role: 'franchise_admin' })

    await person.click(await screen.findByTestId('service-orders-switch'))
    await person.click(screen.getByTestId('service-save'))
    await screen.findByTestId('service-saved')
    expect(data.store.serviceSettings.get(OUTLET_KALYANI_ID)).toMatchObject({
      dineInOffered: true,
      takeawayOffered: true,
    })
    // Details stays the owner's: no Edit on it for a manager.
    expect(screen.queryByTestId('edit-kalyani')).toBeNull()
  })

  it('shows a manager nothing of an outlet they do not manage', async () => {
    renderPage(OUTLET_KANCHRAPARA_ID, { role: 'franchise_admin' })

    expect(await screen.findByText('This outlet is not one you can see.')).toBeInTheDocument()
    expect(screen.queryByTestId('service-orders')).toBeNull()
  })

  it('is there for real users, now that the database carries it', async () => {
    renderPage(OUTLET_KALYANI_ID, { mode: 'real' })

    // Awaited, not queried: the section draws once its settings are read, a
    // moment after the heading. The test this replaced asserted absence right
    // after the heading and passed on whichever machine checked first.
    expect(await screen.findByTestId('service-orders')).toBeVisible()
  })
})

describe('the mock refuses what the database will', () => {
  it('lets a manager write their own outlet’s choices and no other outlet’s', async () => {
    const adapters = createMockAdapters('franchise_admin', nothingChosenAtKalyani())
    const current = await adapters.outlets.getServiceSettings(OUTLET_KALYANI_ID)
    const next = {
      ...current,
      takeawayOffered: true,
      packagingMode: 'per_bag' as const,
      packagingPricePaise: 1000,
    }
    await expect(
      adapters.outlets.updateServiceSettings(OUTLET_KALYANI_ID, next),
    ).resolves.toMatchObject({ packagingPricePaise: 1000 })
    await expect(
      adapters.outlets.updateServiceSettings(OUTLET_KANCHRAPARA_ID, next),
    ).rejects.toMatchObject({ code: 'not_permitted' })
  })

  it('refuses a biller writing any outlet’s choices', async () => {
    const adapters = createMockAdapters('biller', nothingChosenAtKalyani())
    await expect(
      adapters.outlets.updateServiceSettings(OUTLET_KALYANI_ID, {
        ...(await adapters.outlets.getServiceSettings(OUTLET_KALYANI_ID)),
        dineInOffered: true,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })
  })

  it('refuses an inconsistent combination with the problem as its code', async () => {
    const adapters = createMockAdapters('super_admin', nothingChosenAtKalyani())
    const current = await adapters.outlets.getServiceSettings(OUTLET_KALYANI_ID)
    await expect(
      adapters.outlets.updateServiceSettings(OUTLET_KALYANI_ID, { ...current, tableNumbers: true }),
    ).rejects.toMatchObject({ code: 'tables_without_dine_in' })
  })

  it('hands the counter the outlet’s choices with its menu, and all-off where none are made', async () => {
    const adapters = createMockAdapters('biller', nothingChosenAtKalyani())
    expect((await adapters.menu.readOutletMenu(OUTLET_KANCHRAPARA_ID)).service).toMatchObject({
      packagingMode: 'per_bag',
      tableNumbers: true,
    })
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).service).toMatchObject({
      dineInOffered: false,
      packagingMode: 'off',
    })
  })
})

describe('gold’s settings in both places (a-regular-earns-points-and-gold)', () => {
  it('shows free packaging under Gold members too, as one value saved by Loyalty', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    // Kanchrapara charges for packaging; give it gold, as Kalyani has.
    data.store.loyaltySettings.set(
      OUTLET_KANCHRAPARA_ID,
      data.store.loyaltySettings.get(OUTLET_KALYANI_ID)!,
    )
    renderPage(OUTLET_KANCHRAPARA_ID, { data })

    const inLoyalty = await screen.findByTestId('loyalty-gold-free-packaging')
    const inOrders = screen.getByTestId('service-gold-free')
    const before = inOrders.getAttribute('aria-checked')
    expect(inLoyalty).toHaveAttribute('aria-checked', before)

    await user.click(inLoyalty)
    const after = before === 'true' ? 'false' : 'true'
    expect(screen.getByTestId('service-gold-free')).toHaveAttribute('aria-checked', after)

    await user.click(screen.getByTestId('loyalty-save'))
    await waitFor(() =>
      expect(data.store.serviceSettings.get(OUTLET_KANCHRAPARA_ID)?.packagingFreeForGold).toBe(
        after === 'true',
      ),
    )
  })

  it('hides free packaging from Orders the moment gold is switched off', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    data.store.loyaltySettings.set(
      OUTLET_KANCHRAPARA_ID,
      data.store.loyaltySettings.get(OUTLET_KALYANI_ID)!,
    )
    renderPage(OUTLET_KANCHRAPARA_ID, { data })

    await screen.findByTestId('loyalty-gold-free-packaging')
    expect(screen.getByTestId('service-gold-free')).toBeInTheDocument()
    await user.click(screen.getByTestId('loyalty-gold-switch'))
    expect(screen.queryByTestId('service-gold-free')).toBeNull()
    expect(screen.queryByTestId('loyalty-gold-free-packaging')).toBeNull()
  })
})

describe('the points multiplier in both places', () => {
  it('is one value: typing in the Gold members copy changes the Points one', async () => {
    const user = userEvent.setup()
    renderPage(OUTLET_KALYANI_ID)

    const copy = await screen.findByTestId('loyalty-multiplier-copy')
    await user.clear(copy)
    await user.type(copy, '1.5')
    expect(screen.getByTestId('loyalty-multiplier')).toHaveValue('1.5')
    expect(
      screen.getByLabelText('Gold members points multiplier', { selector: '#' + copy.id }),
    ).toBe(copy)
  })
})
