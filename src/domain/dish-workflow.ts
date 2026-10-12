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
