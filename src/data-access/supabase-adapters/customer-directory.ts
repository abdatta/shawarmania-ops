import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { normalizeIndianPhone } from '../../../shared/phone'
import { parseCustomerQuery } from '@/domain'
import {
  CustomerActionError,
  DIRECTORY_PAGE_SIZE,
  type CustomerDirectoryAdapter,
  type DirectoryCustomerCard,
  type DirectoryCustomerRow,
} from '../adapters'
import type { Database } from '../database.types'

/**
 * The real management customer adapter (a-gold-member-is-a-label): the owner's
 * directory, and a Franchise Admin's over their own outlets.
 *
 * **One outlet per call** (a-regular-earns-points-and-gold, D13): every method
 * names the outlet the Customers page has chosen, and every function behind it
 * authorises that outlet from the caller's own assignments — the owner, or a
 * Franchise Admin of that outlet — before it reads a row. Naming an outlet the
 * caller does not manage is refused, not narrowed; the scoped pieces
 * underneath are revoked from every client role.
 *
 * The figures on a row and a card are summed from that outlet's bills when
 * asked for. Nothing here, and nothing in the database, stores them on the
 * customer.
 */
export function createSupabaseCustomerDirectoryAdapter(
  client: SupabaseClient<Database>,
): CustomerDirectoryAdapter {
  return {
    async list(outletId, which, offset, order = 'newest') {
      const { data, error } = await client.rpc('customer_directory_list', {
        p_outlet: outletId,
        p_list: which,
        p_offset: offset,
        p_order: order,
      })
      if (error) throw toDirectoryError(error, 'read')
      const rows = data ?? []
      // One row past a page comes back when there is a next one, so the list
      // knows to keep going without asking for a count.
      return {
        rows: rows.slice(0, DIRECTORY_PAGE_SIZE).map(toRow),
        next: rows.length > DIRECTORY_PAGE_SIZE ? offset + DIRECTORY_PAGE_SIZE : null,
      }
    },

    async search(outletId, query) {
      // Below three of either there is nothing to ask, and nobody is asked.
      if (parseCustomerQuery(query).kind === 'too-short') return { matches: [], more: 0 }
      const { data, error } = await client.rpc('customer_directory_search', {
        p_outlet: outletId,
        p_query: query,
      })
      if (error) throw toDirectoryError(error, 'read')
      const rows = data ?? []
      return {
        matches: rows.map(toRow),
        // Each row carries how many matched in all; the rest are a count, and
        // the way to them is a longer query.
        more: Math.max(0, (rows[0]?.matched ?? 0) - rows.length),
      }
    },

    async card(outletId, customerId) {
      const { data, error } = await client.rpc('customer_directory_card', {
        p_outlet: outletId,
        p_customer: customerId,
      })
      if (error) throw toDirectoryError(error, 'read')
      return toCard(data?.[0])
    },

    async rename(outletId, customerId, name) {
      const trimmed = name.trim()
      if (!trimmed) {
        throw new CustomerActionError('name_required', 'A name cannot be left empty.')
      }
      const { data, error } = await client.rpc('customer_rename', {
        p_outlet: outletId,
        p_customer: customerId,
        p_name: trimmed,
      })
      if (error) throw toDirectoryError(error, 'rename')
      return toCard(data?.[0])
    },

    async grantMembership(outletId, customerId) {
      const { data, error } = await client.rpc('customer_membership_grant', {
        p_outlet: outletId,
        p_customer: customerId,
      })
      if (error) throw toDirectoryError(error, 'write')
      return toCard(data?.[0])
    },

    async revokeMembership(outletId, customerId) {
      const { data, error } = await client.rpc('customer_membership_revoke', {
        p_outlet: outletId,
        p_customer: customerId,
      })
      if (error) throw toDirectoryError(error, 'write')
      return toCard(data?.[0])
    },
  }
}

function toRow(row: {
  id: string
  phone: string
  name: string | null
  is_member: boolean
  member_until: string | null
  visits_30d: number
}): DirectoryCustomerRow {
  return {
    id: row.id,
    phone: normalizeIndianPhone(row.phone) ?? row.phone,
    name: row.name,
    tier: row.is_member ? 'gold' : null,
    memberUntil: row.is_member ? row.member_until : null,
    visits30d: row.visits_30d,
  }
}

type CardRow = Database['public']['Functions']['customer_directory_card']['Returns'][number]

/** No row is a customer this reader may not know exists, which reads exactly as nobody. */
function toCard(row: CardRow | undefined): DirectoryCustomerCard {
  if (!row) {
    throw new CustomerActionError('not_found', 'That customer is no longer in the directory.')
  }
  return {
    id: row.id,
    phone: normalizeIndianPhone(row.phone) ?? row.phone,
    name: row.name,
    memberSince: row.member_since,
    memberUntil: row.member_until,
    grantedVia:
      row.granted_via === 'counter' || row.granted_via === 'management' ? row.granted_via : null,
    grantedByName: row.granted_by_name,
    pointsBalance: row.points_balance,
    visits30d: row.visits_30d,
    spend30dPaise: row.spend_30d_paise,
    lastSeenAt: row.last_seen_at,
    customerSince: row.customer_since,
    scope: row.scope === 'business' ? 'business' : 'outlets',
    editable: row.editable,
  }
}

/**
 * The SQLSTATEs the management functions raise. A refused WRITE is almost
 * always a manager meeting a customer another outlet also serves — the one
 * refusal the card can predict and still meet, if the customer visited a second
 * outlet after it was read — so that is the sentence it gets.
 */
function toDirectoryError(
  error: PostgrestError,
  kind: 'read' | 'rename' | 'write',
): CustomerActionError {
  switch (error.code) {
    case '42501':
      // A rename is the one write a manager can meet with a customer another
      // outlet also serves; gold is the outlet's own, so a refused gold write
      // is an outlet this reader does not manage (a-regular-earns-points-and-
      // gold, D4).
      return kind === 'rename'
        ? new CustomerActionError(
            'not_permitted',
            'This customer has also bought at another outlet, so only the owner can rename them.',
          )
        : kind === 'write'
          ? new CustomerActionError(
              'not_permitted',
              'Only the owner or this outlet\u2019s manager changes gold here.',
            )
          : new CustomerActionError('not_permitted', 'Customers are managed from the office.')
    case 'P0002':
      return new CustomerActionError('not_found', 'That customer is no longer in the directory.')
    case '22023':
      return new CustomerActionError('name_required', 'A name cannot be left empty.')
    case '23514':
      return new CustomerActionError('gold_off', 'This outlet does not have gold members.')
    default:
      return new CustomerActionError('failed', 'The customer directory could not be reached.')
  }
}
