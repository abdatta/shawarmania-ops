import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { MENU_ITEM_CLASSIC_ID, MENU_ITEM_STUFFED_ID } from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { MenuSurface } from './menu-surface'

/**
 * One screen, two authorities. The manager's half is about the two frequent
 * actions — availability and price — and the Biller's half is about the refusal
 * being the data layer's rather than a missing button's.
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

function renderMenu(
  role: Role = 'franchise_admin',
  adapters: DataAdapters = createMockAdapters(role),
) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>
            <MenuSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('MenuSurface — the manager', () => {
  it('lists categories and items in sort order, with prices in rupees', async () => {
    renderMenu()

    const list = await screen.findByTestId('menu-list')
    const headings = within(list)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Shawarma', 'Burgers'])

    const classic = within(list).getByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)
    expect(within(classic).getByText('Classic Chicken Shawarma')).toBeInTheDocument()
    expect(within(classic).getByText('₹139')).toBeInTheDocument()
    expect(within(classic).getByText('Non-vegetarian')).toBeInTheDocument()
  })

  it('shows an unavailable item rather than hiding it, and can turn it back on', async () => {
    const user = userEvent.setup()
    renderMenu()

    const off = await screen.findByTestId(`menu-item-${MENU_ITEM_STUFFED_ID}`)
    expect(within(off).getByTestId(`unavailable-${MENU_ITEM_STUFFED_ID}`)).toHaveTextContent(
      'Off the menu',
    )

    await user.click(within(off).getByTestId(`toggle-${MENU_ITEM_STUFFED_ID}`))

    await waitFor(() => {
      expect(screen.queryByTestId(`unavailable-${MENU_ITEM_STUFFED_ID}`)).not.toBeInTheDocument()
    })
  })

  it('turns an available item off in place, without opening a form', async () => {
    const user = userEvent.setup()
    renderMenu()

    const classic = await screen.findByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)
    await user.click(within(classic).getByTestId(`toggle-${MENU_ITEM_CLASSIC_ID}`))

    expect(await screen.findByTestId(`unavailable-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('warns that a price change applies to future bills only, before it is saved', async () => {
    const user = userEvent.setup()
    renderMenu()

    const classic = await screen.findByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)
    await user.click(within(classic).getByTestId(`edit-${MENU_ITEM_CLASSIC_ID}`))

    const price = await screen.findByLabelText('Price (₹)')
    expect(screen.queryByTestId('price-change-warning')).not.toBeInTheDocument()

    await user.clear(price)
    await user.type(price, '149')
    expect(await screen.findByTestId('price-change-warning')).toHaveTextContent(
      /bills rung from now on/i,
    )

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(
        within(screen.getByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)).getByText('₹149'),
      ).toBeInTheDocument()
    })
  })

  it('adds an item to a category and refuses a blank name by saying which field', async () => {
    const user = userEvent.setup()
    renderMenu()

    const list = await screen.findByTestId('menu-list')
    const burgers = within(list)
      .getAllByRole('heading', { level: 2 })
      .find((heading) => heading.textContent === 'Burgers')
    expect(burgers).toBeDefined()

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[1]!)

    // Submitting empty names the field rather than the browser doing it.
    await user.click(screen.getByRole('button', { name: 'Create item' }))
    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/needs a name/i)

    await user.type(screen.getByLabelText('Name'), 'Paneer Smashed Burger')
    await user.type(screen.getByLabelText('Price (₹)'), '230')
    await user.click(screen.getByLabelText('Vegetarian'))
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    const added = await screen.findByText('Paneer Smashed Burger')
    expect(added).toBeInTheDocument()
    const row = added.closest('li')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('Vegetarian')).toBeInTheDocument()
    expect(within(row!).getByText('₹230')).toBeInTheDocument()
  })

  it('refuses a price that is not a number', async () => {
    const user = userEvent.setup()
    renderMenu()

    await screen.findByTestId('menu-list')
    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]!)
    await user.type(screen.getByLabelText('Name'), 'Mystery Wrap')
    await user.type(screen.getByLabelText('Price (₹)'), 'lots')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/number of rupees/i)
    expect(screen.queryByText('Mystery Wrap')).not.toBeInTheDocument()
  })
})

/**
 * The Biller's read-only copy of this screen is retired — the Counter's own menu
 * column answers "is that still on?" without leaving the till, so there is no
 * longer a page to assert about. What remains is the half that always mattered:
 * the refusal is the data layer's, so it does not depend on a screen existing or
 * on a button being absent from it.
 */
describe('MenuSurface — a Biller cannot write the menu', () => {
  it('is refused by the data layer, not merely by an absent surface', async () => {
    const adapters = createMockAdapters('biller')
    renderMenu('biller', adapters)
    await screen.findByTestId('menu-list')

    // The hand-crafted equivalent: call the adapter the surface was given.
    await expect(adapters.menu.setItemAvailability(MENU_ITEM_CLASSIC_ID, false)).rejects.toThrow(
      /read it only/i,
    )
  })
})
