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
