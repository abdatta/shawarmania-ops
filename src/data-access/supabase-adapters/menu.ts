import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  MenuActionError,
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
  }
}
