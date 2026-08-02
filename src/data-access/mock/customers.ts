import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import {
  CustomerActionError,
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
}

export function createDemoCustomers(): DemoCustomers {
  return {
    byPhone: new Map(
      customerFixtures.map((row) => [row.phone, { id: row.id, phone: row.phone, name: row.name }]),
    ),
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
      return found ? copy(found) : null
    },

    async createOrGet({ phone, name }) {
      requireBillingContext()
      const canonical = requirePhone(phone)

      const existing = customers.byPhone.get(canonical)
      // The rule this whole change turns on: a differing name at the counter
      // goes on the bill's snapshot, never over the saved profile.
      if (existing) return copy(existing)

      const created: CustomerIdentity = {
        id: `d8000000-0000-4000-a000-${String(customers.byPhone.size + 100).padStart(12, '0')}`,
        phone: canonical,
        name: name?.trim() ? name.trim() : null,
      }
      customers.byPhone.set(canonical, created)
      return copy(created)
    },
  }
}
