import { foldCategory } from './category-match'

/**
 * The one storage rule for expense-category text.
 *
 * Case is deliberately preserved: category names are often proper nouns. The
 * database owns an equivalent immutable function and refuses text that did not
 * pass this rule before it reached a row.
 */
export function normalizeCategory(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

/**
 * Whether a typed category collides with a reserved one, and which it is.
 *
 * A reserved category is owned by an origin other than a person — Hyperpure by
 * the supply reader — and cannot be typed. The collision is deliberately WIDER
 * than equality, mirroring `expense_category_reserved_owner` in the database:
 * the whole point of reserving a category is that no hand-typed row may carry
 * that cost, and the free-text rule's usual defence — that a refusal is beaten by
 * a different spelling — is exactly what must not be available here. So
 * "hyper pure", "HyperPure" and "Hyperpure Goods" all collide, by fold-equality,
 * squash-equality, or one squashed form containing the other.
 *
 * This is the form's early copy of the database's rule: it lets the surface
 * refuse before submitting, but the row is refused by the trigger regardless, so
 * a stale client cannot slip one through.
 */
export function reservedCategoryConflict(
  typed: string,
  reserved: readonly string[],
): string | null {
  const folded = foldCategory(typed)
  if (folded === '') return null
  const tight = folded.replace(/ /gu, '')

  let best: string | null = null
  for (const name of reserved) {
    const other = foldCategory(name)
    const otherTight = other.replace(/ /gu, '')
    if (otherTight === '') continue
    const hits =
      folded === other ||
      tight === otherTight ||
      tight.includes(otherTight) ||
      otherTight.includes(tight)
    // Prefer the longest reserved name that matches, so "Hyperpure Goods" is
    // attributed to "Hyperpure" rather than to a shorter accidental reservation.
    if (hits && (best === null || name.length > best.length)) best = name
  }
  return best
}
