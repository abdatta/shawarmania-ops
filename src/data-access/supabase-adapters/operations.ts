import { InventoryActionError, type InventoryAdapter } from '../adapters'

/**
 * The real stock adapter — deliberately not connected while inventory is
 * shelved.
 *
 * Writing those queries now would ship code no gate in this change can exercise,
 * so reads answer honestly and writes refuse in this app's voice.
 */

const NOT_LIVE = 'This is not connected to real data yet. It is being demonstrated first.'

export function createSupabaseInventoryAdapter(): InventoryAdapter {
  const notLive = () => Promise.reject(new InventoryActionError('not_live', NOT_LIVE))

  return {
    async listItems() {
      return []
    },
    async getItem() {
      return null
    },
    async listMovements() {
      return []
    },
    createItem: notLive,
    updateItem: notLive,
    recordMovement: notLive,
  }
}
