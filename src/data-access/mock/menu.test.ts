import { describe, expect, it } from 'vitest'

import { MenuActionError } from '../adapters'
import { MENU_ITEM_CLASSIC_ID, MENU_ITEM_LEBANESE_ID } from './fixtures/menu'
import { createMockMenuAdapter } from './menu'
import { createDemoStore, DEMO_OUTLET_ID } from './store'

/**
 * The mock's job is to refuse what the database will refuse. A demo that let a
 * Biller change a price would be teaching a product this one is not — which is
 * the same argument the roster mock makes about staff codes.
 */
describe('mock menu adapter', () => {
  describe('menu presentation', () => {
    it('uses item identity to break equal name and position ties before a move', async () => {
      const store = createDemoStore()
      const adapter = createMockMenuAdapter(store, 'franchise_admin')
      const category = (await adapter.listMenu(DEMO_OUTLET_ID))[0]!.category
      const tied = store.menuItems.filter(
        (item) => item.category_id === category.id && item.is_active,
      )
      tied.forEach((item) => {
        item.name = 'Same name'
        item.sort_order = 0
      })
      store.menuItems.reverse()
      const ids = tied.map((item) => item.id).sort()
      expect((await adapter.listMenu(DEMO_OUTLET_ID))[0]!.items.map((item) => item.id)).toEqual(ids)
      await adapter.presentation!.reorderItems(category.id, [...ids].reverse())
      expect((await adapter.listMenu(DEMO_OUTLET_ID))[0]!.items.map((item) => item.id)).toEqual(
        [...ids].reverse(),
      )
    })
    it('normalizes tied positions atomically and rejects stale membership', async () => {
      const store = createDemoStore()
      const adapter = createMockMenuAdapter(store, 'franchise_admin')
      const entry = (await adapter.listMenu(DEMO_OUTLET_ID))[0]!
      store.menuItems
        .filter((item) => item.category_id === entry.category.id)
        .forEach((item) => {
          item.sort_order = 0
        })
      const reversed = entry.items.map((item) => item.id).reverse()
      await adapter.presentation!.reorderItems(entry.category.id, reversed)
      expect((await adapter.listMenu(DEMO_OUTLET_ID))[0]!.items.map((item) => item.id)).toEqual(
        reversed,
      )
      await expect(
        adapter.presentation!.reorderItems(entry.category.id, reversed.slice(1)),
      ).rejects.toThrow('category changed')
      expect((await adapter.listMenu(DEMO_OUTLET_ID))[0]!.items.map((item) => item.id)).toEqual(
        reversed,
      )
      expect(
        (await adapter.listMenu(DEMO_OUTLET_ID))[0]!.items.map((item) => item.price_paise),
      ).toEqual(entry.items.map((item) => item.price_paise).reverse())
    })

    it('stores title and independent selection without moving dishes; shares saves across personas', async () => {
      const store = createDemoStore()
      const adapter = createMockMenuAdapter(store, 'franchise_admin')
      const before = await adapter.listMenu(DEMO_OUTLET_ID)
      const selection = [before[1]!.items[0]!.id, before[0]!.items[0]!.id]
      expect(
        await adapter.presentation!.setHighlights(DEMO_OUTLET_ID, {
          title: '  Newly Launched  ',
          itemIds: selection,
        }),
      ).toEqual({ title: 'Newly Launched', itemIds: selection })
      expect(await adapter.listMenu(DEMO_OUTLET_ID)).toEqual(before)
      const owner = createMockMenuAdapter(store, 'super_admin')
      expect(await owner.presentation!.readHighlights(DEMO_OUTLET_ID)).toEqual({
        title: 'Newly Launched',
        itemIds: selection,
      })
      const other = store.tradingOutletIds.find((id) => id !== DEMO_OUTLET_ID)!
      expect(await owner.presentation!.readHighlights(other)).toEqual({
        title: 'Highlights',
        itemIds: [],
      })
    })

    it('validates title, duplicates, foreign items and isolation without partial saves', async () => {
      const store = createDemoStore()
      const adapter = createMockMenuAdapter(store, 'franchise_admin')
      const foreign = store.menuItems.find((item) => item.outlet_id !== DEMO_OUTLET_ID)!
      for (const value of [
        { title: ' ', itemIds: [] },
        { title: 'x'.repeat(61), itemIds: [] },
        { title: 'Highlights', itemIds: [MENU_ITEM_CLASSIC_ID, MENU_ITEM_CLASSIC_ID] },
        { title: 'Highlights', itemIds: [foreign.id] },
      ])
        await expect(adapter.presentation!.setHighlights(DEMO_OUTLET_ID, value)).rejects.toThrow(
          MenuActionError,
        )
      expect(await adapter.presentation!.readHighlights(DEMO_OUTLET_ID)).toEqual({
        title: 'Highlights',
        itemIds: [],
      })
      await expect(adapter.presentation!.readHighlights(foreign.outlet_id)).rejects.toThrow(
        MenuActionError,
      )
      await expect(
        adapter.presentation!.setHighlights(foreign.outlet_id, { title: 'No', itemIds: [] }),
      ).rejects.toThrow(MenuActionError)
      await expect(adapter.presentation!.reorderItems(foreign.category_id, [])).rejects.toThrow(
        MenuActionError,
      )
    })

    it('includes unavailable selections, omits removed ones and allows an empty section', async () => {
      const adapter = createMockMenuAdapter(createDemoStore(), 'franchise_admin')
      await adapter.presentation!.setHighlights(DEMO_OUTLET_ID, {
        title: 'Recommended',
        itemIds: [MENU_ITEM_CLASSIC_ID, MENU_ITEM_LEBANESE_ID],
      })
      expect((await adapter.presentation!.readHighlights(DEMO_OUTLET_ID)).itemIds).toContain(
        MENU_ITEM_LEBANESE_ID,
      )
      await adapter.removeItem(MENU_ITEM_CLASSIC_ID)
      expect((await adapter.presentation!.readHighlights(DEMO_OUTLET_ID)).itemIds).toEqual([
        MENU_ITEM_LEBANESE_ID,
      ])
      await adapter.presentation!.setHighlights(DEMO_OUTLET_ID, {
        title: 'Recommended',
        itemIds: [],
      })
      expect((await adapter.presentation!.readHighlights(DEMO_OUTLET_ID)).itemIds).toEqual([])
    })

    it.each(['biller', 'employee'] as const)('refuses %s presentation writes', async (role) => {
      const adapter = createMockMenuAdapter(createDemoStore(), role)
      const entry = (await adapter.listMenu(DEMO_OUTLET_ID))[0]!
      await expect(
        adapter.presentation!.setHighlights(DEMO_OUTLET_ID, { title: 'No', itemIds: [] }),
      ).rejects.toThrow(MenuActionError)
      await expect(
        adapter.presentation!.reorderItems(
          entry.category.id,
          entry.items.map((item) => item.id),
        ),
      ).rejects.toThrow(MenuActionError)
    })
  })
  const managerAdapter = () => createMockMenuAdapter(createDemoStore(), 'franchise_admin')

  it('returns categories and items in sort order', async () => {
    const menu = await managerAdapter().listMenu(DEMO_OUTLET_ID)

    expect(menu.map((entry) => entry.category.name)).toEqual([
      'Shawarmas',
      'Burgers',
      'Sandwiches',
      'Appetizers',
      'Main Course',
      'Arabian Favourites',
      'Desserts',
      'Tea & Coffee',
      'Mocktails',
      'Water',
    ])
    // By sort order, not by id: the classic's id is the oldest, its place ninth.
    expect(menu[0]?.items.map((item) => item.name)).toEqual([
      'Peri Peri Chicken Shawarma',
      'Mayonnaise Chicken Shawarma',
      'Double Chicken Shawarma',
      'Cheese Chicken Shawarma',
      'Lebanese Chicken Shawarma',
      'Taco Chicken Shawarma',
      'Chicken Shawarma Salad',
      'Shawarmania Mutton Shawarma',
      'Classic Chicken Shawarma',
      'Paneer Shawarma',
    ])
    expect(menu.flatMap((entry) => entry.items)).toHaveLength(60)
  })

  it('includes an unavailable item rather than hiding it', async () => {
    const menu = await managerAdapter().listMenu(DEMO_OUTLET_ID)
    const items = menu.flatMap((entry) => entry.items)

    const off = items.find((item) => item.id === MENU_ITEM_LEBANESE_ID)
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
    expect(classic?.price_paise).toBe(13500)
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
    expect(second[0]?.items[0]?.name).toBe('Peri Peri Chicken Shawarma')
  })
})
