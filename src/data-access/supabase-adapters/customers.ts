import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { normalizeIndianPhone, phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import { CustomerActionError, type CustomerIdentity, type CustomersAdapter } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real customer adapter — **connected, and connected through two functions
 * rather than a table**.
 *
 * This is the only real adapter in the tree that cannot fall back to a plain
 * select, because there is no grant to fall back to: `customers` is revoked
 * from every client session, and `customer_lookup_by_phone` /
 * `customer_create_or_get` are the entire client-visible surface of the global
 * directory. See 20260802000002_global_customer_identity.sql.
 *
 * The billing screens are still `demo`-gated, so nothing calls this yet; #31
 * builds the surface and #10 puts real money behind it. It is written now
 * because the boundary it speaks to is real now, and a `*-live` change that had
 * to invent this adapter as well would be doing two jobs at once.
 */
export function createSupabaseCustomersAdapter(client: SupabaseClient<Database>): CustomersAdapter {
  return {
    async lookupByPhone(phone) {
      // Refused here, before a round trip. The database refuses it too — that
      // is what the pgTAP and REST probes assert — but a counter typing a
      // half-number should not spend a network call or a slice of its rate
      // budget discovering what the field could have told it.
      const validation = validateIndianPhone(phone)
      if (validation.phone === null) {
        throw new CustomerActionError(
          validation.error === 'required' ? 'phone_required' : 'phone_incomplete',
          phoneErrorMessage(validation.error ?? 'incomplete'),
        )
      }

      const { data, error } = await client.rpc('customer_lookup_by_phone', {
        p_phone: validation.phone,
      })
      if (error) throw toCustomerError(error)

      // Zero rows is the answer "nobody has used this number", not a failure.
      const row = data?.[0]
      return row ? toIdentity(row) : null
    },

    async createOrGet({ phone, name }) {
      const validation = validateIndianPhone(phone)
      if (validation.phone === null) {
        throw new CustomerActionError(
          validation.error === 'required' ? 'phone_required' : 'phone_incomplete',
          phoneErrorMessage(validation.error ?? 'incomplete'),
        )
      }

      const trimmed = name?.trim()
      const { data, error } = await client.rpc('customer_create_or_get', {
        p_phone: validation.phone,
        ...(trimmed ? { p_name: trimmed } : {}),
      })
      if (error) throw toCustomerError(error)

      const row = data?.[0]
      if (!row) {
        // The function creates or returns; an empty result means neither
        // happened, and guessing an id here would attach a sale to nothing.
        throw new CustomerActionError('failed', 'The customer could not be saved.')
      }
      return toIdentity(row)
    },
  }
}

function toIdentity(row: { id: string; phone: string; name: string | null }): CustomerIdentity {
  return {
    id: row.id,
    // Belt and braces: the database returns canonical form, and anything else
    // reaching a screen would be a bug worth surfacing as a null rather than as
    // a number somebody might dial.
    phone: normalizeIndianPhone(row.phone) ?? row.phone,
    name: row.name,
  }
}

/**
 * The SQLSTATEs the two functions raise, turned into something a counter can
 * act on. Matching on the code rather than the message: the codes are the
 * contract the migration wrote down.
 */
function toCustomerError(error: PostgrestError): CustomerActionError {
  switch (error.code) {
    case '22023':
      return new CustomerActionError('phone_incomplete', phoneErrorMessage('incomplete'))
    case '42501':
      return new CustomerActionError(
        'not_permitted',
        'This device cannot look up customers. Carry on with the bill.',
      )
    case 'PT429':
      return new CustomerActionError(
        'rate_limited',
        'Too many customer lookups just now. Carry on with the bill.',
      )
    default:
      return new CustomerActionError('failed', 'The customer directory could not be reached.')
  }
}
