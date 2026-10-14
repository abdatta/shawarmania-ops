/**
 * The dish ticks' own rules (each-dish-is-ticked-off; `dish-ticks` and
 * `kitchen-ready`).
 *
 * **Nothing here is shared with the off path.** The first launch edited shared
 * helpers in place — the counter's line key, the kitchen's line comparison, its
 * wait tones — which changed the counter and kitchen with no gate between them
 * and today (design R7). Each rule the on path needs that differs from today's is
 * its own function here, and the old one keeps its body.
 */

import { isPackagingLine, PACKAGING_LINE_KEY } from './service'
import {
  KITCHEN_WAIT_DANGER_MINUTES,
  KITCHEN_WAIT_WARNING_MINUTES,
  type KitchenCardState,
  type KitchenLineChange,
} from './kitchen'
import type { LineKind } from './service'

export interface DishLineFacts {
  workflowLineId?: string
  orderLineId?: string
  menuItemId: string
  itemName: string
  unitPricePaise: number
  quantity: number
  note?: string | null
  preparedQuantity?: number
  readyQuantity?: number
}

export function dishLocked(line: DishLineFacts): boolean {
  return (line.preparedQuantity ?? 0) > 0 || (line.readyQuantity ?? 0) > 0
}

export function dishOwed(quantity: number, ready = 0, ticked = 0): number {
  return Math.max(0, quantity - Math.max(ready, ticked))
}

/**
 * What a composer line's controls call it by on the on path: its own identity,
 * so two lines of one dish — one with a note, one locked — are two lines. The
 * off path keys by menu item (`lineKey` in `./service`).
 */
export function dishLineKey(line: {
  kind?: LineKind | null | undefined
  menuItemId: string
  workflowLineId?: string
  orderLineId?: string
}): string {
  return isPackagingLine(line)
    ? PACKAGING_LINE_KEY
    : (line.workflowLineId ?? line.orderLineId ?? line.menuItemId)
}

/** How much of a line the kitchen has made or the counter has handed over. */
export function dishMade(line: DishLineFacts): number {
  return Math.min(line.quantity, Math.max(line.preparedQuantity ?? 0, line.readyQuantity ?? 0))
}

/** One row of the composer: every line of one dish, note and price. */
export interface DishRow<T extends DishLineFacts> {
  /** The key of the row's first line: its controls are called by it. */
  key: string
  lines: T[]
  quantity: number
  /** How much of it is made: Done or handed over. */
  made: number
  /** The line more food goes on and a note applies to: the newest not made. */
  growing: T | null
}

/**
 * The composer's rows (owner, 2026-10-14). A dish the kitchen has partly made
 * is still one row in the composer, with its true total: the made food and the
 * food added since are separate lines only because a rail row ticks as one and
 * the kitchen sends later food as its own ticket. Those are the rail's and the
 * kitchen's, so the composer joins them again — by dish, note and captured
 * price, since a line at an older price or with another note is a different sale.
 */
export function dishRows<T extends DishLineFacts & { kind?: LineKind | null }>(
  lines: readonly T[],
): DishRow<T>[] {
  const rows: DishRow<T>[] = []
  const byDish = new Map<string, DishRow<T>>()
  for (const line of lines) {
    const dish = isPackagingLine(line)
      ? null
      : `${line.menuItemId}|${line.note ?? ''}|${line.unitPricePaise}`
    const row = dish === null ? undefined : byDish.get(dish)
    if (row) {
      row.lines.push(line)
      row.quantity += line.quantity
      row.made += dishMade(line)
      if (!dishLocked(line)) row.growing = line
      continue
    }
    const fresh: DishRow<T> = {
      key: dishLineKey(line),
      lines: [line],
      quantity: line.quantity,
      made: dishMade(line),
      growing: dishLocked(line) ? null : line,
    }
    rows.push(fresh)
    if (dish !== null) byDish.set(dish, fresh)
  }
  return rows
}

/**
 * The rail's rounds of an order (design R12): the lines it was created with,
 * then each edit's additions in the order they were made. The rail draws a
 * plain divider between rounds, so the same dish appearing twice says why —
 * as the kitchen numbers the same food #N · 2 (owner, 2026-10-14).
 */
export function dishRounds<T extends { addedAt?: string }>(
  lines: readonly T[],
): { line: T; index: number }[][] {
  const first: { line: T; index: number }[] = []
  const later = new Map<string, { line: T; index: number }[]>()
  lines.forEach((line, index) => {
    if (!line.addedAt) first.push({ line, index })
    else later.set(line.addedAt, [...(later.get(line.addedAt) ?? []), { line, index }])
  })
  const rounds = [...later.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, round]) => round)
  return first.length > 0 ? [first, ...rounds] : rounds
}

/** The newest unnoted, unlocked line is the one a menu tap can grow. */
export function addDish<T extends DishLineFacts>(lines: readonly T[], fresh: T): T[] {
  const index = lines.findLastIndex(
    (line) => line.menuItemId === fresh.menuItemId && !line.note && !dishLocked(line),
  )
  if (index < 0) return [...lines, fresh]
  return lines.map((line, position) =>
    position === index ? { ...line, quantity: line.quantity + 1 } : line,
  )
}

export const NOTE_SEEDS = ['No sauce', 'Extra spicy', 'Less spicy', 'No onion', 'No mayo']
export const NOTE_STORAGE_KEY = 'shawarmania-dish-notes'

export function rankedNotes(counts: Record<string, number>): string[] {
  const used = Object.entries(counts)
    .filter(([note, count]) => note.trim() && count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([note]) => note)
  return used.length ? used.slice(0, 5) : NOTE_SEEDS
}

/** Only 1 is a new line at today's menu price, not a rewrite of a captured sale. */
export function noteDish<T extends DishLineFacts>(
  lines: readonly T[],
  key: string,
  note: string | null,
  onlyOne: boolean,
  fresh: T,
): T[] {
  return lines.flatMap((line) => {
    if ((line.workflowLineId ?? line.orderLineId) !== key || dishLocked(line)) return [line]
    if (onlyOne && line.quantity > 1)
      return [
        { ...line, quantity: line.quantity - 1 },
        { ...fresh, note, quantity: 1 },
      ]
    return [{ ...line, note }]
  })
}

/**
 * How long ago an order was placed, as the counter's card says it under the
 * label: light, and nothing more (owner, 2026-10-14). The order's age stopped
 * being a measure of the kitchen once a table orders again after its first
 * food came, and of payment once paying last became the custom, so the card
 * shows it as a fact, not a countdown.
 */
export function dishAge(orderedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(orderedAt)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m ago` : `${hours}h ago`
}

// ── Waiting time on the kitchen's age ring (design D9) ───────────────────────

/** A darker, contrast-validated red from forty minutes, on the dish path's age ring. */
export const DISH_WAIT_CRITICAL_MINUTES = 40

export type DishWaitTone = 'normal' | 'warning' | 'danger' | 'critical'

export function dishWaitTone(orderedAt: string, now: Date): DishWaitTone {
  const minutes = (now.getTime() - Date.parse(orderedAt)) / 60_000
  if (minutes >= DISH_WAIT_CRITICAL_MINUTES) return 'critical'
  if (minutes >= KITCHEN_WAIT_DANGER_MINUTES) return 'danger'
  if (minutes >= KITCHEN_WAIT_WARNING_MINUTES) return 'warning'
  return 'normal'
}

// ── The kitchen's lines, notes included (design D7) ──────────────────────────

/** One kitchen's slot on a counter card, judged only on the food it carries. */
export type KitchenDishState = 'sent' | 'acknowledged' | 'ready' | 'handed_over'

export interface DishKitchenLineFacts {
  menuItemId: string | null
  itemName: string
  quantity: number
  note?: string | null
}

/** A dish and its note are one: "two shawarmas, one without sauce" is two dishes. */
function dishKitchenKey(line: DishKitchenLineFacts): string {
  return `${line.menuItemId ?? `name:${line.itemName}`}${line.note ? `|note:${line.note}` : ''}`
}

function dishTotals(
  lines: readonly DishKitchenLineFacts[],
): Map<string, { name: string; note: string | null; quantity: number }> {
  const byKey = new Map<string, { name: string; note: string | null; quantity: number }>()
  for (const line of lines) {
    const key = dishKitchenKey(line)
    const held = byKey.get(key)
    byKey.set(key, {
      name: line.itemName,
      note: line.note ?? null,
      quantity: (held?.quantity ?? 0) + line.quantity,
    })
  }
  return byKey
}

/** The same food on both sides, a dish and its note counted as one. */
export function sameDishLines(
  a: readonly DishKitchenLineFacts[],
  b: readonly DishKitchenLineFacts[],
): boolean {
  const left = dishTotals(a)
  const right = dishTotals(b)
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key)?.quantity !== value.quantity) return false
  }
  return true
}

/**
 * What a dish ticks' card asks of the cook: `kitchenCardState`'s rule, with a
 * dish and its note as one dish, so a changed instruction is an edit.
 */
export function dishKitchenCardState(order: {
  status: 'open' | 'paid' | 'cancelled'
  lines: readonly DishKitchenLineFacts[]
  acknowledged: boolean
  latestAck: { lines: readonly DishKitchenLineFacts[] } | null
}): KitchenCardState {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.lines.length === 0) return 'cancelled'
  if (!order.acknowledged || order.latestAck === null) return 'new'
  return sameDishLines(order.lines, order.latestAck.lines) ? 'quiet' : 'edited'
}

export interface DishKitchenLineDiff {
  key: string
  itemName: string
  note: string | null
  quantity: number
  previousQuantity: number | null
  change: KitchenLineChange
}

/** What changed since the acknowledgement, a dish and its note as one line. */
export function diffDishKitchenLines(
  current: readonly DishKitchenLineFacts[],
  previous: readonly DishKitchenLineFacts[],
): DishKitchenLineDiff[] {
  const now = dishTotals(current)
  const before = dishTotals(previous)
  const rows: DishKitchenLineDiff[] = []
  const seen = new Set<string>()
  for (const line of current) {
    const key = dishKitchenKey(line)
    if (seen.has(key)) continue
    seen.add(key)
    const quantity = now.get(key)!.quantity
    const was = before.get(key)?.quantity ?? null
    rows.push({
      key,
      itemName: line.itemName,
      note: line.note ?? null,
      quantity,
      previousQuantity: was === quantity ? null : was,
      change: was === null ? 'added' : was === quantity ? 'same' : 'changed',
    })
  }
  for (const [key, value] of before) {
    if (now.has(key)) continue
    rows.push({
      key,
      itemName: value.name,
      note: value.note,
      quantity: 0,
      previousQuantity: value.quantity,
      change: 'removed',
    })
  }
  return rows
}
