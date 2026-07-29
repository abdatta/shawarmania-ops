import type { AppRole } from '../adapters'
import {
  MenuActionError,
  type MenuAdapter,
  type MenuCategoryPatch,
  type MenuCategoryWithItems,
  type MenuItemPatch,
  type NewMenuCategory,
  type NewMenuItem,
} from '../adapters'
import type { DemoStore } from './store'

/**
 * The mock menu adapter: the store in, promises out, no I/O anywhere.
 *
 * It enforces the permission boundary the database will, rather than relying on
 * the surface to hide a button. `menu_items` and `menu_categories` are writable
 * by the outlet's Franchise Admin and the Super Admin and by nobody else; a
 * Biller reads. The accounts mock already takes the persona's role for exactly
 * this reason — a demo that let the wrong person write teaches a product this
 * one is not.
 *
 * Results are cloned, so a screen mutating what it was handed cannot corrupt the
 * store for the next screen.
 */

/** The roles `menu_items_write` will admit. A Biller and an Employee are not among them. */
const MAY_WRITE: readonly AppRole[] = ['super_admin', 'franchise_admin']

function refuseBlank(field: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new MenuActionError('blank_value', `${field} cannot be blank.`)
  }
  return trimmed
}

function refuseBadPrice(pricePaise: number): number {
  if (!Number.isInteger(pricePaise) || pricePaise < 0) {
    throw new MenuActionError(
      'bad_price',
      'A price must be a whole number of paise, and cannot be negative.',
    )
  }
  return pricePaise
}

export function createMockMenuAdapter(store: DemoStore, role: AppRole): MenuAdapter {
  const mayWrite = MAY_WRITE.includes(role)

  function refuseReadOnly() {
    if (!mayWrite) {
      throw new MenuActionError(
        'not_permitted',
        'The menu is changed by a manager. This account can read it only.',
      )
    }
  }

  let nextCategory = 1
  let nextItem = 1

  const findItem = (id: string) => {
    const item = store.menuItems.find((candidate) => candidate.id === id)
    if (!item) throw new MenuActionError('missing', 'That menu item no longer exists.')
    return item
  }

  const findCategory = (id: string) => {
    const category = store.menuCategories.find((candidate) => candidate.id === id)
    if (!category) throw new MenuActionError('missing', 'That menu category no longer exists.')
    return category
  }

  /** The next free sort order in a category, so a new item lands at the end. */
  const nextSortOrder = (categoryId: string) =>
    store.menuItems
      .filter((item) => item.category_id === categoryId)
      .reduce((highest, item) => Math.max(highest, item.sort_order), 0) + 1

  return {
    async listMenu(outletId: string): Promise<MenuCategoryWithItems[]> {
      return store.menuCategories
        .filter((category) => category.outlet_id === outletId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((category) => ({
          category: structuredClone(category),
          items: store.menuItems
            .filter((item) => item.category_id === category.id)
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map((item) => structuredClone(item)),
        }))
    },

    async createCategory(category: NewMenuCategory) {
      refuseReadOnly()
      const created = {
        id: `d4000000-0000-4000-c000-${String(nextCategory++).padStart(12, '0')}`,
        outlet_id: category.outletId,
        name: refuseBlank('A category name', category.name),
        sort_order: category.sortOrder ?? store.menuCategories.length + 1,
        is_active: true,
      }
      store.menuCategories.push(created)
      return structuredClone(created)
    },

    async updateCategory(id: string, patch: MenuCategoryPatch) {
      refuseReadOnly()
      const category = findCategory(id)
      Object.assign(category, {
        ...(patch.name !== undefined && { name: refuseBlank('A category name', patch.name) }),
        ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
        ...(patch.isActive !== undefined && { is_active: patch.isActive }),
      })
      return structuredClone(category)
    },

    async createItem(item: NewMenuItem) {
      refuseReadOnly()
      findCategory(item.categoryId)
      const created = {
        id: `d4000000-0000-4000-d000-${String(nextItem++).padStart(12, '0')}`,
        outlet_id: item.outletId,
        category_id: item.categoryId,
        name: refuseBlank('An item name', item.name),
        description: item.description?.trim() || null,
        price_paise: refuseBadPrice(item.pricePaise),
        is_veg: item.isVeg,
        is_available: true,
        sort_order: item.sortOrder ?? nextSortOrder(item.categoryId),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.menuItems.push(created)
      return structuredClone(created)
    },

    async updateItem(id: string, patch: MenuItemPatch) {
      refuseReadOnly()
      const item = findItem(id)
      if (patch.categoryId !== undefined) findCategory(patch.categoryId)
      Object.assign(item, {
        ...(patch.name !== undefined && { name: refuseBlank('An item name', patch.name) }),
        ...(patch.categoryId !== undefined && { category_id: patch.categoryId }),
        ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
        ...(patch.pricePaise !== undefined && { price_paise: refuseBadPrice(patch.pricePaise) }),
        ...(patch.isVeg !== undefined && { is_veg: patch.isVeg }),
        ...(patch.isAvailable !== undefined && { is_available: patch.isAvailable }),
        ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
        updated_at: new Date().toISOString(),
      })
      return structuredClone(item)
    },

    async setItemAvailability(id: string, isAvailable: boolean) {
      refuseReadOnly()
      const item = findItem(id)
      item.is_available = isAvailable
      item.updated_at = new Date().toISOString()
      return structuredClone(item)
    },
  }
}
