import { CustomerActionError, type CustomerDirectoryAdapter } from '../adapters'

/**
 * The real owner customer adapter — **deliberately not connected yet**.
 *
 * `DataAdapters` is total, so the real tree has to supply one today. The
 * owner's Customers surface is `demo`-gated until a-gold-member-is-a-label's
 * database section writes the membership table, the owner lookup, the two
 * lists and the derived figures; until then there is nothing on the server for
 * this to call, and inventing an answer would be worse than refusing.
 *
 * Every method refuses with the same code a refused owner call would carry, so
 * a screen that somehow reached it in live mode says "not available" rather
 * than showing an empty directory as though it were the truth.
 */
export function createSupabaseCustomerDirectoryAdapter(): CustomerDirectoryAdapter {
  const notYet = async (): Promise<never> => {
    throw new CustomerActionError('not_available', 'Customers is not available yet.')
  }
  return {
    list: notYet,
    search: notYet,
    card: notYet,
    rename: notYet,
    grantMembership: notYet,
    revokeMembership: notYet,
  }
}
