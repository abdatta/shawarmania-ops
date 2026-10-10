import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DataActionError,
  type KitchenAcknowledgeOutcome,
  type KitchenAdapter,
  type KitchenAlertKind,
  type KitchenBoard,
  type KitchenCategory,
  type KitchenFilterMode,
  type KitchenSort,
  type KitchenLine,
  type KitchenMarks,
  type KitchenOrder,
} from '../adapters'
import type { KitchenAnswer } from '@/domain'
import type { Database, Json } from '../database.types'

/**
 * The kitchen tablet's live adapter (#70).
 *
 * Everything here is one RPC or one narrow read. The board is a single call to
 * `kitchen_board()`, which returns the outlet's unfinished orders with this
 * tablet's visible lines and nothing a kitchen should not hold — no customer,
 * no amount. A kitchen shift holds no select on `orders`, so the live nudge
 * comes from `kitchen_pulses`, one row per outlet that every order write bumps.
 * As on the counter, the nudge is never the data: the screen re-reads.
 */

type BoardJson = {
  readAt: string
  filterChangedAt: string | null
  outletId: string
  businessDate: string
  shiftId: string
  operatorName: string | null
  filterMode: KitchenFilterMode
  categoryIds: string[] | null
  sort: KitchenSort | null
  orders: OrderJson[]
}

type LineJson = { id: string; menuItemId: string | null; itemName: string; quantity: number }

type OrderJson = {
  id: string
  orderNumber: number
  serviceType: KitchenOrder['serviceType']
  tableNumber: number | null
  orderedAt: string
  version: string
  status: KitchenOrder['status']
  cancelledAt: string | null
  lines: LineJson[]
  otherItemCount: number
  acknowledged: boolean
  latestAck: {
    kind: KitchenAlertKind
    orderVersion: string
    lines: LineJson[]
    ackedAt: string
  } | null
}

function line(row: LineJson): KitchenLine {
  return {
    id: row.id,
    menuItemId: row.menuItemId,
    itemName: row.itemName,
    quantity: row.quantity,
  }
}

export function parseKitchenBoard(value: Json): KitchenBoard {
  const board = value as unknown as BoardJson
  return {
    readAt: board.readAt,
    filterChangedAt: board.filterChangedAt ?? null,
    outletId: board.outletId,
    businessDate: board.businessDate,
    shiftId: board.shiftId,
    operatorName: board.operatorName ?? 'Kitchen operator',
    filter: { mode: board.filterMode, categoryIds: board.categoryIds ?? [] },
    sort: board.sort ?? 'oldest_first',
    orders: (board.orders ?? []).map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      serviceType: order.serviceType,
      tableNumber: order.tableNumber,
      orderedAt: order.orderedAt,
      version: order.version,
      status: order.status,
      cancelledAt: order.cancelledAt,
      lines: order.lines.map(line),
      otherItemCount: order.otherItemCount,
      acknowledged: order.acknowledged,
      latestAck: order.latestAck
        ? {
            kind: order.latestAck.kind,
            orderVersion: order.latestAck.orderVersion,
            lines: order.latestAck.lines.map(line),
            ackedAt: order.latestAck.ackedAt,
          }
        : null,
    })),
  }
}

const MESSAGES: Record<string, string> = {
  invalid: 'That filter could not be saved. Choose categories from this outlet.',
  not_authorised: 'This tablet has no kitchen shift open. Start one to continue.',
  identity_conflict: 'That acknowledgement clashed with another. Try again.',
}

export function createSupabaseKitchenAdapter(client: SupabaseClient<Database>): KitchenAdapter {
  return {
    async readBoard(): Promise<KitchenBoard> {
      const { data, error } = await client.rpc('kitchen_board')
      if (error) throw error
      return parseKitchenBoard(data)
    },

    async listCategories(): Promise<KitchenCategory[]> {
      const { data, error } = await client
        .from('menu_categories')
        .select('id, name, is_active, sort_order')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []).map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }))
    },

    async readCounterMarks(): Promise<KitchenMarks> {
      const { data, error } = await client.rpc('counter_kitchen_marks')
      if (error) throw error
      const marks = data as unknown as {
        kitchens: { id: string; label: string }[] | null
        orders: { orderId: string; marks: (KitchenAnswer | null)[] }[] | null
        kitchenTablets: number | null
      }
      return {
        kitchens: marks.kitchens ?? [],
        orders: Object.fromEntries(
          (marks.orders ?? []).map((order) => [order.orderId, order.marks]),
        ),
        kitchenTablets: marks.kitchenTablets ?? 0,
      }
    },

    async setFilter(mode, categoryIds, sort): Promise<void> {
      const { data, error } = await client.rpc('set_kitchen_filter', {
        p_mode: mode,
        p_category_ids: [...categoryIds],
        p_sort: sort,
      })
      if (error) throw error
      if (data !== 'ok') {
        const code = String(data)
        throw new DataActionError(code, MESSAGES[code] ?? 'The filter could not be saved.')
      }
    },

    async acknowledge(input): Promise<KitchenAcknowledgeOutcome> {
      const { data, error } = await client.rpc('kitchen_acknowledge', {
        p_id: input.id,
        p_order_id: input.orderId,
        p_kind: input.kind,
        p_order_version: input.orderVersion,
      })
      if (error) throw error
      const status = (data as { status?: string } | null)?.status
      if (status === 'accepted') return 'accepted'
      if (status === 'stale') return 'stale'
      const code = status ?? 'invalid'
      throw new DataActionError(code, MESSAGES[code] ?? 'The acknowledgement did not land.')
    },

    subscribe(outletId, onNudge, onStatus): () => void {
      const channel = client
        .channel(`kitchen-pulse-${outletId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'kitchen_pulses',
            filter: `outlet_id=eq.${outletId}`,
          },
          () => onNudge(),
        )
        .subscribe((status) => onStatus?.(status === 'SUBSCRIBED'))
      return () => {
        onStatus?.(false)
        void client.removeChannel(channel)
      }
    },
  }
}
