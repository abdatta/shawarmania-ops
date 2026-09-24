import type { CustomerTier } from '../../adapters'
import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { DEMO_OWNER_ID } from './personas'

/**
 * The demo customer directory: a handful of people, each there to make one
 * moment demonstrable.
 *
 * At the counter there are still only two moments that matter — a phone that is
 * recognised and a phone that is not — and a customer directory is still a thing
 * no counter can browse. The rest exist for the owner's customer surface
 * (a-gold-member-is-a-label), which is the one place a list of customers is
 * shown, and which needs a member, a non-member worth making one, somebody who
 * lost gold and got it back, and somebody who stopped coming.
 *
 * Typed as `Tables<'customers'>`, so a fixture the database could not serve
 * fails to compile. Note there is no `outlet_id` to give one: since
 * global-customer-identity this row belongs to the business, not to a shop.
 */

export const DEMO_RETURNING_CUSTOMER_PHONE = '+919000000101'
export const DEMO_UNNAMED_CUSTOMER_PHONE = '+919000000102'
/** A member with one unbroken spell of gold. */
export const DEMO_MEMBER_CUSTOMER_PHONE = '+919000000103'
/** The most frequent customer this month, and not a member — the owner's obvious candidate. */
export const DEMO_REGULAR_CUSTOMER_PHONE = '+919000000104'
/** Everything they did is older than thirty days. */
export const DEMO_LAPSED_CUSTOMER_PHONE = '+919000000105'

const customerId = (n: number) => `d8000000-0000-4000-a000-${String(n).padStart(12, '0')}`

/** Nine thousand upward is not an allocated Indian mobile range. */
export const customerFixtures: Tables<'customers'>[] = [
  {
    // A member who lost gold once and was given it back — the card reads
    // "since" the second grant, and the first spell is on no screen.
    id: customerId(1),
    phone: DEMO_RETURNING_CUSTOMER_PHONE,
    name: 'Ritika Sen',
    created_at: '2026-03-14T09:12:00.000Z',
    last_used_at: '2026-07-30T13:41:00.000Z',
  },
  // A customer who has never given a name. The common case at a counter, and
  // the one a form that assumed a name would render as an empty row.
  {
    id: customerId(2),
    phone: DEMO_UNNAMED_CUSTOMER_PHONE,
    name: null,
    created_at: '2026-07-02T18:05:00.000Z',
    last_used_at: '2026-07-02T18:05:00.000Z',
  },
  {
    id: customerId(3),
    phone: DEMO_MEMBER_CUSTOMER_PHONE,
    name: 'Arjun Das',
    created_at: '2026-04-02T12:30:00.000Z',
    last_used_at: '2026-08-20T19:10:00.000Z',
  },
  {
    // Misspelt on purpose: the name was typed at a counter, and correcting it
    // from the owner's card is part of the walkthrough.
    id: customerId(4),
    phone: DEMO_REGULAR_CUSTOMER_PHONE,
    name: 'Moumta Ghosh',
    created_at: '2026-05-21T14:02:00.000Z',
    last_used_at: '2026-08-28T13:15:00.000Z',
  },
  {
    id: customerId(5),
    phone: DEMO_LAPSED_CUSTOMER_PHONE,
    name: 'Sourav Pal',
    created_at: '2026-02-09T20:44:00.000Z',
    last_used_at: '2026-08-01T20:20:00.000Z',
  },
  {
    id: customerId(6),
    phone: '+919000000106',
    name: 'Priyanka Roy',
    created_at: '2026-06-11T13:00:00.000Z',
    last_used_at: '2026-08-30T13:00:00.000Z',
  },
  {
    id: customerId(7),
    phone: '+919000000107',
    name: 'Imran Sheikh',
    created_at: '2026-07-19T19:45:00.000Z',
    last_used_at: '2026-09-01T19:45:00.000Z',
  },
]

export function customerIdForPhone(phone: string): string {
  const found = customerFixtures.find((row) => row.phone === phone)
  if (!found) throw new Error(`No demo customer holds ${phone}.`)
  return found.id
}

/**
 * One spell of membership: granted, and possibly revoked.
 *
 * **A revocation ends a spell; it never deletes one.** The record is what a
 * future automatic rule reads to learn that a person took a membership away, so
 * that it does not hand it straight back. A re-grant is a new spell.
 *
 * Instants are held as business days back from today, like the bill seeds, so a
 * walkthrough always shows a plausible recent history.
 */
export interface MembershipSpellSeed {
  phone: string
  grantedDaysAgo: number
  revokedDaysAgo?: number
}

export const membershipSeeds: MembershipSpellSeed[] = [
  { phone: DEMO_RETURNING_CUSTOMER_PHONE, grantedDaysAgo: 110, revokedDaysAgo: 62 },
  { phone: DEMO_RETURNING_CUSTOMER_PHONE, grantedDaysAgo: 41 },
  { phone: DEMO_MEMBER_CUSTOMER_PHONE, grantedDaysAgo: 24 },
]

/** Who granted and revoked every seeded spell: the owner, who is the only one who may. */
export const MEMBERSHIP_SEED_ACTOR = DEMO_OWNER_ID

/**
 * Whether the seeded history made this customer a member `daysAgo` business days
 * back. The store snapshots a bill's tier from it, which is what the real
 * command will do at the moment of sale.
 */
export function seededTierAt(phone: string, daysAgo: number): CustomerTier | null {
  const held = membershipSeeds.some(
    (spell) =>
      spell.phone === phone &&
      spell.grantedDaysAgo >= daysAgo &&
      (spell.revokedDaysAgo === undefined || spell.revokedDaysAgo < daysAgo),
  )
  return held ? 'gold' : null
}

/**
 * The customers' visits **before** the demo's four trading days.
 *
 * The demo store holds four days of bills at each outlet and nothing older, by
 * design — the drawer, the ledger and the overview are all built on it. A
 * thirty-day figure over four days would only ever demonstrate an empty card, so
 * the directory carries the older part of its customers' history here, reduced
 * to exactly what the owner's figures read from a bill: where, when, how much,
 * and whether it was voided.
 *
 * The owner's adapter reads these **together with** the store's own bills that
 * carry a customer, so a sale rung at the demo counter for one of these people
 * moves their card. Every seed here is four or more days back, so nothing in
 * this list can contradict a figure the ledger shows for the store's days.
 */
export interface CustomerVisitSeed {
  phone: string
  outletId: string
  /** Business days back from today. Always four or more. */
  daysAgo: number
  /** IST wall-clock time on that business day. */
  time: string
  totalPaise: number
  voided?: true
}

const K = OUTLET_KALYANI_ID
const N = OUTLET_KANCHRAPARA_ID

export const customerVisitSeeds: CustomerVisitSeed[] = [
  // Ritika — a gold regular across both outlets, with one voided bill that
  // must count for nothing.
  ...(
    [
      [5, K, 45800],
      [8, N, 31800],
      [11, K, 52600],
      [15, K, 39800],
      [19, K, 61400],
      [22, N, 27900],
      [27, K, 44200],
      [34, K, 35600],
      [41, K, 29800],
    ] as const
  ).map(([daysAgo, outletId, totalPaise]) => ({
    phone: DEMO_RETURNING_CUSTOMER_PHONE,
    outletId,
    daysAgo,
    time: '13:10',
    totalPaise,
  })),
  {
    phone: DEMO_RETURNING_CUSTOMER_PHONE,
    outletId: K,
    daysAgo: 13,
    time: '20:05',
    totalPaise: 33800,
    voided: true,
  },

  // Arjun — gold, comes in about once a week.
  ...(
    [
      [6, K, 39800],
      [12, K, 41600],
      [20, K, 25900],
      [26, K, 37400],
    ] as const
  ).map(([daysAgo, outletId, totalPaise]) => ({
    phone: DEMO_MEMBER_CUSTOMER_PHONE,
    outletId,
    daysAgo,
    time: '19:30',
    totalPaise,
  })),

  // Moumita — the most frequent customer this month, and not a member.
  ...(
    [
      [4, K, 19900],
      [5, K, 24800],
      [7, N, 19900],
      [9, K, 31800],
      [10, K, 19900],
      [14, K, 22400],
      [16, N, 19900],
      [18, K, 27600],
      [21, K, 19900],
      [24, K, 29800],
      [28, K, 19900],
    ] as const
  ).map(([daysAgo, outletId, totalPaise]) => ({
    phone: DEMO_REGULAR_CUSTOMER_PHONE,
    outletId,
    daysAgo,
    time: '12:45',
    totalPaise,
  })),

  // Sourav — used to come, and stopped. Nothing in the last thirty days.
  ...(
    [
      [38, N, 41800],
      [45, N, 36900],
      [52, N, 29800],
    ] as const
  ).map(([daysAgo, outletId, totalPaise]) => ({
    phone: DEMO_LAPSED_CUSTOMER_PHONE,
    outletId,
    daysAgo,
    time: '20:20',
    totalPaise,
  })),

  {
    phone: DEMO_UNNAMED_CUSTOMER_PHONE,
    outletId: K,
    daysAgo: 17,
    time: '18:05',
    totalPaise: 19900,
  },
  { phone: '+919000000106', outletId: K, daysAgo: 9, time: '13:00', totalPaise: 34800 },
  { phone: '+919000000106', outletId: K, daysAgo: 23, time: '13:20', totalPaise: 28900 },
  { phone: '+919000000107', outletId: N, daysAgo: 4, time: '19:45', totalPaise: 22900 },
  { phone: '+919000000107', outletId: N, daysAgo: 25, time: '19:10', totalPaise: 19900 },
]
