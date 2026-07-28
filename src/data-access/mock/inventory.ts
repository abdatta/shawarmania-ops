import { isLowStock, movementDelta, roundQuantity, sumQuantities } from '@/domain'

import {
  InventoryActionError,
  type InventoryAdapter,
  type InventoryItemPatch,
  type InventoryItemSummary,
  type InventoryMovementRecord,
  type NewInventoryItem,
  type NewMovement,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'

/**
 * The mock stock ledger.
 *
 * It does **not** keep a running quantity it increments. Every read sums the
 * item's movements, because `openspec/specs/inventory-ledger/spec.md` makes the
 * ledger the source of truth and the quantity a cache the database maintains
 * from it — and a mock that mutated a stored figure would make the cache
 * authoritative, which is the exact inversion the spec exists to prevent. Two
 * screens that disagree about how much chicken there is would be the visible
 * symptom; the invisible one is a demo that teaches an editable history.
 *
 * There is deliberately no way to change or remove a movement. A mistake is
 * corrected by a further movement carrying a note, and both stay on the ledger.
 */

const RECORDED_BY = personaFixtures.franchise_admin.profile.id

function summarise(item: Tables<'inventory_items'>, currentQuantity: number): InventoryItemSummary {
  return {
    id: item.id,
    outletId: item.outlet_id,
    name: item.name,
    unit: item.unit,
    currentQuantity,
    lowStockThreshold: item.low_stock_threshold,
    isLow: isLowStock({ currentQuantity, lowStockThreshold: item.low_stock_threshold }),
    purchaseCostPaise: item.purchase_cost_paise,
    isActive: item.is_active,
    lastUpdatedAt: item.last_updated_at,
  }
}

export function createMockInventoryAdapter(store: DemoStore): InventoryAdapter {
  let nextItem = 1
  let nextMovement = 1

  const movementsFor = (itemId: string) =>
    store.inventoryMovements
      .filter((movement) => movement.inventory_item_id === itemId)
      .sort(
        (a, b) =>
          a.business_date.localeCompare(b.business_date) || a.created_at.localeCompare(b.created_at),
      )

  /** The cache, recomputed. Always equal to the ledger, because it *is* the ledger. */
  const quantityOf = (itemId: string) =>
    sumQuantities(movementsFor(itemId).map((movement) => movement.quantity_delta))

  const find = (id: string) => {
    const item = store.inventoryItems.find((candidate) => candidate.id === id)
    if (!item) throw new InventoryActionError('missing', 'That stock item no longer exists.')
    return item
  }

  return {
    async listItems(outletId: string) {
      return store.inventoryItems
        .filter((item) => item.outlet_id === outletId && item.is_active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => summarise(item, quantityOf(item.id)))
    },

    async getItem(id: string) {
      const item = store.inventoryItems.find((candidate) => candidate.id === id)
      return item ? summarise(item, quantityOf(item.id)) : null
    },

    async listMovements(inventoryItemId: string): Promise<InventoryMovementRecord[]> {
      // Walked oldest first to build the running figure, then reversed: a
      // ledger reads newest first, but "what was left afterwards" only exists
      // in the other direction.
      let running = 0
      const withRunning = movementsFor(inventoryItemId).map((movement) => {
        running = roundQuantity(running + movement.quantity_delta)
        return {
          id: movement.id,
          inventoryItemId: movement.inventory_item_id,
          movementType: movement.movement_type,
          quantityDelta: movement.quantity_delta,
          quantityAfter: running,
          note: movement.note,
          businessDate: movement.business_date,
          createdAt: movement.created_at,
        }
      })
      return withRunning.reverse()
    },

    async createItem(item: NewInventoryItem) {
      const name = item.name.trim()
      if (name === '') {
        throw new InventoryActionError('blank_value', 'A stock item needs a name.')
      }
      if (!Number.isFinite(item.lowStockThreshold) || item.lowStockThreshold < 0) {
        throw new InventoryActionError(
          'bad_threshold',
          'A low-stock threshold must be a number, and cannot be negative.',
        )
      }

      const created: Tables<'inventory_items'> = {
        id: `d9000000-0000-4000-b000-${String(nextItem++).padStart(12, '0')}`,
        outlet_id: item.outletId,
        name,
        unit: item.unit,
        // Zero, and it stays zero until a movement says otherwise: a new item
        // has an empty ledger, and the quantity is that ledger's sum.
        current_quantity: 0,
        low_stock_threshold: roundQuantity(item.lowStockThreshold),
        purchase_cost_paise: item.purchaseCostPaise ?? 0,
        is_active: true,
        last_updated_at: new Date().toISOString(),
      }
      store.inventoryItems.push(created)
      return summarise(created, 0)
    },

    async updateItem(id: string, patch: InventoryItemPatch) {
      const item = find(id)
      if (patch.name !== undefined && patch.name.trim() === '') {
        throw new InventoryActionError('blank_value', 'A stock item needs a name.')
      }
      Object.assign(item, {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.lowStockThreshold !== undefined && {
          low_stock_threshold: roundQuantity(patch.lowStockThreshold),
        }),
        ...(patch.purchaseCostPaise !== undefined && {
          purchase_cost_paise: patch.purchaseCostPaise,
        }),
        ...(patch.isActive !== undefined && { is_active: patch.isActive }),
        last_updated_at: new Date().toISOString(),
      })
      return summarise(item, quantityOf(item.id))
    },

    async recordMovement(movement: NewMovement) {
      const item = find(movement.inventoryItemId)

      if (!Number.isFinite(movement.quantity) || movement.quantity === 0) {
        throw new InventoryActionError(
          'bad_quantity',
          'A movement needs a quantity, and it cannot be zero.',
        )
      }
      if (movement.movementType === 'correction' && (movement.note ?? '').trim() === '') {
        // A correction with no note is a number nobody can account for later,
        // which is the one thing the ledger exists to prevent.
        throw new InventoryActionError(
          'note_required',
          'A correction needs a note saying what was wrong.',
        )
      }

      store.inventoryMovements.push({
        id: `da000000-0000-4000-b000-${String(nextMovement++).padStart(12, '0')}`,
        outlet_id: item.outlet_id,
        inventory_item_id: item.id,
        movement_type: movement.movementType,
        quantity_delta: movementDelta(movement.movementType, movement.quantity),
        note: movement.note?.trim() || null,
        business_date: movement.businessDate,
        created_at: new Date().toISOString(),
        recorded_by: RECORDED_BY,
        unit_cost_paise: null,
      })

      const quantity = quantityOf(item.id)
      // The cache follows the ledger, never the other way round. Written here so
      // the fixture column stays truthful for anything reading it directly.
      item.current_quantity = quantity
      item.last_updated_at = new Date().toISOString()
      return summarise(item, quantity)
    },
  }
}
