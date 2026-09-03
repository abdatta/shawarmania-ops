import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  MenuActionError,
  type DiscountPreset,
  type MenuAdapter,
  type MenuCategoryPatch,
  type MenuItemPatch,
  type MenuItemWithCategoryPatch,
  type NewMenuCategory,
  type NewMenuItem,
  type NewMenuItemWithCategory,
} from '../adapters'
import type { Database, Json, Tables } from '../database.types'
import type { CounterResumeCoordinator, CounterResumeRecord } from '@/outbox'

function menuError(error: PostgrestError): MenuActionError {
  switch (error.code) {
    case '42501':
      return new MenuActionError('not_permitted', 'You can change only a menu you manage.')
    case '23505':
      return new MenuActionError('already_exists', 'That category already exists for this outlet.')
    case '23514':
    case '22023':
      return new MenuActionError('invalid', 'Check the item name, category and price.')
    case 'P0002':
      return new MenuActionError('missing', 'That menu item no longer exists.')
    default:
      return new MenuActionError('failed', 'The menu could not be saved. Try again in a moment.')
  }
}

function categoryPatch(
  patch: MenuCategoryPatch,
): Database['public']['Tables']['menu_categories']['Update'] {
  return {
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
    ...(patch.isActive !== undefined && { is_active: patch.isActive }),
  }
}

function itemPatch(patch: MenuItemPatch): Database['public']['Tables']['menu_items']['Update'] {
  return {
    ...(patch.categoryId !== undefined && { category_id: patch.categoryId }),
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.pricePaise !== undefined && { price_paise: patch.pricePaise }),
    ...(patch.isVeg !== undefined && { is_veg: patch.isVeg }),
    ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
    ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
    ...(patch.isAvailable !== undefined && { is_available: patch.isAvailable }),
  }
}

function createdPair(value: Json): {
  category: Tables<'menu_categories'>
  item: Tables<'menu_items'>
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MenuActionError('failed', 'The menu item was saved, but its result was lost.')
  }
  const category = value.category
  const item = value.item
  if (!category || typeof category !== 'object' || Array.isArray(category)) {
    throw new MenuActionError('failed', 'The menu item was saved, but its category was lost.')
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new MenuActionError('failed', 'The menu item was saved, but its result was lost.')
  }
  return {
    category: category as unknown as Tables<'menu_categories'>,
    item: item as unknown as Tables<'menu_items'>,
  }
}

export function createSupabaseMenuAdapter(
  client: SupabaseClient<Database>,
  resumeCoordinator?: CounterResumeCoordinator,
  offlineResume?: CounterResumeRecord,
): MenuAdapter {
  async function createItem(item: NewMenuItem) {
    const { data, error } = await client
      .from('menu_items')
      .insert({
        outlet_id: item.outletId,
        category_id: item.categoryId,
        name: item.name.trim(),
        price_paise: item.pricePaise,
        is_veg: item.isVeg,
        description: item.description?.trim() || null,
        ...(item.sortOrder !== undefined && { sort_order: item.sortOrder }),
      })
      .select('*')
      .single()
    if (error) throw menuError(error)
    return data
  }

  return {
    async listMenu(outletId) {
      const [categoriesResult, itemsResult] = await Promise.all([
        client
          .from('menu_categories')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name'),
        client
          .from('menu_items')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name'),
      ])
      if (categoriesResult.error || itemsResult.error) {
        if (offlineResume?.tablet.outletId === outletId) {
          return structuredClone(offlineResume.menu)
        }
        throw menuError(categoriesResult.error ?? itemsResult.error!)
      }
      const items = itemsResult.data ?? []
      const menu = (categoriesResult.data ?? []).map((category) => ({
        category,
        items: items.filter((item) => item.category_id === category.id),
      }))
      resumeCoordinator?.noteMenu(outletId, menu)
      return menu
    },

    async createCategory(category: NewMenuCategory) {
      const { data, error } = await client
        .from('menu_categories')
        .insert({
          outlet_id: category.outletId,
          name: category.name.trim(),
          ...(category.sortOrder !== undefined && { sort_order: category.sortOrder }),
        })
        .select('*')
        .single()
      if (error) throw menuError(error)
      return data
    },

    async updateCategory(id: string, patch: MenuCategoryPatch) {
      const { data, error } = await client
        .from('menu_categories')
        .update(categoryPatch(patch))
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw menuError(error)
      return data
    },

    createItem,

    async createItemWithCategory(item: NewMenuItemWithCategory) {
      const { data, error } = await client.rpc('create_menu_item_with_category', {
        p_outlet_id: item.outletId,
        p_category_name: item.categoryName.trim(),
        p_item_name: item.name.trim(),
        p_price_paise: item.pricePaise,
        p_is_veg: item.isVeg,
        ...(item.description?.trim() && { p_description: item.description.trim() }),
        ...(item.sortOrder !== undefined && { p_sort_order: item.sortOrder }),
      })
      if (error) throw menuError(error)
      return createdPair(data)
    },

    async updateItemWithCategory(id: string, patch: MenuItemWithCategoryPatch) {
      const { data, error } = await client.rpc('update_menu_item_with_category', {
        p_item_id: id,
        p_category_name: patch.categoryName.trim(),
        p_item_name: patch.name?.trim() ?? '',
        p_price_paise: patch.pricePaise ?? -1,
        p_is_veg: patch.isVeg ?? false,
        ...(patch.description?.trim() && { p_description: patch.description.trim() }),
      })
      if (error) throw menuError(error)
      return data
    },

    async updateItem(id: string, patch: MenuItemPatch) {
      const { data, error } = await client
        .from('menu_items')
        .update(itemPatch(patch))
        .eq('id', id)
        .eq('is_active', true)
        .select('*')
        .single()
      if (error) throw menuError(error)
      return data
    },

    async setItemAvailability(id: string, isAvailable: boolean) {
      const { data, error } = await client
        .from('menu_items')
        .update({ is_available: isAvailable })
        .eq('id', id)
        .eq('is_active', true)
        .select('*')
        .single()
      if (error) throw menuError(error)
      return data
    },

    async retireItem(id: string) {
      const { error } = await client.rpc('retire_menu_item', { p_item_id: id })
      if (error) throw menuError(error)
    },

    async listDiscounts(outletId) {
      const [discountsResult, linksResult] = await Promise.all([
        client
          .from('menu_discounts')
          .select('*')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .order('created_at'),
        client.from('menu_discount_categories').select('discount_id, category_id'),
      ])
      if (discountsResult.error) throw menuError(discountsResult.error)
      if (linksResult.error) throw menuError(linksResult.error)

      const links = linksResult.data ?? []
      return (discountsResult.data ?? []).map((row) => ({
        id: row.id,
        outletId: row.outlet_id,
        basis: row.basis,
        valueBp: row.value_bp,
        valuePaise: row.value_paise,
        isActive: row.is_active,
        categoryIds: links
          .filter((link) => link.discount_id === row.id)
          .map((link) => link.category_id),
      }))
    },

    async readOutletMenu(outletId) {
      // One read of all three, because all three have to reach the tablet by the
      // same path and be persisted together. `listMenu` already falls back to
      // the resume record when the backend is unreachable, so the discounts have
      // to come from the same snapshot or an offline till sells at full price
      // through a discount the owner is running.
      const categories = await this.listMenu(outletId)

      try {
        const [discounts, outlet] = await Promise.all([
          this.listDiscounts(outletId),
          client.from('outlets').select('discount_presets').eq('id', outletId).single(),
        ])
        if (outlet.error) throw menuError(outlet.error)
        const menu = {
          categories,
          discounts,
          presets: (outlet.data.discount_presets ?? []) as unknown as DiscountPreset[],
        }
        resumeCoordinator?.noteOutletMenu(outletId, menu)
        return menu
      } catch (cause) {
        // The categories above already resolved, from the backend or from the
        // resume record. If the discounts could not, prefer what this tablet
        // last knew over pricing at full price through a live discount.
        const remembered = offlineResume?.tablet.outletId === outletId ? offlineResume : null
        if (remembered?.outletMenu) return structuredClone(remembered.outletMenu)
        throw cause
      }
    },

    async createDiscount(discount) {
      const inserted = await client
        .from('menu_discounts')
        .insert({
          outlet_id: discount.outletId,
          basis: discount.basis,
          value_bp: discount.valueBp ?? null,
          value_paise: discount.valuePaise ?? null,
        })
        .select('*')
        .single()
      if (inserted.error) throw menuError(inserted.error)

      const { error: linkError } = await client.from('menu_discount_categories').insert(
        discount.categoryIds.map((categoryId) => ({
          discount_id: inserted.data.id,
          category_id: categoryId,
        })),
      )
      if (linkError) {
        // The price floor is checked once every category is attached, so this is
        // where a rupee discount above the cheapest item it covers surfaces.
        // Take the half-written discount back out rather than leaving one that
        // covers nothing and reads as active.
        await client.from('menu_discounts').delete().eq('id', inserted.data.id)
        throw menuError(linkError)
      }

      return {
        id: inserted.data.id,
        outletId: inserted.data.outlet_id,
        basis: inserted.data.basis,
        valueBp: inserted.data.value_bp,
        valuePaise: inserted.data.value_paise,
        isActive: inserted.data.is_active,
        categoryIds: [...discount.categoryIds],
      }
    },

    async updateDiscount(id, patch) {
      const updated = await client
        .from('menu_discounts')
        .update({
          basis: patch.basis,
          value_bp: patch.valueBp ?? null,
          value_paise: patch.valuePaise ?? null,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (updated.error) throw menuError(updated.error)

      // The categories are restated rather than diffed: the form hands over the
      // whole set, and a diff would be a second opinion about what it meant.
      const { error: cleared } = await client
        .from('menu_discount_categories')
        .delete()
        .eq('discount_id', id)
      if (cleared) throw menuError(cleared)

      const { error: linkError } = await client
        .from('menu_discount_categories')
        .insert(
          patch.categoryIds.map((categoryId) => ({ discount_id: id, category_id: categoryId })),
        )
      // The price floor is checked once every category is attached, so a rupee
      // discount above the cheapest item it now covers surfaces here.
      if (linkError) throw menuError(linkError)

      return {
        id: updated.data.id,
        outletId: updated.data.outlet_id,
        basis: updated.data.basis,
        valueBp: updated.data.value_bp,
        valuePaise: updated.data.value_paise,
        isActive: updated.data.is_active,
        categoryIds: [...patch.categoryIds],
      }
    },

    async removeDiscount(id: string) {
      // Deactivated rather than deleted, so a bill that was rung under it keeps
      // reading correctly and the row it was attached to still resolves.
      const { error } = await client
        .from('menu_discounts')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw menuError(error)
    },

    async setDiscountPresets(outletId: string, presets: DiscountPreset[]) {
      const { data, error } = await client
        .from('outlets')
        .update({ discount_presets: presets as unknown as Json })
        .eq('id', outletId)
        .select('discount_presets')
        .single()
      if (error) throw menuError(error)
      return (data.discount_presets ?? []) as unknown as DiscountPreset[]
    },
  }
}
