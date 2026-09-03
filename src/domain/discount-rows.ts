/**
 * Grouping a bill's menu discounts into the rows a person reads.
 *
 * A menu discount is stored on each line it reduced, so the row a person reads
 * is a sum over lines — and that sum has to come out the same wherever a bill is
 * read. It is read in two places that cannot share one implementation:
 *
 *   - the **counter's bill column**, over a draft in progress, which has no
 *     rows in the database yet and therefore must group in TypeScript;
 *   - the **customer's receipt**, over a settled bill, which is grouped by
 *     `public.bill_public_discount_rows` in SQL so the page performs no
 *     arithmetic of its own.
 *
 * Two implementations of one rule, which is exactly the situation the repo
 * already handles for bill totals: with a shared case table proving they agree,
 * rather than with hope. `discount-row-cases.json` is that table,
 * `discount-rows.test.ts` runs it through this function, and
 * `supabase/tests/rest/zz-public-receipt.test.ts` runs the same rows through the
 * database.
 *
 * The rule itself is the owner's, and it groups **by what the customer was
 * actually given**: a percentage groups by that percentage, and a rupee discount
 * by its per-unit amount, because two lines at "twenty rupees off each" are one
 * discount however different their totals.
 */

/** One line as this grouping needs to see it. */
export interface DiscountedLine {
  quantity: number
  discountPaise?: number | null | undefined
  discountPercentBp?: number | null | undefined
  categoryName?: string | null | undefined
}

/** One menu discount as a row, before anybody decides how to word it. */
export interface MenuDiscountGroup {
  basis: 'percent' | 'amount'
  /** Hundredths of a percent, for a percentage discount. Null otherwise. */
  valueBp: number | null
  /** Paise per unit, for a rupee discount. Null otherwise. */
  valuePaise: number | null
  /** The categories this value reached, in the order the lines carried them. */
  categories: string[]
  amountPaise: number
}

export function groupMenuDiscounts(lines: readonly DiscountedLine[]): MenuDiscountGroup[] {
  const groups = new Map<string, MenuDiscountGroup>()

  for (const line of lines) {
    const paise = line.discountPaise ?? 0
    if (paise <= 0) continue

    const percentBp = line.discountPercentBp ?? null
    const perUnit = percentBp === null ? Math.round(paise / Math.max(1, line.quantity)) : null
    const key = percentBp === null ? `a${perUnit}` : `p${percentBp}`

    const group =
      groups.get(key) ??
      ({
        basis: percentBp === null ? 'amount' : 'percent',
        valueBp: percentBp,
        valuePaise: perUnit,
        categories: [],
        amountPaise: 0,
      } satisfies MenuDiscountGroup)

    if (line.categoryName && !group.categories.includes(line.categoryName)) {
      group.categories.push(line.categoryName)
    }
    group.amountPaise += paise
    groups.set(key, group)
  }

  // Ordered by the grouping key, which is what the database orders by too. A
  // stable order is what lets the two be compared row for row at all.
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => g)
}

/** The label a row carries: `15%` for a percentage, `₹20` for an amount. */
export function menuDiscountLabel(
  group: MenuDiscountGroup,
  formatPaise: (paise: number) => string,
): string {
  return group.basis === 'percent'
    ? `${(group.valueBp ?? 0) / 100}%`
    : formatPaise(group.valuePaise ?? 0)
}
