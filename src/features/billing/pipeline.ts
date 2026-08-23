import type { BillingOrder } from '@/data-access/adapters'

/**
 * The counter's pipeline, derived — never stored.
 *
 * Two questions every order answers independently: *is the food made?*
 * (`prepared_at`) and *is it paid?* (`status`). Their intersection is the three
 * sections the counter works out of:
 *
 * | Section               | Predicate                                  |
 * |-----------------------|--------------------------------------------|
 * | Preparing             | unpaid and unprepared, or paid-unprepared  |
 * | Unpaid Prepared Orders| open and prepared                          |
 * | Bills this shift      | paid *and* prepared — a settled bill       |
 *
 * A paid-but-unprepared order stays in Preparing wearing its Paid marker: that
 * is the upfront payer whose food is still being made, and marking it prepared
 * is what lands its bill in the money column. Cancelled orders are nobody's
 * work in flight and appear in neither section.
 */
export interface PipelineSections {
  preparing: BillingOrder[]
  unpaidPrepared: BillingOrder[]
}

export function splitPipeline(orders: readonly BillingOrder[]): PipelineSections {
  const preparing: BillingOrder[] = []
  const unpaidPrepared: BillingOrder[] = []
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    if (order.status === 'open') {
      if (order.preparedAt === null) preparing.push(order)
      else unpaidPrepared.push(order)
    } else if (order.status === 'paid' && order.preparedAt === null) {
      preparing.push(order)
    }
    // Paid and prepared: fully done, listed among the bills instead.
  }
  return { preparing, unpaidPrepared }
}

/** True while this tablet may still unwind a payment taken at `paidAt`. */
export function unwindWindowOpen(paidAt: string, now: number, windowMs: number): boolean {
  return Date.parse(paidAt) + windowMs > now
}
