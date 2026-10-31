import { bootSnapshot } from './snapshot'

/**
 * The `auto-approve-at-the-shop` toggle point for the adapters
 * (a-check-in-at-the-shop-approves-itself, design D3). A data adapter is not a
 * component, so it reads the page's frozen snapshot directly, as the client's
 * request counting does for `tablet-health`. On, a check-in is sent to the command that approves a
 * day at the shop and honours the outlet's attendance rules; off, to today's.
 */
export function onAutoApproveAtTheShop(): boolean {
  return bootSnapshot()['auto-approve-at-the-shop']
}
