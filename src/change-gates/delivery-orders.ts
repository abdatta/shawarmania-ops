import { bootSnapshot } from './snapshot'

/**
 * The `delivery-orders` toggle point for the adapters
 * (delivery-orders-are-made-not-billed, design D6). A data adapter is not a
 * component, so it reads the page's frozen snapshot directly. On, the counter,
 * the kitchen and the figure pages read through the `_v3` reads that know a
 * delivery order; off, through today's.
 */
export function onDeliveryOrders(): boolean {
  return bootSnapshot()['delivery-orders']
}
