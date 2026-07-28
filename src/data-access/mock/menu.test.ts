import { describe, expect, it } from 'vitest'

import { MenuActionError } from '../adapters'
import { MENU_ITEM_CLASSIC_ID, MENU_ITEM_STUFFED_ID } from './fixtures/menu'
import { createMockMenuAdapter } from './menu'
import { createDemoStore, DEMO_OUTLET_ID } from './store'

/**
 * The mock's job is to refuse what the database will refuse. A demo that let a
 * Biller change a price would be teaching a product this one is not — which is
 * the same argument the roster mock makes about staff codes.
 */
describe('mock menu adapter', () => {
  const managerAdapter = () => createMockMenuAdapter(createDemoStore(), 'franchise_admin')

  it('returns categories and items in sort order', async () => {
    const menu = await managerAdapter().listMenu(DEMO_OUTLET_ID)

    expect(menu.map((entry) => entry.category.name)).toEqual(['Shawarma', 'Burgers'])
    expect(menu[0]?.items.map((item) => item.name)).toEqual([
      'Classic Chicken Shawarma',
      'Mayonnaise Chicken Shawarma',
      'Double Chicken Shawarma',
      'Mozzarella Cheese Chicken Shawarma',
      'Healthy Chicken Shawarma Salad',
      'Stuffed Lebanese Chicken Shawarma',
    ])
  })

  it('includes an unavailable item rather than hiding it', async () => {
    const menu = await managerAdapter().listMenu(DEMO_OUTLET_ID)
    const items = menu.flatMap((entry) => entry.items)

    const off = items.find((item) => item.id === MENU_ITEM_STUFFED_ID)
    expect(off).toBeDefined()
    expect(off?.is_available).toBe(false)
  })

  it('holds prices as integer paise', async () => {
    const menu = await managerAdapter().listMenu(DEMO_OUTLET_ID)
    for (const item of menu.flatMap((entry) => entry.items)) {
      expect(Number.isInteger(item.price_paise)).toBe(true)
    }
  })

  it('lets a manager change a price and availability', async () => {
    const adapter = managerAdapter()
    const updated = await adapter.updateItem(MENU_ITEM_CLASSIC_ID, { pricePaise: 14900 })
    expect(updated.price_paise).toBe(14900)

    const off = await adapter.setItemAvailability(MENU_ITEM_CLASSIC_ID, false)
    expect(off.is_available).toBe(false)
  })

  it('refuses every write from a Biller, the way the policy will', async () => {
    const store = createDemoStore()
    const biller = createMockMenuAdapter(store, 'biller')

    // Reading is fine — a biller sells from this menu.
    expect((await biller.listMenu(DEMO_OUTLET_ID)).length).toBeGreaterThan(0)

    await expect(biller.updateItem(MENU_ITEM_CLASSIC_ID, { pricePaise: 100 })).rejects.toThrow(
      MenuActionError,
    )
    await expect(biller.setItemAvailability(MENU_ITEM_CLASSIC_ID, false)).rejects.toThrow(
      /read it only/,
    )
    await expect(
      biller.createItem({
        outletId: DEMO_OUTLET_ID,
        categoryId: 'anything',
        name: 'Free Shawarma',
        pricePaise: 0,
        isVeg: true,
      }),
    ).rejects.toThrow(MenuActionError)

    // And nothing moved.
    const menu = await biller.listMenu(DEMO_OUTLET_ID)
    const classic = menu.flatMap((entry) => entry.items).find((i) => i.id === MENU_ITEM_CLASSIC_ID)
    expect(classic?.price_paise).toBe(13900)
    expect(classic?.is_available).toBe(true)
  })

  it('refuses a blank name and a non-integer price', async () => {
    const adapter = managerAdapter()
    const menu = await adapter.listMenu(DEMO_OUTLET_ID)
    const categoryId = menu[0]!.category.id

    await expect(
      adapter.createItem({
        outletId: DEMO_OUTLET_ID,
        categoryId,
        name: '   ',
        pricePaise: 10000,
        isVeg: false,
      }),
    ).rejects.toThrow(/cannot be blank/)

    await expect(
      adapter.createItem({
        outletId: DEMO_OUTLET_ID,
        categoryId,
        name: 'Something',
        pricePaise: 139.5,
        isVeg: false,
      }),
    ).rejects.toThrow(/whole number of paise/)
  })

  it('adds a new item at the end of its category', async () => {
    const adapter = managerAdapter()
    const menu = await adapter.listMenu(DEMO_OUTLET_ID)
    const categoryId = menu[0]!.category.id

    const created = await adapter.createItem({
      outletId: DEMO_OUTLET_ID,
      categoryId,
      name: 'Falafel Wrap',
      pricePaise: 15900,
      isVeg: true,
    })

    const after = await adapter.listMenu(DEMO_OUTLET_ID)
    expect(after[0]?.items.at(-1)?.id).toBe(created.id)
    expect(created.is_veg).toBe(true)
    expect(created.is_available).toBe(true)
  })

  it('hands out copies — mutating a result cannot corrupt the store', async () => {
    const adapter = managerAdapter()
    const first = await adapter.listMenu(DEMO_OUTLET_ID)
    first[0]!.items[0]!.name = 'MUTATED'

    const second = await adapter.listMenu(DEMO_OUTLET_ID)
    expect(second[0]?.items[0]?.name).toBe('Classic Chicken Shawarma')
  })
})
