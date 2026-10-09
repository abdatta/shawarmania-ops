/**
 * The kitchen screen's rules (#70), as pure functions over the board the
 * database returns. Nothing here reads a clock it is not given or a store it
 * does not take, so every rule is a unit test away.
 */

/** The minimum a card needs to be judged; the board's `KitchenOrder` satisfies it. */
export interface KitchenCardFacts {
  status: 'open' | 'paid' | 'cancelled'
  lines: readonly KitchenLineFacts[]
  acknowledged: boolean
  latestAck: { kind: 'new' | 'edit' | 'cancel'; lines: readonly KitchenLineFacts[] } | null
}

export interface KitchenLineFacts {
  menuItemId: string | null
  itemName: string
  quantity: number
}

/**
 * What a card is asking of the cook.
 *
 *  - `new`        this tablet has not acknowledged the order;
 *  - `edited`     its lines here differ from the lines last acknowledged here;
 *  - `cancelled`  it was cancelled, or lost every line here after being
 *                 acknowledged with one (the board keeps such an order only
 *                 until that loss is acknowledged);
 *  - `quiet`      nothing to acknowledge.
 *
 * An edit before the first acknowledgement keeps a card `new`: the cook never
 * acknowledged the old version, so there is nothing to compare against.
 */
export type KitchenCardState = 'new' | 'edited' | 'cancelled' | 'quiet'

export function kitchenCardState(order: KitchenCardFacts): KitchenCardState {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.lines.length === 0) return 'cancelled'
  if (!order.acknowledged || order.latestAck === null) return 'new'
  return sameLines(order.lines, order.latestAck.lines) ? 'quiet' : 'edited'
}

/** Which ACK a card's state asks for, or none. */
export function acknowledgementFor(state: KitchenCardState): 'new' | 'edit' | 'cancel' | null {
  switch (state) {
    case 'new':
      return 'new'
    case 'edited':
      return 'edit'
    case 'cancelled':
      return 'cancel'
    case 'quiet':
      return null
  }
}

function lineKey(line: KitchenLineFacts): string {
  return line.menuItemId ?? `name:${line.itemName}`
}

/** Quantities by dish, so two lines of one dish compare as one. */
function totals(
  lines: readonly KitchenLineFacts[],
): Map<string, { name: string; quantity: number }> {
  const byKey = new Map<string, { name: string; quantity: number }>()
  for (const line of lines) {
    const key = lineKey(line)
    const held = byKey.get(key)
    byKey.set(key, { name: line.itemName, quantity: (held?.quantity ?? 0) + line.quantity })
  }
  return byKey
}

export function sameLines(a: readonly KitchenLineFacts[], b: readonly KitchenLineFacts[]): boolean {
  const left = totals(a)
  const right = totals(b)
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key)?.quantity !== value.quantity) return false
  }
  return true
}

export type KitchenLineChange = 'same' | 'added' | 'removed' | 'changed'

export interface KitchenLineDiff {
  key: string
  itemName: string
  quantity: number
  /** What was acknowledged, where the quantity moved or the line went. */
  previousQuantity: number | null
  change: KitchenLineChange
}

/**
 * What changed since the last acknowledgement: added lines, removed lines
 * (kept so they can be struck through) and quantities old → new. Current lines
 * come first in their own order, removed ones after.
 */
export function diffKitchenLines(
  current: readonly KitchenLineFacts[],
  previous: readonly KitchenLineFacts[],
): KitchenLineDiff[] {
  const now = totals(current)
  const before = totals(previous)
  const rows: KitchenLineDiff[] = []
  const seen = new Set<string>()
  for (const line of current) {
    const key = lineKey(line)
    if (seen.has(key)) continue
    seen.add(key)
    const quantity = now.get(key)!.quantity
    const was = before.get(key)?.quantity ?? null
    rows.push({
      key,
      itemName: line.itemName,
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
      quantity: 0,
      previousQuantity: value.quantity,
      change: 'removed',
    })
  }
  return rows
}

/** Minutes after which a waiting order reads warning, then danger. Owner may tune. */
export const KITCHEN_WAIT_WARNING_MINUTES = 10
export const KITCHEN_WAIT_DANGER_MINUTES = 20

export type KitchenWaitTone = 'normal' | 'warning' | 'danger'

export function kitchenWaitTone(orderedAt: string, now: Date): KitchenWaitTone {
  const minutes = (now.getTime() - Date.parse(orderedAt)) / 60_000
  if (minutes >= KITCHEN_WAIT_DANGER_MINUTES) return 'danger'
  if (minutes >= KITCHEN_WAIT_WARNING_MINUTES) return 'warning'
  return 'normal'
}

/** `0 m`, `14 m`, `2 h`, `2 d`: how long an order has waited, at a glance. */
export function formatKitchenWait(orderedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(orderedAt)) / 60_000))
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

/** Seconds of read age after which the screen says it may be out of date. */
export const KITCHEN_STALE_AFTER_MS = 45_000
/** How often the screen re-reads while visible, whatever the live channel says. */
export const KITCHEN_REREAD_MS = 20_000
