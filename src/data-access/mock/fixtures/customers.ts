import type { Tables } from '../../database.types'

/**
 * The demo customer directory: two returning customers and nobody else.
 *
 * Deliberately tiny. A directory is not a thing this product shows anybody —
 * there is no browse surface and no database verb behind one — so the fixtures
 * exist to make exactly two moments demonstrable: a phone that is recognised,
 * and a phone that is not. A long list would suggest a screen that does not and
 * will not exist.
 *
 * Typed as `Tables<'customers'>`, so a fixture the database could not serve
 * fails to compile. Note there is no `outlet_id` to give one: since
 * global-customer-identity this row belongs to the business, not to a shop.
 */

export const DEMO_RETURNING_CUSTOMER_PHONE = '+919000000101'
export const DEMO_UNNAMED_CUSTOMER_PHONE = '+919000000102'

/** Nine thousand upward is not an allocated Indian mobile range. */
export const customerFixtures: Tables<'customers'>[] = [
  {
    id: 'd8000000-0000-4000-a000-000000000001',
    phone: DEMO_RETURNING_CUSTOMER_PHONE,
    name: 'Ritika Sen',
    created_at: '2026-05-14T09:12:00.000Z',
    last_used_at: '2026-07-30T13:41:00.000Z',
  },
  // A customer who has never given a name. The common case at a counter, and
  // the one a form that assumed a name would render as an empty row.
  {
    id: 'd8000000-0000-4000-a000-000000000002',
    phone: DEMO_UNNAMED_CUSTOMER_PHONE,
    name: null,
    created_at: '2026-07-02T18:05:00.000Z',
    last_used_at: '2026-07-02T18:05:00.000Z',
  },
]
