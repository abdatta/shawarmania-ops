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
    expect(within(off).getByTestId(`unavailable-${MENU_ITEM_STUFFED_ID}`)).toHaveTextContent('OFF')

    await user.click(
      screen.getByRole('button', { name: 'Actions for Stuffed Lebanese Chicken Shawarma' }),
    )
    await user.click(screen.getByTestId(`toggle-${MENU_ITEM_STUFFED_ID}`))

    await waitFor(() => {
      expect(screen.queryByTestId(`unavailable-${MENU_ITEM_STUFFED_ID}`)).not.toBeInTheDocument()
    })
  })

  it('turns an available item off in place, without opening a form', async () => {
    const user = userEvent.setup()
    renderMenu()

    await screen.findByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)
    await user.click(screen.getByRole('button', { name: 'Actions for Classic Chicken Shawarma' }))
    await user.click(screen.getByTestId(`toggle-${MENU_ITEM_CLASSIC_ID}`))

    expect(await screen.findByTestId(`unavailable-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('warns that a price change applies to future bills only, before it is saved', async () => {
    const user = userEvent.setup()
    renderMenu()

    await screen.findByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)
    await user.click(screen.getByRole('button', { name: 'Actions for Classic Chicken Shawarma' }))
    await user.click(screen.getByTestId(`edit-${MENU_ITEM_CLASSIC_ID}`))

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

    await user.click(screen.getByRole('button', { name: 'Add' }))

    // Submitting empty names the field rather than the browser doing it.
    await user.click(screen.getByRole('button', { name: 'Create item' }))
    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/needs a name/i)

    await user.type(screen.getByLabelText('Name'), 'Paneer Smashed Burger')
    await user.type(screen.getByRole('combobox', { name: 'Category' }), 'Burgers')
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
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Name'), 'Mystery Wrap')
    await user.type(screen.getByRole('combobox', { name: 'Category' }), 'Shawarma')
    await user.type(screen.getByLabelText('Price (₹)'), 'lots')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/number of rupees/i)
    expect(screen.queryByText('Mystery Wrap')).not.toBeInTheDocument()
  })

  it('has one item-first Add action and asks nothing for a category resembling none', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /add category/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Name'), 'Fresh Lime Soda')
    await user.type(screen.getByRole('combobox', { name: 'Category' }), 'Beverages')
    await user.type(screen.getByLabelText('Price (₹)'), '50')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    expect(await screen.findByRole('heading', { name: 'Beverages' })).toBeInTheDocument()
    expect(await screen.findByText('Fresh Lime Soda')).toBeInTheDocument()
    expect(screen.queryByTestId('category-match-list')).not.toBeInTheDocument()
  })

  it('offers the near match as a choice and files the item under it', async () => {
    const user = userEvent.setup()
    renderMenu()
    const list = await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Name'), 'Spicy Chicken Shawarma')
    await user.type(screen.getByRole('combobox', { name: 'Category' }), 'Shwarma')
    await user.type(screen.getByLabelText('Price (₹)'), '180')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    // The candidate is offered in the dialog itself, so the correction happens
    // here rather than behind a cancel and a retype — but picking it and
    // committing it are two acts, so a mistaken tap files nothing.
    await screen.findByTestId('category-match-list')
    const confirm = screen.getByTestId('confirm-category-choice')
    expect(confirm).toBeDisabled()

    await user.click(screen.getByTestId('use-category-Shawarma'))
    expect(screen.getByTestId(`menu-item-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.queryByText('Spicy Chicken Shawarma')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use “Shawarma”' }))

    const added = await screen.findByText('Spicy Chicken Shawarma')
    expect(
      within(added.closest('[data-testid^="category-"]')!).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('Shawarma')
    expect(
      within(list).queryByRole('heading', { level: 2, name: 'Shwarma' }),
    ).not.toBeInTheDocument()
  })

  it('still creates the typed category when the near miss is deliberate', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText('Name'), 'Veg Burger')
    await user.type(screen.getByRole('combobox', { name: 'Category' }), 'Burger')
    await user.type(screen.getByLabelText('Price (₹)'), '200')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    await screen.findByTestId('category-match-list')
    await user.click(screen.getByTestId('use-category-new'))
    await user.click(screen.getByRole('button', { name: 'Create “Burger”' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Burger' })).toBeInTheDocument()
    expect(await screen.findByText('Veg Burger')).toBeInTheDocument()
  })

  it('reorders categories deliberately and retires the final item without an empty heading', async () => {
    const user = userEvent.setup()
    renderMenu()
    const list = await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: 'Actions for Burgers' }))
    await user.click(screen.getByRole('button', { name: 'Move up' }))
    await waitFor(() => {
      expect(
        within(list)
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['Burgers', 'Shawarma'])
    })

    await user.click(
      screen.getByRole('button', { name: 'Actions for Fully Loaded Smashed Burger' }),
    )
    await user.click(screen.getByTestId('retire-d4000000-0000-4000-b000-000000000007'))
    await user.click(screen.getByRole('button', { name: 'Retire item' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Burgers' })).not.toBeInTheDocument()
    })
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

describe('MenuSurface — discounts across the menu', () => {
  it('shows the discount the owner is running, named by value and by category', async () => {
    renderMenu()
    await screen.findByTestId('menu-list')

    const card = screen.getByTestId('menu-discounts')
    // Named for what it is: a discount the owner runs across the menu, not the
    // one a biller puts on a single bill.
    expect(within(card).getByRole('heading', { name: 'Menu Discounts' })).toBeInTheDocument()
    // The fixture runs 15% across Shawarma, so the row says what and where.
    expect(card).toHaveTextContent('15% off · Burgers')
    // No sale, no offer, no promotion — anywhere on the surface.
    expect(document.body.textContent).not.toMatch(/\b(sale|offer|promotion)\b/i)
  })

  it('sets a second discount over several categories at once', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByTestId('set-discounts'))
    await user.type(screen.getByLabelText('Discount value'), '10')
    await user.click(screen.getByTestId('select-all-categories'))
    await user.click(screen.getByTestId('save-discount'))

    const card = await screen.findByTestId('menu-discounts')
    await waitFor(() => {
      // Every category covered reads as one phrase rather than a list of headings.
      expect(card).toHaveTextContent('10% off · All Items')
    })
    // And the first discount is untouched: several run at once, at their own values.
    expect(card).toHaveTextContent('15% off · Burgers')
  })

  it('states the limit for the unit chosen, and no other', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByTestId('set-discounts'))
    // A percentage has one limit, and it is not about item prices.
    expect(screen.getByTestId('discount-limit')).toHaveTextContent('Up to 100%.')

    await user.click(screen.getByTestId('discount-basis-amount'))
    // Nothing chosen yet, so there is nothing to bound.
    expect(screen.getByTestId('discount-limit')).toHaveTextContent(/choose categories/i)

    await user.click(screen.getByTestId('select-all-categories'))
    // The real figure, worked out from the categories now covered: the cheapest
    // active item on the demo menu is the ₹139 Classic Chicken Shawarma.
    expect(screen.getByTestId('discount-limit')).toHaveTextContent('Up to ₹139')
  })

  it('refuses a rupee discount above the cheapest item inside the form, before saving', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByTestId('set-discounts'))
    await user.click(screen.getByTestId('discount-basis-amount'))
    await user.type(screen.getByLabelText('Discount value'), '99999')
    await user.click(screen.getByTestId('select-all-categories'))
    await user.click(screen.getByTestId('save-discount'))

    // In the sheet, naming the actual limit — not on the page after the sheet
    // has closed, where it would describe a form the reader can no longer see.
    await waitFor(() => {
      expect(screen.getByTestId('form-sheet-error')).toHaveTextContent(/more than ₹139/i)
    })
    expect(screen.getByTestId('save-discount')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-error')).not.toBeInTheDocument()
  })

  it('stops a discount without disturbing the other', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: /stop the 15% discount/i }))

    // Nothing running means nothing shown — no row, and no sentence saying so.
    await waitFor(() => {
      expect(screen.queryByText(/15% off/)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('list', { name: 'Menu discounts' })).not.toBeInTheDocument()
  })

  it('keeps the counter presets to four, so the panel row never wraps', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    const presets = screen.getByTestId('discount-presets')
    // Collapsed by default, and the summary still says what the counter offers,
    // so the usual question is answered without opening anything.
    expect(presets).not.toHaveAttribute('open')
    expect(presets).toHaveTextContent('10% · 15% · 20%')

    await user.click(within(presets).getByText('Counter presets'))

    // The default the database gives a new outlet.
    expect(within(presets).getByTestId('preset-percent-1000')).toBeInTheDocument()
    expect(within(presets).getByTestId('preset-percent-1500')).toBeInTheDocument()
    expect(within(presets).getByTestId('preset-percent-2000')).toBeInTheDocument()

    await user.type(screen.getByLabelText('New preset value'), '25')
    await user.click(screen.getByTestId('add-preset'))

    await waitFor(() => {
      expect(
        within(screen.getByTestId('discount-presets')).getByTestId('preset-percent-2500'),
      ).toBeInTheDocument()
    })

    // A fifth has nowhere to go, so the control that would add one is gone.
    expect(screen.queryByTestId('add-preset')).not.toBeInTheDocument()
  })

  it('offers a Biller no way to change what comes off', async () => {
    const adapters = createMockAdapters('biller')
    renderMenu('biller', adapters)
    await screen.findByTestId('menu-list')

    // The refusal is the data layer's, not an absent control's — the same
    // boundary this surface already relies on for adding an item. A hidden
    // button proves nothing about what a hand-crafted request can do.
    await expect(
      adapters.menu.createDiscount({
        outletId: personaFixtures.biller.assignments[0]!.outletId!,
        basis: 'percent',
        valueBp: 5000,
        categoryIds: [],
      }),
    ).rejects.toThrow(/read it only/i)
  })
})

describe('MenuSurface — changing a discount that is already running', () => {
  it('reopens it filled in, and saves over it rather than adding another', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: /edit the 15% discount/i }))

    // Filled in from the discount being changed, not blank.
    expect(screen.getByLabelText('Discount value')).toHaveValue('15')
    expect(screen.getByRole('button', { name: 'Save discount' })).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Discount value'))
    await user.type(screen.getByLabelText('Discount value'), '25')
    await user.click(screen.getByTestId('save-discount'))

    const card = await screen.findByTestId('menu-discounts')
    await waitFor(() => {
      expect(card).toHaveTextContent('25% off · Burgers')
    })
    // One discount, changed — not a second one beside the first.
    expect(card).not.toHaveTextContent('15% off')
    expect(within(card).getAllByRole('listitem')).toHaveLength(1)
  })

  it('holds an edit to the same price floor a new discount is held to', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    await user.click(screen.getByRole('button', { name: /edit the 15% discount/i }))
    await user.click(screen.getByTestId('discount-basis-amount'))
    await user.clear(screen.getByLabelText('Discount value'))
    await user.type(screen.getByLabelText('Discount value'), '99999')
    await user.click(screen.getByTestId('save-discount'))

    // Burgers alone, so the floor is the cheapest burger rather than ₹139.
    await waitFor(() => {
      expect(screen.getByTestId('form-sheet-error')).toHaveTextContent(/more than ₹/i)
    })
  })

  it('offers a rupee preset as readily as a percentage one', async () => {
    const user = userEvent.setup()
    renderMenu()
    await screen.findByTestId('menu-list')

    const presets = screen.getByTestId('discount-presets')
    await user.click(within(presets).getByText('Counter presets'))

    await user.type(screen.getByLabelText('New preset value'), '20')
    await user.click(screen.getByTestId('preset-unit-amount'))
    await user.click(screen.getByTestId('add-preset'))

    await waitFor(() => {
      expect(
        within(screen.getByTestId('discount-presets')).getByTestId('preset-amount-2000'),
      ).toBeInTheDocument()
    })
    // The summary reads both units without ambiguity.
    expect(screen.getByTestId('discount-presets')).toHaveTextContent('₹20')
  })
})
