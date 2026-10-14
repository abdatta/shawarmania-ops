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

// ── Waiting time on the counter's age ring (design D9) ───────────────────────

/** A darker, contrast-validated red from forty minutes, on the counter's ring only. */
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
