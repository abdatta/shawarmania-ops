/**
 * How an outlet serves (each-outlet-chooses-how-it-serves, #60): whether its
 * orders are marked dine-in or takeaway, whether dine-in takes a table, and
 * whether packaging is charged — with packaging optionally free for gold
 * members.
 *
 * **Every rule here is a choice a shop makes, not a fact about Shawarmania.** An
 * outlet starts with nothing chosen and bills exactly as it did before these
 * choices existed, so every function below answers the all-off outlet with
 * "nothing": no chips, no table, no packaging line.
 *
 * Pure functions over plain values, like the rest of this layer. The counter,
 * the mock adapter and later the live one all read the same rules from here,
 * so the demo cannot teach a behaviour the database will not keep.
 */

import { lineTotalPaise } from './billing'

/** How an order was served. Null on an order is *neither*. */
export type ServiceType = 'dine_in' | 'takeaway'

/** How packaging is charged, if at all. */
export type PackagingMode = 'off' | 'per_bag' | 'per_order'

/** What a line on an order is: something from the menu, or the packaging. */
export type LineKind = 'item' | 'packaging'

/**
 * An outlet's service choices — the six columns design D1 puts on `outlets`.
 *
 * The **Orders** switch on the settings page is not stored: it reads on while
 * either type is offered. One stored truth, and no switch that can disagree
 * with what sits under it.
 */
export interface OutletServiceSettings {
  dineInOffered: boolean
  takeawayOffered: boolean
  /**
   * Whether dine-in orders take a table number. Only with dine-in. There is no
   * count: a table is whatever number, 1 to `MAX_TABLE_NUMBER`, the biller keys
   * in [owner, 2026-09-27].
   */
  tableNumbers: boolean
  packagingMode: PackagingMode
  /** Whole rupees, at least ₹1, in paise. Null exactly when packaging is off. */
  packagingPricePaise: number | null
  /** False whenever packaging is off. */
  packagingFreeForGold: boolean
}

/** What every outlet starts with, and what bills exactly as today. */
export const ALL_OFF_SERVICE_SETTINGS: Readonly<OutletServiceSettings> = Object.freeze({
  dineInOffered: false,
  takeawayOffered: false,
  tableNumbers: false,
  packagingMode: 'off',
  packagingPricePaise: null,
  packagingFreeForGold: false,
})

/** The highest table number the pad takes: three digits [owner, 2026-09-27]. */
export const MAX_TABLE_NUMBER = 999
/** ₹1: a bag cheaper than a rupee would only feed the rounding line. */
export const MIN_PACKAGING_PRICE_PAISE = 100

/** The line's name in both modes [owner, 2026-09-26]. There is no *Bag*. */
export const PACKAGING_LINE_NAME = 'Packaging'

/**
 * Why a combination is refused, named so a caller can word it. Each is a check
 * constraint the database will carry, so a hand-crafted request meets it too.
 */
export type ServiceSettingsProblem =
  | 'tables_without_dine_in'
  | 'packaging_price_without_charge'
  | 'packaging_without_takeaway'
  | 'packaging_price_required'
  | 'packaging_price_not_whole_rupees'
  | 'packaging_price_too_low'
  | 'gold_waiver_without_charge'

/** What a refused combination says to the owner who tried it. */
export const SERVICE_SETTINGS_PROBLEM_MESSAGES: Record<ServiceSettingsProblem, string> = {
  tables_without_dine_in: 'Table numbers need dine-in to be offered.',
  packaging_price_without_charge: 'A packaging price needs the packaging charge turned on.',
  packaging_without_takeaway: 'A packaging charge needs takeaway to be offered.',
  packaging_price_required: 'Type the packaging price before saving.',
  packaging_price_not_whole_rupees: 'The packaging price is a whole number of rupees.',
  packaging_price_too_low: 'The packaging price is at least ₹1.',
  gold_waiver_without_charge: 'Free packaging for gold members needs a packaging charge.',
}

/** The first thing wrong with a combination, or null when it may be stored. */
export function serviceSettingsProblem(
  settings: OutletServiceSettings,
): ServiceSettingsProblem | null {
  const { packagingMode, packagingPricePaise } = settings
  if (settings.tableNumbers && !settings.dineInOffered) return 'tables_without_dine_in'
  if (packagingMode === 'off') {
    if (packagingPricePaise !== null) return 'packaging_price_without_charge'
    if (settings.packagingFreeForGold) return 'gold_waiver_without_charge'
    return null
  }
  // Packaging belongs to takeaway [owner, 2026-09-27]: it is charged on takeaway
  // orders and nowhere else, so it cannot outlive the type it charges.
  if (!settings.takeawayOffered) return 'packaging_without_takeaway'
  if (packagingPricePaise === null) return 'packaging_price_required'
  if (!Number.isInteger(packagingPricePaise) || packagingPricePaise % 100 !== 0) {
    return 'packaging_price_not_whole_rupees'
  }
  // No ceiling [owner, 2026-09-27]: the price is typed in whole rupees, so
  // there is no unit to confuse, and a shop's packaging is its own business.
  if (packagingPricePaise < MIN_PACKAGING_PRICE_PAISE) return 'packaging_price_too_low'
  return null
}

/** The Orders switch, derived: on while either type is offered. */
export function ordersOffered(settings: OutletServiceSettings): boolean {
  return settings.dineInOffered || settings.takeawayOffered
}

/** The types the counter offers as chips, dine-in first. */
export function offeredServiceTypes(settings: OutletServiceSettings): ServiceType[] {
  return [
    ...(settings.dineInOffered ? (['dine_in'] as const) : []),
    ...(settings.takeawayOffered ? (['takeaway'] as const) : []),
  ]
}

/** Whether marking an order dine-in asks which table. */
export function tablesOffered(settings: OutletServiceSettings): boolean {
  return settings.dineInOffered && settings.tableNumbers
}

/**
 * Whether the counter asks where the food goes [owner, 2026-09-27]: when both
 * types are offered, or when dine-in alone is and it takes a table. An outlet
 * offering exactly one type with nothing to choose within it asks nothing —
 * every order there already is that type (`initialServiceType`).
 */
export function serviceChoiceShown(settings: OutletServiceSettings): boolean {
  const both = settings.dineInOffered && settings.takeawayOffered
  return both || tablesOffered(settings)
}

/**
 * What a new order starts on. **Nothing is ever preselected where there is a
 * choice** [owner, 2026-09-27]: where the counter asks, the order starts on
 * nothing and the biller answers. Where it does not ask, the order starts on
 * the one type there is — takeaway at a takeaway-only shop, with its
 * packaging, and dine-in without a table at a dine-in-only one.
 */
export function initialServiceType(settings: OutletServiceSettings): ServiceType | null {
  if (serviceChoiceShown(settings)) return null
  return offeredServiceTypes(settings)[0] ?? null
}

/**
 * Whether the order still owes an answer before it may be saved or paid
 * [owner, 2026-09-27]: wherever the counter asks, it must be answered — a type
 * where both are offered, and a table or *No table* where dine-in takes one.
 *
 * *Neither* stays a real value — it is what every order at an outlet that
 * offers no type records, and what every order rung before these choices
 * existed reads as — but a biller at an outlet that asks can never leave it
 * there. There is no *Can skip* [owner, 2026-09-27].
 */
export function serviceChoiceRequired(
  settings: OutletServiceSettings,
  serviceType: ServiceType | null,
): boolean {
  return serviceChoiceShown(settings) && serviceType === null
}

/**
 * The Orders switch turned on or off. On offers both types and no tables; off clears both, table numbers and the packaging charge,
 * since tables without dine-in and packaging without takeaway are combinations
 * the database refuses.
 */
export function withOrdersSwitched(
  settings: OutletServiceSettings,
  on: boolean,
): OutletServiceSettings {
  return on
    ? {
        ...settings,
        dineInOffered: true,
        takeawayOffered: true,
        tableNumbers: false,
      }
    : withPackagingSwitched(
        { ...settings, dineInOffered: false, takeawayOffered: false, tableNumbers: false },
        false,
      )
}

/**
 * The Packaging switch, under Takeaway, turned on or off. On starts **flat per
 * order** [owner, 2026-09-27] with no price — the owner types it, and nothing is
 * stored until they have — and off clears the price and the gold waiver with it.
 */
export function withPackagingSwitched(
  settings: OutletServiceSettings,
  on: boolean,
): OutletServiceSettings {
  return on
    ? { ...settings, packagingMode: 'per_order', packagingPricePaise: null }
    : {
        ...settings,
        packagingMode: 'off',
        packagingPricePaise: null,
        packagingFreeForGold: false,
      }
}

/**
 * Whether an order of this type carries packaging at this outlet: **a takeaway
 * order, and no other** [owner, 2026-09-27]. Dine-in and *neither* carry none.
 * A parcel-only shop offers takeaway alone, so every order it rings starts as
 * takeaway and carries its packaging.
 */
export function packagingApplies(
  settings: OutletServiceSettings,
  serviceType: ServiceType | null,
): boolean {
  return settings.packagingMode !== 'off' && serviceType === 'takeaway'
}

/**
 * The packaging a line captures when it is added: the price in force now, and
 * one bag (or the one flat charge). **Captured, never re-read** — a price
 * changed while the order is open reaches new orders and nothing already on
 * one (design D6).
 */
export interface CapturedPackaging {
  unitPricePaise: number
  quantity: number
}

export function capturePackaging(settings: OutletServiceSettings): CapturedPackaging | null {
  if (settings.packagingMode === 'off' || settings.packagingPricePaise === null) return null
  return { unitPricePaise: settings.packagingPricePaise, quantity: 1 }
}

/**
 * Whether this order's packaging is free: the outlet waives it for gold members
 * and the customer, **as far as the tablet knows**, is one. Re-derived whenever
 * it is asked, because it follows the customer while the order is open.
 */
export function packagingWaived(
  settings: OutletServiceSettings,
  customerTier: 'gold' | null | undefined,
): boolean {
  return (
    settings.packagingMode !== 'off' && settings.packagingFreeForGold && customerTier === 'gold'
  )
}

/**
 * The packaging line, shaped as every line is. The waiver is the line's own
 * discount at one hundred percent (design D4): on a packaging line a discount
 * *is* the waiver, so what gold cost is one sum over stored rows. The name is
 * fixed and there is no menu item and no category, so no menu discount can ever
 * reach it.
 */
export function packagingLine(captured: CapturedPackaging, waived: boolean) {
  const total = lineTotalPaise(captured.unitPricePaise, captured.quantity)
  return {
    kind: 'packaging' as const,
    menuItemId: '',
    itemName: PACKAGING_LINE_NAME,
    unitPricePaise: captured.unitPricePaise,
    quantity: captured.quantity,
    discountPaise: waived ? total : 0,
    discountPercentBp: waived ? 10_000 : null,
    categoryName: null,
  }
}

/** True for the packaging line, whatever mode put it there. */
export function isPackagingLine(line: { kind?: LineKind | null | undefined }): boolean {
  return line.kind === 'packaging'
}

/**
 * Whether this is packaging a gold member got free: the packaging line carrying
 * its whole amount as its own discount. On a packaging line a discount *is* the
 * waiver — nothing else can put one there — so this reads the stored line and
 * never infers anything from the customer.
 */
export function isWaivedPackaging(line: {
  kind?: LineKind | null | undefined
  unitPricePaise: number
  quantity: number
  discountPaise?: number | null | undefined
}): boolean {
  const total = lineTotalPaise(line.unitPricePaise, line.quantity)
  return isPackagingLine(line) && total > 0 && (line.discountPaise ?? 0) === total
}

/** The packaging line's key at the counter: there is at most one, and no menu item. */
export const PACKAGING_LINE_KEY = 'packaging'

/** What a line's controls call it by: its menu item, or `packaging`. */
export function lineKey(line: { kind?: LineKind | null | undefined; menuItemId: string }): string {
  return isPackagingLine(line) ? PACKAGING_LINE_KEY : line.menuItemId
}

/** Whether a keyed table number is one a table can have: 1 to 999. */
export function isTableNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TABLE_NUMBER
}

/** What the counter calls an order that has a table. Replaces its number. */
export function tableLabel(tableNumber: number): string {
  return `Table ${tableNumber}`
}

/** The words for a type, as a chip and as a fact beside a number. */
export function serviceTypeLabel(serviceType: ServiceType): string {
  return serviceType === 'dine_in' ? 'Dine-in' : 'Takeaway'
}

/**
 * The tables an open order occupies, and the order occupying each.
 *
 * Only an **open** order holds a table: one paid or cancelled has freed it
 * [owner, 2026-09-26], even while a paid one still owed food keeps reading
 * *Table 4* on its card. Two open orders on one table are possible — two
 * tablets, or one that was offline — and the database accepts both (design
 * D5). The first one listed wins here; the pipeline shows both.
 */
export function busyTables<
  T extends {
    id: string
    status: string
    serviceType?: ServiceType | null
    tableNumber?: number | null
  },
>(orders: readonly T[], exceptOrderId: string | null = null): Map<number, T> {
  const busy = new Map<number, T>()
  for (const order of orders) {
    if (order.id === exceptOrderId || order.status !== 'open') continue
    if (order.serviceType !== 'dine_in' || order.tableNumber == null) continue
    if (!busy.has(order.tableNumber)) busy.set(order.tableNumber, order)
  }
  return busy
}

/** An open order's place among the open orders seated at the same table. */
export interface SharedTable {
  /** 1 for the oldest. */
  position: number
  /** How many open orders hold the table. Always at least two. */
  of: number
}

/**
 * The open orders that share a table with another open order, and which of them
 * each is, oldest first [owner, 2026-09-27].
 *
 * Two open orders on one table are allowed (D5) and reachable three ways: two
 * tablets, a stale offline pipeline, or a payment taken back after the table
 * was seated again. Nothing refuses them, so the counter says so instead: each
 * card reads *Table 8 · 1 of 2*, telling the biller both that the table is
 * shared and which order this is. Only **open** orders count, as for
 * `busyTables`: a paid order still owed food has already freed its table.
 */
export function sharedTables<
  T extends {
    id: string
    status: string
    orderedAt: string
    serviceType?: ServiceType | null
    tableNumber?: number | null
  },
>(orders: readonly T[]): Map<string, SharedTable> {
  const byTable = new Map<number, T[]>()
  for (const order of orders) {
    if (order.status !== 'open' || order.serviceType !== 'dine_in') continue
    if (order.tableNumber == null) continue
    byTable.set(order.tableNumber, [...(byTable.get(order.tableNumber) ?? []), order])
  }
  const shared = new Map<string, SharedTable>()
  for (const group of byTable.values()) {
    if (group.length < 2) continue
    const oldestFirst = [...group].sort(
      (a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.id.localeCompare(b.id),
    )
    oldestFirst.forEach((order, index) =>
      shared.set(order.id, { position: index + 1, of: oldestFirst.length }),
    )
  }
  return shared
}
