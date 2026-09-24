import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import {
  customerMatchStrength,
  parseCustomerQuery,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import {
  CustomerActionError,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SEARCH_LIMIT,
  PARTIAL_PHONE_MIN_DIGITS,
  type AppRole,
  type CustomerIdentity,
  type CustomerTier,
  type CustomersAdapter,
  type DirectoryCustomerCard,
  type DirectoryCustomerRow,
  type DirectoryScope,
  type CustomerDirectoryAdapter,
} from '../adapters'
import {
  customerFixtures,
  customerIdForPhone,
  customerVisitSeeds,
  MEMBERSHIP_SEED_ACTOR,
  membershipSeeds,
} from './fixtures/customers'
import { outletFixtures } from './fixtures/outlets'
import { DEMO_OUTLET_ID, type DemoStore } from './store'

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
 * And a fourth, from a-gold-member-is-a-label: **the owner's path is a
 * different adapter with a different authority check**, and neither may reach
 * the other's. A till is told whether somebody is a member and nothing else; an
 * owner may read the lists and the card, and grant, revoke and rename, and a
 * till may do none of that.
 *
 * The store is per demo SESSION rather than per role, so a customer saved at
 * the counter is still there after a role switch — the same reason the billing
 * and attendance mocks outlive their adapters. That is also what lets the
 * walkthrough grant gold as the owner and see it at the counter.
 */

/** Exactly the sessions `app_may_look_up_customer()` admits. */
const MAY_LOOK_UP: readonly AppRole[] = ['biller']

/** A saved profile, as the directory holds it. The till is handed less. */
export interface DemoCustomerProfile {
  id: string
  phone: string
  name: string | null
  createdAt: string
}

/**
 * One spell of membership. A revocation fills in `revokedAt` and never deletes
 * the row; a re-grant is a new spell. The shape the membership table will have.
 */
export interface DemoMembershipSpell {
  customerId: string
  grantedAt: string
  grantedBy: string
  revokedAt: string | null
  revokedBy: string | null
}

/** One visit before the demo store's four trading days — see `customerVisitSeeds`. */
interface DemoCustomerVisit {
  customerId: string
  /** Where it was bought, which is what a manager's scope reads. */
  outletId: string
  businessDate: string
  paidAt: string
  totalPaise: number
  voided: boolean
}

export interface DemoCustomers {
  /** Today's business date, which the thirty-day window is measured against. */
  today: string
  /** Keyed by canonical phone, which is what identity means here. */
  byPhone: Map<string, DemoCustomerProfile>
  memberships: DemoMembershipSpell[]
  /** History older than the demo store holds. The store's own bills are read beside it. */
  olderVisits: DemoCustomerVisit[]
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

/** IST wall-clock on a business date, as an instant. Demo data, so IST is assumed. */
function instantAt(businessDate: string, time: string): string {
  return new Date(`${businessDate}T${time}:00+05:30`).toISOString()
}

function demoToday(): string {
  const cutover = outletFixtures.find((outlet) => outlet.id === DEMO_OUTLET_ID)
  return resolveBusinessDate(new Date(), cutover?.business_day_cutover ?? '04:00:00')
}

export function createDemoCustomers(today: string = demoToday()): DemoCustomers {
  const businessDate = (daysAgo: number) => shiftBusinessDate(today, -daysAgo)
  return {
    today,
    byPhone: new Map(
      customerFixtures.map((row) => [
        row.phone,
        { id: row.id, phone: row.phone, name: row.name, createdAt: row.created_at },
      ]),
    ),
    memberships: membershipSeeds.map((spell) => ({
      customerId: customerIdForPhone(spell.phone),
      grantedAt: instantAt(businessDate(spell.grantedDaysAgo), '21:30'),
      grantedBy: MEMBERSHIP_SEED_ACTOR,
      revokedAt:
        spell.revokedDaysAgo === undefined
          ? null
          : instantAt(businessDate(spell.revokedDaysAgo), '21:30'),
      revokedBy: spell.revokedDaysAgo === undefined ? null : MEMBERSHIP_SEED_ACTOR,
    })),
    olderVisits: customerVisitSeeds.map((seed) => ({
      customerId: customerIdForPhone(seed.phone),
      outletId: seed.outletId,
      businessDate: businessDate(seed.daysAgo),
      paidAt: instantAt(businessDate(seed.daysAgo), seed.time),
      totalPaise: seed.totalPaise,
      voided: seed.voided === true,
    })),
    servedAtThisOutlet: customerFixtures.map((row) => row.phone),
  }
}

/** The spell in force now, if any. There is at most one. */
function currentSpell(customers: DemoCustomers, customerId: string): DemoMembershipSpell | null {
  return (
    customers.memberships.find(
      (spell) => spell.customerId === customerId && spell.revokedAt === null,
    ) ?? null
  )
}

function currentTier(customers: DemoCustomers, customerId: string): CustomerTier | null {
  return currentSpell(customers, customerId) ? 'gold' : null
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

  // Handed out as fresh objects carrying exactly the till's four facts. A
  // screen editing the object it was given must not rename somebody in the
  // directory as a side effect — and the profile's own `createdAt` is not the
  // till's to know.
  const identity = (profile: DemoCustomerProfile): CustomerIdentity => ({
    id: profile.id,
    phone: profile.phone,
    name: profile.name,
    tier: currentTier(customers, profile.id),
  })

  return {
    async lookupByPhone(phone) {
      requireBillingContext()
      const canonical = requirePhone(phone)
      const found = customers.byPhone.get(canonical)
      if (found) noteServed(customers, canonical)
      return found ? identity(found) : null
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
        .filter((profile): profile is DemoCustomerProfile =>
          Boolean(profile?.phone.slice(-10).startsWith(digits)),
        )
      const [best] = matching
      return best ? { customer: identity(best), otherMatches: matching.length - 1 } : null
    },

    async createOrGet({ phone, name }) {
      requireBillingContext()
      const canonical = requirePhone(phone)

      const existing = customers.byPhone.get(canonical)
      // The rule this whole change turns on: a differing name at the counter
      // goes on the bill's snapshot, never over the saved profile.
      if (existing) {
        noteServed(customers, canonical)
        return identity(existing)
      }

      const created: DemoCustomerProfile = {
        id: `d8000000-0000-4000-a000-${String(customers.byPhone.size + 100).padStart(12, '0')}`,
        phone: canonical,
        name: name?.trim() ? name.trim() : null,
        createdAt: new Date().toISOString(),
      }
      customers.byPhone.set(canonical, created)
      noteServed(customers, canonical)
      return identity(created)
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

/** How many business dates the figures cover, today included. */
const WINDOW_DAYS = 30

/**
 * The management customer path over the same session directory: the owner's,
 * and a manager's over their own outlets.
 *
 * **Every figure is derived when it is read, from bills.** Nothing here writes
 * a count or a total onto a profile, because the real rule is that no such
 * column exists: #32 removed `bill_count` and `total_spend_paise` from
 * `customers` so they could never ride along in the till's lookup.
 *
 * **The scope is applied once, in `visitsOf`**, and every read is built on it —
 * which customers a manager can find, which appear on their lists, and every
 * figure on their card. The database function this stands in for will have the
 * same shape: one "which bills may this reader see" rule under everything, so
 * no read can forget it.
 *
 * The bills are two sets read together: the history before the demo store's
 * four trading days (`olderVisits`), and the store's own bills that carry this
 * customer — so a sale rung at the demo counter moves the card.
 */
export function createMockCustomerDirectoryAdapter(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'bills' | 'orders'>,
  role: AppRole,
  /** The outlets a manager's assignments name. Ignored for the owner. */
  managedOutletIds: readonly string[] = [],
  /** Who a grant or a revocation is recorded against. */
  actorId: string = MEMBERSHIP_SEED_ACTOR,
): CustomerDirectoryAdapter {
  // `app_is_owner()` reads everything; `app_outlets_for('franchise_admin')`
  // reads its own; nobody else reads at all.
  const scope: readonly string[] | null | 'refused' =
    role === 'super_admin' ? null : role === 'franchise_admin' ? managedOutletIds : 'refused'
  const directoryScope: DirectoryScope = scope === null ? 'business' : 'outlets'

  const requireReader = () => {
    if (scope === 'refused') {
      throw new CustomerActionError('not_permitted', 'Customers are managed from the office.')
    }
  }
  const inScope = (outletId: string) =>
    scope === null || (scope !== 'refused' && scope.includes(outletId))

  /**
   * Every bill this customer paid **that this reader may see**. A store bill is
   * theirs by its link, or — for a sale the demo counter settled without one,
   * which the real server links from the phone it carries — by the phone it
   * snapshotted.
   */
  const visitsOf = (profile: DemoCustomerProfile): DemoCustomerVisit[] => [
    ...customers.olderVisits.filter(
      (visit) => visit.customerId === profile.id && inScope(visit.outletId),
    ),
    ...store.bills
      .filter(
        (bill) =>
          inScope(bill.outlet_id) &&
          (bill.customer_id === profile.id ||
            (bill.customer_id === null && bill.customer_phone === profile.phone)),
      )
      .map((bill) => ({
        customerId: profile.id,
        outletId: bill.outlet_id,
        businessDate: bill.business_date,
        paidAt: bill.paid_at,
        totalPaise: bill.total_paise,
        voided: bill.status !== 'settled',
      })),
  ]

  /** An order still open at one of this reader's outlets, which bought nothing yet but was served. */
  const openOrderAt = (profile: DemoCustomerProfile) =>
    store.orders.find(
      (order) =>
        inScope(order.outlet_id) &&
        order.bill_id === null &&
        (order.customer_id === profile.id || order.customer_phone === profile.phone),
    )

  /**
   * Whether this reader may know this customer exists at all. The owner may
   * know everybody; a manager only somebody their own outlets have served.
   */
  const reachable = (profile: DemoCustomerProfile) =>
    scope === null || visitsOf(profile).length > 0 || openOrderAt(profile) !== undefined

  const reachableProfiles = () => [...customers.byPhone.values()].filter(reachable)

  /**
   * Every outlet this customer has ever been served at — **across the whole
   * business, whatever the reader's scope**. Only ever reduced to one yes or no
   * below; the list itself never leaves this adapter.
   */
  const servedOutletsOf = (profile: DemoCustomerProfile): Set<string> =>
    new Set([
      ...customers.olderVisits
        .filter((visit) => visit.customerId === profile.id)
        .map((visit) => visit.outletId),
      ...store.bills
        .filter(
          (bill) =>
            bill.customer_id === profile.id ||
            (bill.customer_id === null && bill.customer_phone === profile.phone),
        )
        .map((bill) => bill.outlet_id),
      ...store.orders
        .filter(
          (order) => order.customer_id === profile.id || order.customer_phone === profile.phone,
        )
        .map((order) => order.outlet_id),
    ])

  /**
   * May this reader change this customer? The owner always. A manager only
   * while every outlet the customer has been served at is theirs
   * [owner, 2026-09-24]: the name and the membership are the same at every
   * outlet, so a manager changing a shared customer would be changing another
   * outlet's customer.
   */
  const mayEdit = (profile: DemoCustomerProfile): boolean => {
    if (scope === null) return true
    if (scope === 'refused') return false
    const served = servedOutletsOf(profile)
    return served.size > 0 && [...served].every((outletId) => scope.includes(outletId))
  }

  /** Checked again at the moment of the write, never trusted from the card. */
  const requireEditor = (profile: DemoCustomerProfile) => {
    if (!mayEdit(profile)) {
      throw new CustomerActionError(
        'not_permitted',
        'This customer has also bought at another outlet, so only the owner can change them.',
      )
    }
  }

  const profileById = (customerId: string): DemoCustomerProfile => {
    for (const profile of customers.byPhone.values()) {
      // Out of reach answers exactly as absent does: a manager cannot learn
      // that a customer of another outlet exists by asking for their id.
      if (profile.id === customerId && reachable(profile)) return profile
    }
    throw new CustomerActionError('not_found', 'That customer is no longer in the directory.')
  }

  const windowStart = () => shiftBusinessDate(customers.today, -(WINDOW_DAYS - 1))

  /** One bill is one visit; a voided bill is neither a visit nor spend. */
  const figures = (profile: DemoCustomerProfile) => {
    const counted = visitsOf(profile).filter((visit) => !visit.voided)
    const inWindow = counted.filter((visit) => visit.businessDate >= windowStart())
    const lastSeenAt = counted.reduce<string | null>(
      (latest, visit) => (latest === null || visit.paidAt > latest ? visit.paidAt : latest),
      null,
    )
    const firstSeenAt = counted.reduce<string | null>(
      (earliest, visit) => (earliest === null || visit.paidAt < earliest ? visit.paidAt : earliest),
      null,
    )
    return {
      visits30d: inWindow.length,
      spend30dPaise: inWindow.reduce((sum, visit) => sum + visit.totalPaise, 0),
      lastSeenAt,
      firstSeenAt,
    }
  }

  const row = (profile: DemoCustomerProfile): DirectoryCustomerRow => ({
    id: profile.id,
    phone: profile.phone,
    name: profile.name,
    tier: currentTier(customers, profile.id),
    visits30d: figures(profile).visits30d,
  })

  const card = (profile: DemoCustomerProfile): DirectoryCustomerCard => {
    const { visits30d, spend30dPaise, lastSeenAt, firstSeenAt } = figures(profile)
    return {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      // The spell in force, which is the newest grant. Earlier spells stay in
      // the record and are shown nowhere yet.
      memberSince: currentSpell(customers, profile.id)?.grantedAt ?? null,
      visits30d,
      spend30dPaise,
      lastSeenAt,
      // A manager's "since" is their own outlets' first sale: the business-wide
      // date would tell them when somebody first bought at another shop.
      customerSince:
        scope === null
          ? profile.createdAt
          : (firstSeenAt ?? openOrderAt(profile)?.ordered_at ?? profile.createdAt),
      scope: directoryScope,
      editable: mayEdit(profile),
    }
  }

  return {
    async list(which, offset) {
      requireReader()
      const profiles = reachableProfiles()
      // Each order is total, down to the id, so offset paging neither repeats
      // nor skips anybody while nothing changes between two pages.
      const ordered =
        which === 'members'
          ? profiles
              .map((profile) => ({ profile, spell: currentSpell(customers, profile.id) }))
              .filter(
                (entry): entry is { profile: DemoCustomerProfile; spell: DemoMembershipSpell } =>
                  Boolean(entry.spell),
              )
              .sort(
                (left, right) =>
                  right.spell.grantedAt.localeCompare(left.spell.grantedAt) ||
                  left.profile.id.localeCompare(right.profile.id),
              )
              .map((entry) => entry.profile)
          : profiles
              .map((profile) => ({ profile, ...figures(profile) }))
              .filter((entry) => entry.visits30d > 0)
              .sort(
                (left, right) =>
                  right.visits30d - left.visits30d ||
                  (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? '') ||
                  left.profile.id.localeCompare(right.profile.id),
              )
              .map((entry) => entry.profile)
      const start = Math.max(0, Math.trunc(offset))
      const end = start + DIRECTORY_PAGE_SIZE
      return {
        rows: ordered.slice(start, end).map(row),
        next: end < ordered.length ? end : null,
      }
    },

    async search(query) {
      requireReader()
      const parsed = parseCustomerQuery(query)
      if (parsed.kind === 'too-short') return { matches: [], more: 0 }
      const scored = reachableProfiles()
        .map((profile) => ({
          profile,
          strength: customerMatchStrength(parsed, profile),
          lastSeenAt: figures(profile).lastSeenAt,
        }))
        .filter((entry) => entry.strength !== null)
      const exact = scored.filter((entry) => entry.strength === 0)
      // Loose matches only fill room the exact ones leave [owner, 2026-09-24]:
      // a name typed correctly should never be pushed down by a near-miss.
      const matching = [
        ...exact,
        ...(exact.length < DIRECTORY_SEARCH_LIMIT
          ? scored.filter((entry) => entry.strength === 1)
          : []),
      ]
      // Within each kind, most recently seen first: of two Rahuls, the one who
      // came in this week is the one being looked for. Never seen sorts last.
      matching.sort(
        (left, right) =>
          (left.strength ?? 0) - (right.strength ?? 0) ||
          (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? ''),
      )
      return {
        matches: matching.slice(0, DIRECTORY_SEARCH_LIMIT).map((entry) => row(entry.profile)),
        more: Math.max(0, matching.length - DIRECTORY_SEARCH_LIMIT),
      }
    },

    async card(customerId) {
      requireReader()
      return card(profileById(customerId))
    },

    async rename(customerId, name) {
      requireReader()
      const trimmed = name.trim()
      // Corrected, never erased: a profile with no name is a number nobody can
      // recognise on a list.
      if (!trimmed) {
        throw new CustomerActionError('name_required', 'A name cannot be left empty.')
      }
      const profile = profileById(customerId)
      requireEditor(profile)
      // The profile only. Every bill and order keeps the name it snapshotted.
      profile.name = trimmed
      return card(profile)
    },

    async grantMembership(customerId) {
      requireReader()
      const profile = profileById(customerId)
      requireEditor(profile)
      // A second tap on a slow network lands here with gold already granted,
      // and answering with the card is the honest result: it is a member.
      if (!currentSpell(customers, profile.id)) {
        customers.memberships.push({
          customerId: profile.id,
          grantedAt: new Date().toISOString(),
          grantedBy: actorId,
          revokedAt: null,
          revokedBy: null,
        })
      }
      return card(profile)
    },

    async revokeMembership(customerId) {
      requireReader()
      const profile = profileById(customerId)
      requireEditor(profile)
      const spell = currentSpell(customers, profile.id)
      // Ends the spell and keeps it — the history a later screen will show
      // [owner, 2026-09-24], and the fact that tells a future rule a person took
      // this membership away.
      if (spell) {
        spell.revokedAt = new Date().toISOString()
        spell.revokedBy = actorId
      }
      return card(profile)
    },
  }
}
