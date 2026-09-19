import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import {
  CustomerActionError,
  PARTIAL_PHONE_MIN_DIGITS,
  type AppRole,
  type CustomerIdentity,
  type CustomersAdapter,
} from '../adapters'
import { customerFixtures } from './fixtures/customers'

/**
 * The mock customer directory: a map in, promises out, no I/O anywhere.
 *
 * It enforces the boundary the database enforces rather than trusting a screen
 * to hide a button, because the boundary IS the feature here. Three rules,
 * matching `20260802000002_global_customer_identity.sql` clause for clause:
 *
 *   1. only a billing context may ask at all;
 *   2. only a complete canonical phone matches, and there is no method that
 *      could take anything else;
 *   3. `createOrGet` creates, or returns what it found — it never rewrites a
 *      saved profile from a till.
 *
 * The store is per demo SESSION rather than per role, so a customer saved at
 * the counter is still there after a role switch — the same reason the billing
 * and attendance mocks outlive their adapters.
 */

/** Exactly the sessions `app_may_look_up_customer()` admits. */
const MAY_LOOK_UP: readonly AppRole[] = ['biller']

export interface DemoCustomers {
  /** Keyed by canonical phone, which is what identity means here. */
  byPhone: Map<string, CustomerIdentity>
  /**
   * The canonical phones **this outlet has served**, newest first.
   *
   * **Deliberately a separate list from the directory above**, because that is
   * the real boundary: a partial number may only ever reach a customer this
   * counter has already served, and never the business-wide directory. In
   * production this is a join from the outlet's own bills; here it is a list,
   * because the boundary is what the mock has to enforce, not the SQL.
   *
   * Seeded with the fixtures so the demo counter behaves like an outlet that
   * has been trading a while rather than one that opened a minute ago.
   */
  servedAtThisOutlet: string[]
}

export function createDemoCustomers(): DemoCustomers {
  return {
    byPhone: new Map(
      customerFixtures.map((row) => [row.phone, { id: row.id, phone: row.phone, name: row.name }]),
    ),
    servedAtThisOutlet: customerFixtures.map((row) => row.phone),
  }
}

function requirePhone(input: string): string {
  const validation = validateIndianPhone(input)
  if (validation.phone === null) {
    throw new CustomerActionError(
      validation.error === 'required' ? 'phone_required' : 'phone_incomplete',
      phoneErrorMessage(validation.error ?? 'incomplete'),
    )
  }
  return validation.phone
}

export function createMockCustomersAdapter(
  customers: DemoCustomers,
  role: AppRole,
): CustomersAdapter {
  const requireBillingContext = () => {
    if (!MAY_LOOK_UP.includes(role)) {
      throw new CustomerActionError(
        'not_permitted',
        'This device cannot look up customers. Carry on with the bill.',
      )
    }
  }

  // Handed out as copies. A screen editing the object it was given must not
  // rename somebody in the directory as a side effect.
  const copy = (identity: CustomerIdentity): CustomerIdentity => ({ ...identity })

  return {
    async lookupByPhone(phone) {
      requireBillingContext()
      const canonical = requirePhone(phone)
      const found = customers.byPhone.get(canonical)
      if (found) noteServed(customers, canonical)
      return found ? copy(found) : null
    },

    async suggestByPartialPhone(partial) {
      requireBillingContext()
      const digits = partial.replace(/\D/g, '').slice(-10)
      // Below the floor there is nothing to answer, and nobody is asked.
      if (digits.length < PARTIAL_PHONE_MIN_DIGITS) return null

      // This outlet's own customers, most recently served first, and **one of
      // them or none**. Returning a list would make the counter a directory,
      // which is the one thing this path must never become — so the rest are
      // counted and nothing else about them leaves this function.
      const matching = customers.servedAtThisOutlet
        .map((phone) => customers.byPhone.get(phone))
        .filter((identity): identity is CustomerIdentity =>
          Boolean(identity?.phone.slice(-10).startsWith(digits)),
        )
      const [best] = matching
      return best ? { customer: copy(best), otherMatches: matching.length - 1 } : null
    },

    async createOrGet({ phone, name }) {
      requireBillingContext()
      const canonical = requirePhone(phone)

      const existing = customers.byPhone.get(canonical)
      // The rule this whole change turns on: a differing name at the counter
      // goes on the bill's snapshot, never over the saved profile.
      if (existing) {
        noteServed(customers, canonical)
        return copy(existing)
      }

      const created: CustomerIdentity = {
        id: `d8000000-0000-4000-a000-${String(customers.byPhone.size + 100).padStart(12, '0')}`,
        phone: canonical,
        name: name?.trim() ? name.trim() : null,
      }
      customers.byPhone.set(canonical, created)
      noteServed(customers, canonical)
      return copy(created)
    },
  }
}

/** Most recently served first, which is the order a suggestion is picked in. */
function noteServed(customers: DemoCustomers, phone: string): void {
  customers.servedAtThisOutlet = [
    phone,
    ...customers.servedAtThisOutlet.filter((served) => served !== phone),
  ]
}
