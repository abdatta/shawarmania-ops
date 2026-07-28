/**
 * Stock arithmetic. Pure, no I/O.
 *
 * Quantities are not money and are not integer paise: chicken is weighed in
 * kilograms and mayonnaise poured in litres, and the schema stores both as
 * Postgres `numeric`. Exact there; IEEE doubles here. Adding 0.1 kg to 0.2 kg in
 * JavaScript gives 0.30000000000000004, and an inventory screen that shows that
 * has the same class of defect the integer-paise rule exists to prevent, one
 * column over.
 *
 * So every sum and every displayed figure passes through `roundQuantity`.
 */

/**
 * Grams, millilitres, whole pieces. Finer than any unit this business measures
 * in, and coarse enough that binary error never survives it.
 */
export const QUANTITY_DECIMALS = 3

const QUANTITY_SCALE = 10 ** QUANTITY_DECIMALS

/** Round to the stored precision. Every quantity that reaches a screen goes through this. */
export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Expected a finite quantity, got ${String(value)}`)
  }
  return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE
}

/** Sum a run of deltas without letting binary error accumulate through it. */
export function sumQuantities(deltas: readonly number[]): number {
  return roundQuantity(deltas.reduce((running, delta) => roundQuantity(running + delta), 0))
}

/**
 * Whether an item has reached the point it was given a threshold for.
 *
 * At the threshold counts as low: running out at exactly the reorder point is
 * the case somebody set the number for.
 */
export function isLowStock(item: { currentQuantity: number; lowStockThreshold: number }): boolean {
  return item.currentQuantity <= item.lowStockThreshold
}

/**
 * The four kinds of stock movement. Kept as a literal union because the domain
 * layer imports from nothing — `fixtures.test-d.ts` proves it still matches the
 * database's `movement_type` enum, so a schema change breaks the build rather
 * than the ledger.
 */
export type MovementType = 'added' | 'used' | 'wasted' | 'correction'

/**
 * The signed delta a movement stores.
 *
 * **The sign comes from the kind of movement, not from the person recording
 * it.** Somebody counting stock at the end of a shift should type how much was
 * used, not remember to put a minus in front of it — and a stray minus on a
 * "used" entry would silently *add* stock that does not exist.
 *
 * A correction is the exception, and deliberately so: it is the one movement
 * whose direction is the whole point, so it takes the signed value as given.
 */
export function movementDelta(type: MovementType, quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new TypeError(`Expected a finite quantity, got ${String(quantity)}`)
  }
  const magnitude = roundQuantity(Math.abs(quantity))

  switch (type) {
    case 'added':
      return magnitude
    case 'used':
    case 'wasted':
      return -magnitude
    case 'correction':
      return roundQuantity(quantity)
  }
}

/** A quantity as a person would read it: `12.5 kg`, `240 piece`, never `12.500`. */
export function formatQuantity(quantity: number, unit: string): string {
  return `${roundQuantity(quantity)} ${unit}`
}

/** `+15` / `−8.5`, with a real minus sign rather than a hyphen. */
export function formatDelta(delta: number): string {
  const rounded = roundQuantity(delta)
  return rounded < 0 ? `−${Math.abs(rounded)}` : `+${rounded}`
}
