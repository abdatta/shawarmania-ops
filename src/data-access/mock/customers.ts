import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import {
  ALL_OFF_LOYALTY_SETTINGS,
  customerMatchStrength,
  earnBasisPaise,
  earnRate,
  goldEligible,
  goldEndsAt,
  GOLD_WINDOW_DAYS,
  goldInForce,
  parseCustomerQuery,
  POINT_VALUE_PAISE,
  pointsEarned,
  resolveBusinessDate,
  shiftBusinessDate,
  withPointsSwitched,
  type OutletLoyaltySettings,
} from '@/domain'
import type { Tables } from '../database.types'
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
  DEMO_COUNTER_DEVICE_ID,
  DEMO_KANCHRAPARA_BILLER_ID,
  DEMO_KANCHRAPARA_DEVICE_ID,
} from './fixtures/billing'
import {
  customerFixtures,
  customerIdForPhone,
  customerVisitSeeds,
  MEMBERSHIP_COUNTER_ACTOR,
  MEMBERSHIP_SEED_ACTOR,
  membershipSeeds,
  POINTS_SWITCHED_ON_DAYS_AGO,
  SEEDED_GOLD_MONTHS,
} from './fixtures/customers'
import { menuItemFixtures } from './fixtures/menu'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './fixtures/outlets'
import { DEMO_BILLER_ID, DEMO_OWNER_ID, personaFixtures } from './fixtures/personas'
import { DEMO_BILL_NUMBER_BASE, DEMO_OUTLET_ID, type DemoStore } from './store'

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
 * the other's.
 *
 * **Since a-regular-earns-points-and-gold (#62), gold and points belong to an
 * outlet.** A till is told, for its own outlet only, whether somebody is gold
 * there, their points balance there and whether they may be upgraded to Gold there —
 * and never an amount, a visit or another outlet. The management path reads one
 * outlet at a time.
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
 * One spell of membership **at one outlet** (a-regular-earns-points-and-gold,
 * D1). A revocation fills in `revokedAt` and never deletes the row; a re-grant,
 * or a grant after a lapse, is a new spell. Every spell ends on the date its
 * grant stored (D2), and a lapse writes nothing.
 */
export interface DemoMembershipSpell {
  customerId: string
  outletId: string
  grantedAt: string
  grantedBy: string
  grantedVia: 'management' | 'counter'
  /** The tablet that made them gold, for a counter grant. */
  counterDeviceId: string | null
  expiresAt: string
  revokedAt: string | null
  revokedBy: string | null
}

/** What moved a balance: the ledger's four kinds (design D5). */
export type DemoPointsKind = 'earned' | 'used' | 'earned_reversed' | 'used_returned'

/**
 * One row of the points ledger. Append-only, one of each kind per bill, and
 * carrying the balance after it so a receipt reads a stored figure.
 */
export interface DemoPointsEntry {
  outletId: string
  customerId: string
  billId: string
  kind: DemoPointsKind
  /** Signed: earned and returned are positive, used and reversed negative. */
  points: number
  balanceAfter: number
  createdAt: string
  /** On an earn: what it was earned on, and the rule in force. */
  earnBasisPaise: number | null
  earnBlockPaise: number | null
  earnPointsPerBlock: number | null
}

/** One visit before the demo store's four trading days — see `customerVisitSeeds`. */
interface DemoCustomerVisit {
  customerId: string
  /** Where it was bought, which is what every per-outlet reading narrows by. */
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
  /** The points ledger, every outlet's, in the order rows were written. */
  pointsEntries: DemoPointsEntry[]
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

/** The rule every seeded outlet ran: the owner's defaults, 5 points per ₹200. */
const SEEDED_RULES = withPointsSwitched(ALL_OFF_LOYALTY_SETTINGS, true)

export function createDemoCustomers(today: string = demoToday()): DemoCustomers {
  const businessDate = (daysAgo: number) => shiftBusinessDate(today, -daysAgo)
  const customers: DemoCustomers = {
    today,
    byPhone: new Map(
      customerFixtures.map((row) => [
        row.phone,
        { id: row.id, phone: row.phone, name: row.name, createdAt: row.created_at },
      ]),
    ),
    memberships: membershipSeeds.map((spell) => {
      const grantedAt = instantAt(businessDate(spell.grantedDaysAgo), '21:30')
      const counter = spell.grantedVia === 'counter'
      return {
        customerId: customerIdForPhone(spell.phone),
        outletId: spell.outletId,
        grantedAt,
        grantedBy: counter ? MEMBERSHIP_COUNTER_ACTOR : MEMBERSHIP_SEED_ACTOR,
        grantedVia: counter ? ('counter' as const) : ('management' as const),
        counterDeviceId: counter ? DEMO_COUNTER_DEVICE_ID : null,
        expiresAt: goldEndsAt(grantedAt, SEEDED_GOLD_MONTHS),
        revokedAt:
          spell.revokedDaysAgo === undefined
            ? null
            : instantAt(businessDate(spell.revokedDaysAgo), '21:30'),
        revokedBy: spell.revokedDaysAgo === undefined ? null : MEMBERSHIP_SEED_ACTOR,
      }
    }),
    pointsEntries: [],
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
  seedPointsLedger(customers, businessDate)
  return customers
}

/** Points the seeded history spent, on the visit named by its day. */
const POINTS_USE_SEEDS: readonly { phone: string; daysAgo: number; points: number }[] = [
  { phone: '+919000000107', daysAgo: 10, points: 12 },
]

/**
 * The ledger the seeded history would have written: every older visit at an
 * outlet since it switched points on earns at the owner's defaults, one visit
 * spends points (Imran's), and a voided visit is reversed two days later. The
 * rows go in by instant, so every `balanceAfter` is the one the database would
 * have stored.
 */
function seedPointsLedger(customers: DemoCustomers, businessDate: (daysAgo: number) => string) {
  const events: { at: string; apply: () => void }[] = []
  customers.olderVisits.forEach((visit, index) => {
    const onDaysAgo = POINTS_SWITCHED_ON_DAYS_AGO[visit.outletId]
    if (onDaysAgo === undefined || visit.businessDate < businessDate(onDaysAgo)) return
    const billId = seededVisitBillId(index)
    const gold = customers.memberships.some(
      (spell) =>
        spell.customerId === visit.customerId &&
        spell.outletId === visit.outletId &&
        goldInForce(spell, visit.paidAt),
    )
    const phone = profileWithId(customers, visit.customerId)?.phone
    const usedPoints =
      POINTS_USE_SEEDS.find(
        (seed) => seed.phone === phone && businessDate(seed.daysAgo) === visit.businessDate,
      )?.points ?? 0
    events.push({
      at: visit.paidAt,
      apply: () =>
        recordBillPoints(customers, SEEDED_RULES, {
          billId,
          outletId: visit.outletId,
          customerId: visit.customerId,
          at: visit.paidAt,
          gold,
          // A seeded total is what was paid, so the points it used go back on
          // top to give what it earned on.
          basisPaise: visit.totalPaise + usedPoints * POINT_VALUE_PAISE,
          usedPoints,
        }),
    })
    if (visit.voided) {
      const at = new Date(Date.parse(visit.paidAt) + 2 * 86_400_000).toISOString()
      events.push({ at, apply: () => reverseBillPoints(customers, billId, at) })
    }
  })
  events.sort((left, right) => left.at.localeCompare(right.at)).forEach((event) => event.apply())
}

function profileWithId(customers: DemoCustomers, id: string): DemoCustomerProfile | undefined {
  for (const profile of customers.byPhone.values()) if (profile.id === id) return profile
  return undefined
}

/** A customer's balance at one outlet: the sum of their rows there (design D5). */
export function pointsBalance(
  customers: DemoCustomers,
  outletId: string,
  customerId: string,
): number {
  return customers.pointsEntries
    .filter((entry) => entry.outletId === outletId && entry.customerId === customerId)
    .reduce((sum, entry) => sum + entry.points, 0)
}

/**
 * Append one row, unless the bill already has one of its kind — the
 * `unique (bill_id, kind)` that makes a retried bill earn once. A row of nought
 * points is never written.
 */
function appendEntry(customers: DemoCustomers, entry: Omit<DemoPointsEntry, 'balanceAfter'>) {
  if (entry.points === 0) return
  if (customers.pointsEntries.some((row) => row.billId === entry.billId && row.kind === entry.kind))
    return
  const balanceAfter = pointsBalance(customers, entry.outletId, entry.customerId) + entry.points
  customers.pointsEntries.push({ ...entry, balanceAfter })
}

/**
 * What a settled bill writes (design D6): the points it used, then the points
 * it earned, at the outlet's rule when the bill arrives.
 */
export function recordBillPoints(
  customers: DemoCustomers,
  settings: OutletLoyaltySettings,
  bill: {
    billId: string
    outletId: string
    customerId: string
    at: string
    gold: boolean
    /** The bill after every discount except points. */
    basisPaise: number
    usedPoints: number
  },
): void {
  // A points row on a bill at an outlet with points off is still recorded: the
  // sale happened (design D8). Earning is what stops.
  const base = { outletId: bill.outletId, customerId: bill.customerId, billId: bill.billId }
  appendEntry(customers, {
    ...base,
    kind: 'used',
    points: -bill.usedPoints,
    createdAt: bill.at,
    earnBasisPaise: null,
    earnBlockPaise: null,
    earnPointsPerBlock: null,
  })
  const rate = earnRate(settings, bill.gold)
  appendEntry(customers, {
    ...base,
    kind: 'earned',
    points: pointsEarned(bill.basisPaise, rate),
    createdAt: bill.at,
    earnBasisPaise: bill.basisPaise,
    earnBlockPaise: rate?.blockPaise ?? null,
    earnPointsPerBlock: rate?.points ?? null,
  })
}

/** A void takes back what the bill earned and returns what it used (design D11). */
export function reverseBillPoints(customers: DemoCustomers, billId: string, at: string): void {
  const rows = customers.pointsEntries.filter((entry) => entry.billId === billId)
  for (const row of rows) {
    const reversal =
      row.kind === 'earned' ? 'earned_reversed' : row.kind === 'used' ? 'used_returned' : null
    if (reversal === null) continue
    appendEntry(customers, {
      outletId: row.outletId,
      customerId: row.customerId,
      billId,
      kind: reversal,
      points: -row.points,
      createdAt: at,
      earnBasisPaise: null,
      earnBlockPaise: null,
      earnPointsPerBlock: null,
    })
  }
}

/**
 * The demo's stand-in for the triggers on `bills` (design D6 and D11). The
 * billing mock calls it when a bill lands settled and when one is voided; it
 * resolves the customer the way the server does, from the id or the phone the
 * bill carries, and writes the ledger rows.
 */
export interface DemoLoyaltyHooks {
  billSettled(bill: Tables<'bills'>, pointsDiscountPaise: number): void
  billVoided(bill: Tables<'bills'>): void
  /**
   * A customer's bills at an outlet from before the store's days, and the phone
   * a store bill rung without a link carries (the-card-lists-every-bill). In
   * production every bill is one table; the demo keeps its older history here.
   */
  customerHistory?(outletId: string, customerId: string): DemoCustomerHistory
  /** One of those older bills by id, for the detail a row opens. */
  historyBill?(billId: string): DemoCustomerHistory['older'][number] | null
}

export interface DemoCustomerHistory {
  phone: string | null
  older: { bill: Tables<'bills'>; items: Tables<'bill_items'>[] }[]
}

export function createDemoLoyaltyHooks(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'loyaltySettings'>,
): DemoLoyaltyHooks {
  const customerOf = (bill: Tables<'bills'>) =>
    bill.customer_id !== null
      ? profileWithId(customers, bill.customer_id)
      : bill.customer_phone
        ? customers.byPhone.get(bill.customer_phone)
        : undefined
  return {
    billSettled(bill, pointsDiscountPaise) {
      if (bill.status !== 'settled') return
      const profile = customerOf(bill)
      if (!profile) return
      recordBillPoints(
        customers,
        store.loyaltySettings.get(bill.outlet_id) ?? ALL_OFF_LOYALTY_SETTINGS,
        {
          billId: bill.id,
          outletId: bill.outlet_id,
          customerId: profile.id,
          at: bill.paid_at,
          gold: bill.customer_tier === 'gold',
          basisPaise: earnBasisPaise({
            subtotalPaise: bill.subtotal_paise,
            discountPaise: bill.discount_paise,
            pointsDiscountPaise,
          }),
          usedPoints: Math.round(pointsDiscountPaise / POINT_VALUE_PAISE),
        },
      )
    },
    billVoided(bill) {
      reverseBillPoints(customers, bill.id, bill.voided_at ?? new Date().toISOString())
    },
    customerHistory(outletId, customerId) {
      const profile = profileWithId(customers, customerId)
      if (!profile) return { phone: null, older: [] }
      return {
        phone: profile.phone,
        older: customers.olderVisits.flatMap((visit, index) =>
          visit.customerId === customerId && visit.outletId === outletId
            ? [olderVisitBill(customers, profile, visit, index)]
            : [],
        ),
      }
    },
    historyBill(billId) {
      const index = customers.olderVisits.findIndex((_, at) => seededVisitBillId(at) === billId)
      const visit = customers.olderVisits[index]
      const profile = visit && profileWithId(customers, visit.customerId)
      return visit && profile ? olderVisitBill(customers, profile, visit, index) : null
    },
  }
}

/** The id an older visit's bill had: the points ledger and the card's history both name it. */
function seededVisitBillId(index: number): string {
  return `d8100000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
}

/** Who rang an older visit, and on which tablet: each outlet's own. */
const HISTORY_COUNTER: Readonly<Record<string, { billerId: string; deviceId: string }>> = {
  [OUTLET_KALYANI_ID]: { billerId: DEMO_BILLER_ID, deviceId: DEMO_COUNTER_DEVICE_ID },
  [OUTLET_KANCHRAPARA_ID]: {
    billerId: DEMO_KANCHRAPARA_BILLER_ID,
    deviceId: DEMO_KANCHRAPARA_DEVICE_ID,
  },
}

/**
 * An older visit as the bill it was (the-card-lists-every-bill).
 *
 * The seed carries only where, when, how much and whether it was voided, so
 * the rest is made up deterministically and never contradicts it: the number
 * sits below the store's sequence in the order the visits happened, and the
 * items are a few of the outlet's menu items at the prices they carried then —
 * a little below today's, scaled so the lines add up to exactly the total the
 * card's figures already count.
 */
function olderVisitBill(
  customers: DemoCustomers,
  profile: DemoCustomerProfile,
  visit: DemoCustomerVisit,
  index: number,
): { bill: Tables<'bills'>; items: Tables<'bill_items'>[] } {
  const id = seededVisitBillId(index)
  const daysAgo = Math.round(
    (Date.parse(`${customers.today}T00:00:00Z`) - Date.parse(`${visit.businessDate}T00:00:00Z`)) /
      86_400_000,
  )
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(visit.paidAt)),
  )
  const menu = menuItemFixtures
    .filter((item) => item.outlet_id === visit.outletId && item.is_active)
    .sort((left, right) => left.sort_order - right.sort_order)
  // Enough of the menu, in a rotation the visit picks, to reach the total.
  const picked: typeof menu = []
  for (let step = 0; step < menu.length && sum(picked) < visit.totalPaise; step += 1) {
    picked.push(menu[(index + step * 3) % menu.length]!)
  }
  const listed = sum(picked)
  const prices = picked.map(
    (item) => Math.floor((item.price_paise * visit.totalPaise) / listed / 100) * 100,
  )
  // Whatever the whole-rupee rounding left goes on the first line.
  prices[0] = prices[0]! + visit.totalPaise - prices.reduce((total, price) => total + price, 0)
  const counter = HISTORY_COUNTER[visit.outletId] ?? HISTORY_COUNTER[OUTLET_KALYANI_ID]!
  const voidedAt = visit.voided
    ? new Date(Date.parse(visit.paidAt) + 20 * 60_000).toISOString()
    : null
  return {
    bill: {
      id,
      outlet_id: visit.outletId,
      bill_number: DEMO_BILL_NUMBER_BASE - daysAgo * 25 + hour,
      biller_profile_id: counter.billerId,
      counter_device_id: counter.deviceId,
      counter_shift_id: null,
      shift_id: null,
      business_date: visit.businessDate,
      payment_business_date: visit.businessDate,
      ordered_at: new Date(Date.parse(visit.paidAt) - 6 * 60_000).toISOString(),
      paid_at: visit.paidAt,
      created_at: visit.paidAt,
      synced_at: visit.paidAt,
      customer_id: profile.id,
      customer_name: profile.name,
      customer_phone: profile.phone,
      customer_tier: currentSpell(customers, profile.id, visit.outletId, visit.paidAt)
        ? 'gold'
        : null,
      payment_method: index % 3 === 0 ? 'cash' : 'upi',
      pricing_mode: 'no_tax',
      subtotal_paise: visit.totalPaise,
      discount_paise: 0,
      tax_paise: 0,
      rounding_paise: 0,
      total_paise: visit.totalPaise,
      order_id: null,
      recorded_after_shift_end: false,
      attribution_shift_ended_at: null,
      service_type: null,
      table_number: null,
      status: visit.voided ? 'void' : 'settled',
      void_kind: visit.voided ? 'manager_void' : null,
      void_reason: visit.voided ? 'Mistaken entry' : null,
      voided_at: voidedAt,
      voided_by: visit.voided ? DEMO_OWNER_ID : null,
    },
    items: picked.map((item, line) => ({
      id: `${id.slice(0, -3)}${String(line + 1).padStart(3, '0')}`,
      bill_id: id,
      menu_item_id: item.id,
      item_name: item.name,
      unit_price_paise: prices[line]!,
      quantity: 1,
      line_total_paise: prices[line]!,
      discount_paise: 0,
      discount_percent_bp: null,
      category_name: null,
      kind: 'item' as const,
    })),
  }

  function sum(items: readonly { price_paise: number }[]): number {
    return items.reduce((total, item) => total + item.price_paise, 0)
  }
}

/** The spell in force at this outlet at an instant, if any. There is at most one. */
function currentSpell(
  customers: DemoCustomers,
  customerId: string,
  outletId: string,
  at: string = new Date().toISOString(),
): DemoMembershipSpell | null {
  return (
    customers.memberships.find(
      (spell) =>
        spell.customerId === customerId && spell.outletId === outletId && goldInForce(spell, at),
    ) ?? null
  )
}

function currentTier(
  customers: DemoCustomers,
  customerId: string,
  outletId: string,
): CustomerTier | null {
  return currentSpell(customers, customerId, outletId) ? 'gold' : null
}

/**
 * Every visit this customer made, before the store's days and in them, at every
 * outlet. Callers narrow it; nothing else reads bills for a customer. A store
 * bill is theirs by its link, or — for a sale the demo counter settled without
 * one, which the real server links from the phone it carries — by that phone.
 */
function allVisits(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'bills'>,
  profile: DemoCustomerProfile,
): DemoCustomerVisit[] {
  return [
    ...customers.olderVisits.filter((visit) => visit.customerId === profile.id),
    ...store.bills
      .filter(
        (bill) =>
          bill.customer_id === profile.id ||
          (bill.customer_id === null && bill.customer_phone === profile.phone),
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
}

/**
 * What this customer paid at this outlet within the window (design D3): the
 * totals of settled bills whose business date falls in the last `days`
 * business dates, today included. Voids count for nothing.
 */
function spendInWindow(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'bills'>,
  profile: DemoCustomerProfile,
  outletId: string,
  days: number,
): number {
  if (days < 1) return 0
  const from = shiftBusinessDate(customers.today, -(days - 1))
  return allVisits(customers, store, profile)
    .filter((visit) => visit.outletId === outletId && !visit.voided && visit.businessDate >= from)
    .reduce((sum, visit) => sum + visit.totalPaise, 0)
}

/** Whether the counter may make them gold at this outlet, derived when asked. */
function eligibleHere(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'bills' | 'loyaltySettings'>,
  profile: DemoCustomerProfile,
  outletId: string,
): boolean {
  const settings = store.loyaltySettings.get(outletId) ?? ALL_OFF_LOYALTY_SETTINGS
  return goldEligible({
    settings,
    isGold: currentTier(customers, profile.id, outletId) !== null,
    spendInWindowPaise: spendInWindow(customers, store, profile, outletId, GOLD_WINDOW_DAYS),
  })
}

/**
 * Whether an outlet has gold at all [owner, 2026-09-29]. Where it does not,
 * nobody is gold there — a spell granted while it was on stays on the record,
 * and counts again only if gold comes back on before the spell's own end.
 */
function goldOnAt(
  store: Partial<Pick<DemoStore, 'loyaltySettings'>> | undefined,
  outletId: string,
) {
  return store?.loyaltySettings?.get(outletId)?.goldEnabled ?? false
}

/**
 * Points already placed on this customer's **open** orders here, which the
 * balance a till is shown leaves out (design D10), so two open orders cannot
 * both use the same points.
 */
function pointsHeldOnOpenOrders(
  store: Pick<DemoStore, 'orders' | 'orderDiscounts'>,
  profile: DemoCustomerProfile,
  outletId: string,
): number {
  return store.orders
    .filter(
      (order) =>
        order.outlet_id === outletId &&
        order.status === 'open' &&
        (order.customer_id === profile.id || order.customer_phone === profile.phone),
    )
    .reduce(
      (sum, order) =>
        sum +
        (store.orderDiscounts.get(order.id) ?? [])
          .filter((discount) => discount.source === 'points')
          .reduce((points, discount) => points + discount.amountPaise / POINT_VALUE_PAISE, 0),
      0,
    )
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

/** The store slices the till's answers read. Absent in a test of the directory alone. */
type TillStore = Pick<
  DemoStore,
  'bills' | 'orders' | 'orderDiscounts' | 'loyaltySettings' | 'connectivity'
>

export function createMockCustomersAdapter(
  customers: DemoCustomers,
  role: AppRole,
  /**
   * The session's store, for the till's per-outlet answers: gold here, the
   * balance here and eligibility here. A test of identity alone may leave it
   * out, and then every outlet reads as having points off.
   */
  store?: TillStore,
  /** The counter's own outlet — the caller's authority, never an argument. */
  counterOutletId: string = DEMO_OUTLET_ID,
  /** Who a counter grant is recorded against: the operator on the shift. */
  operatorId: string = MEMBERSHIP_COUNTER_ACTOR,
): CustomersAdapter {
  const requireBillingContext = () => {
    if (!MAY_LOOK_UP.includes(role)) {
      throw new CustomerActionError(
        'not_permitted',
        'This device cannot look up customers. Carry on with the bill.',
      )
    }
  }
  const settings = () => store?.loyaltySettings.get(counterOutletId) ?? ALL_OFF_LOYALTY_SETTINGS
  const online = () => store?.connectivity.isOnline() ?? true

  /*
    Handed out as fresh objects carrying exactly the till's facts: who, and for
    this outlet only, gold, balance and eligibility. A screen editing the object
    it was given must not rename somebody in the directory as a side effect.

    Offline, the demo answers as the tablet's cache does: from its last read,
    marked remembered — which is what keeps Use points from spending a balance
    nobody has just confirmed (design D10).
  */
  const identity = (profile: DemoCustomerProfile): CustomerIdentity => {
    const pointsOn = settings().pointsEnabled
    return {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      tier: goldOnAt(store, counterOutletId)
        ? currentTier(customers, profile.id, counterOutletId)
        : null,
      pointsBalance:
        pointsOn && store
          ? pointsBalance(customers, counterOutletId, profile.id) -
            pointsHeldOnOpenOrders(store, profile, counterOutletId)
          : null,
      goldEligible: store ? eligibleHere(customers, store, profile, counterOutletId) : false,
      ...(online() ? {} : { remembered: true as const }),
    }
  }

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

    async grantGoldAtCounter(customerId) {
      requireBillingContext()
      if (!online()) {
        throw new CustomerActionError(
          'offline',
          'Upgrading to Gold needs the internet. Try again when this tablet is back online.',
        )
      }
      const profile = profileWithId(customers, customerId)
      if (!profile) {
        throw new CustomerActionError('not_found', 'That customer is no longer in the directory.')
      }
      // A second tap after success finds them gold, and answers as success did.
      if (currentTier(customers, profile.id, counterOutletId) !== null) return identity(profile)
      // Decided here, never trusted from the tablet's cached flag (design D4).
      if (!store || !eligibleHere(customers, store, profile, counterOutletId)) {
        throw new CustomerActionError(
          'not_eligible',
          'This customer has not spent enough here to upgrade to Gold.',
        )
      }
      const grantedAt = new Date().toISOString()
      customers.memberships.push({
        customerId: profile.id,
        outletId: counterOutletId,
        grantedAt,
        grantedBy: operatorId,
        grantedVia: 'counter',
        counterDeviceId: DEMO_COUNTER_DEVICE_ID,
        expiresAt: goldEndsAt(grantedAt, settings().goldDurationMonths),
        revokedAt: null,
        revokedBy: null,
      })
      return identity(profile)
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

/** A person's display name for "given by", from the demo's personas. */
function personName(profileId: string): string | null {
  for (const persona of Object.values(personaFixtures)) {
    if (persona.profile.id === profileId) return persona.profile.full_name
  }
  return null
}

/**
 * The management customer path over the same session directory: the owner's,
 * and a manager's over their own outlets — **one outlet at a time** since
 * a-regular-earns-points-and-gold (D13), because gold, points, visits and spend
 * are each a relationship between a person and a shop.
 *
 * **Every figure is derived when it is read, from bills and the ledger.**
 * Nothing here writes a count or a total onto a profile, because the real rule
 * is that no such column exists: #32 removed `bill_count` and
 * `total_spend_paise` from `customers` so they could never ride along in the
 * till's lookup.
 *
 * **The scope is applied once, in `visitsAt`**, and every read is built on it.
 */
export function createMockCustomerDirectoryAdapter(
  customers: DemoCustomers,
  store: Pick<DemoStore, 'bills' | 'orders'> & Partial<Pick<DemoStore, 'loyaltySettings'>>,
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

  /** The outlet asked about, checked against the reader's reach. */
  const requireOutlet = (outletId: string) => {
    if (scope === 'refused') {
      throw new CustomerActionError('not_permitted', 'Customers are managed from the office.')
    }
    if (scope !== null && !scope.includes(outletId)) {
      throw new CustomerActionError('not_permitted', 'That outlet is not one you manage.')
    }
  }

  /** Every bill this customer paid at this outlet. */
  const visitsAt = (profile: DemoCustomerProfile, outletId: string): DemoCustomerVisit[] =>
    allVisits(customers, store, profile).filter((visit) => visit.outletId === outletId)

  /** An order still open at this outlet, which bought nothing yet but was served. */
  const openOrderAt = (profile: DemoCustomerProfile, outletId: string) =>
    store.orders.find(
      (order) =>
        order.outlet_id === outletId &&
        order.bill_id === null &&
        (order.customer_id === profile.id || order.customer_phone === profile.phone),
    )

  /** Whether this outlet knows the customer at all: it has served them, or holds gold for them. */
  const reachableAt = (profile: DemoCustomerProfile, outletId: string) =>
    visitsAt(profile, outletId).length > 0 ||
    openOrderAt(profile, outletId) !== undefined ||
    customers.memberships.some(
      (spell) => spell.customerId === profile.id && spell.outletId === outletId,
    )

  const reachableProfiles = (outletId: string) =>
    [...customers.byPhone.values()].filter((profile) => reachableAt(profile, outletId))

  /**
   * Every outlet this customer has ever been served at — **across the whole
   * business**. Only ever reduced to one yes or no, for renaming.
   */
  const servedOutletsOf = (profile: DemoCustomerProfile): Set<string> =>
    new Set([
      ...allVisits(customers, store, profile).map((visit) => visit.outletId),
      ...store.orders
        .filter(
          (order) => order.customer_id === profile.id || order.customer_phone === profile.phone,
        )
        .map((order) => order.outlet_id),
    ])

  /**
   * May this reader rename this customer? The owner always. A manager only while
   * every outlet the customer has been served at is theirs, because the name is
   * the person's at every outlet (a-regular-earns-points-and-gold keeps #57's
   * rule for renaming alone).
   */
  const mayRename = (profile: DemoCustomerProfile): boolean => {
    if (scope === null) return true
    if (scope === 'refused') return false
    const served = servedOutletsOf(profile)
    return served.size > 0 && [...served].every((outletId) => scope.includes(outletId))
  }

  const profileAt = (outletId: string, customerId: string): DemoCustomerProfile => {
    const profile = profileWithId(customers, customerId)
    // Out of reach answers exactly as absent does: a manager cannot learn that a
    // customer of another outlet exists by asking for their id.
    if (profile && reachableAt(profile, outletId)) return profile
    throw new CustomerActionError('not_found', 'That customer is no longer in the directory.')
  }

  const windowStart = () => shiftBusinessDate(customers.today, -(WINDOW_DAYS - 1))

  /** One bill is one visit; a voided bill is neither a visit nor spend. */
  const figures = (profile: DemoCustomerProfile, outletId: string) => {
    const counted = visitsAt(profile, outletId).filter((visit) => !visit.voided)
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

  /** The spell in force here, or none at an outlet with gold off. */
  const spellHere = (profile: DemoCustomerProfile, outletId: string) =>
    goldOnAt(store, outletId) ? currentSpell(customers, profile.id, outletId) : null

  const requireGold = (outletId: string) => {
    if (!goldOnAt(store, outletId)) {
      throw new CustomerActionError('gold_off', 'This outlet does not have gold members.')
    }
  }

  const row = (profile: DemoCustomerProfile, outletId: string): DirectoryCustomerRow => {
    const spell = spellHere(profile, outletId)
    return {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      tier: spell ? 'gold' : null,
      memberUntil: spell?.expiresAt ?? null,
      visits30d: figures(profile, outletId).visits30d,
    }
  }

  const card = (profile: DemoCustomerProfile, outletId: string): DirectoryCustomerCard => {
    const { visits30d, spend30dPaise, lastSeenAt, firstSeenAt } = figures(profile, outletId)
    const spell = spellHere(profile, outletId)
    const pointsOn = store.loyaltySettings?.get(outletId)?.pointsEnabled ?? false
    const balance = pointsBalance(customers, outletId, profile.id)
    return {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      memberSince: spell?.grantedAt ?? null,
      memberUntil: spell?.expiresAt ?? null,
      grantedVia: spell?.grantedVia ?? null,
      grantedByName: spell ? personName(spell.grantedBy) : null,
      // A balance an outlet holds is still read after it turns points off: the
      // customer's points did not disappear with the switch.
      pointsBalance: pointsOn || balance !== 0 ? balance : null,
      visits30d,
      spend30dPaise,
      lastSeenAt,
      // The first visit at this outlet: gold, points and figures are all this
      // outlet's, so a business-wide date would be the odd one out.
      customerSince: firstSeenAt ?? openOrderAt(profile, outletId)?.ordered_at ?? profile.createdAt,
      scope: directoryScope,
      editable: mayRename(profile),
    }
  }

  return {
    async list(outletId, which, offset, order = 'newest') {
      requireOutlet(outletId)
      const profiles = reachableProfiles(outletId)
      // Each order is total, down to the id, so offset paging neither repeats
      // nor skips anybody while nothing changes between two pages.
      const byVisits = (
        left: { profile: DemoCustomerProfile; visits30d: number; lastSeenAt: string | null },
        right: { profile: DemoCustomerProfile; visits30d: number; lastSeenAt: string | null },
      ) =>
        right.visits30d - left.visits30d ||
        (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? '') ||
        left.profile.id.localeCompare(right.profile.id)
      const ordered =
        which === 'members'
          ? profiles
              .map((profile) => ({
                profile,
                spell: spellHere(profile, outletId),
                ...figures(profile, outletId),
              }))
              .filter((entry) => entry.spell !== null)
              .sort((left, right) =>
                order === 'visits'
                  ? byVisits(left, right)
                  : right.spell!.grantedAt.localeCompare(left.spell!.grantedAt) ||
                    left.profile.id.localeCompare(right.profile.id),
              )
              .map((entry) => entry.profile)
          : profiles
              .map((profile) => ({ profile, ...figures(profile, outletId) }))
              .filter((entry) => entry.visits30d > 0)
              .sort(byVisits)
              .map((entry) => entry.profile)
      const start = Math.max(0, Math.trunc(offset))
      const end = start + DIRECTORY_PAGE_SIZE
      return {
        rows: ordered.slice(start, end).map((profile) => row(profile, outletId)),
        next: end < ordered.length ? end : null,
      }
    },

    async search(outletId, query) {
      requireOutlet(outletId)
      const parsed = parseCustomerQuery(query)
      if (parsed.kind === 'too-short') return { matches: [], more: 0 }
      const scored = reachableProfiles(outletId)
        .map((profile) => ({
          profile,
          strength: customerMatchStrength(parsed, profile),
          lastSeenAt: figures(profile, outletId).lastSeenAt,
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
      // Within each kind, most recently seen first. Never seen sorts last.
      matching.sort(
        (left, right) =>
          (left.strength ?? 0) - (right.strength ?? 0) ||
          (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? ''),
      )
      return {
        matches: matching
          .slice(0, DIRECTORY_SEARCH_LIMIT)
          .map((entry) => row(entry.profile, outletId)),
        more: Math.max(0, matching.length - DIRECTORY_SEARCH_LIMIT),
      }
    },

    async card(outletId, customerId) {
      requireOutlet(outletId)
      return card(profileAt(outletId, customerId), outletId)
    },

    async rename(outletId, customerId, name) {
      requireOutlet(outletId)
      const trimmed = name.trim()
      // Corrected, never erased: a profile with no name is a number nobody can
      // recognise on a list.
      if (!trimmed) {
        throw new CustomerActionError('name_required', 'A name cannot be left empty.')
      }
      const profile = profileAt(outletId, customerId)
      // Checked again at the moment of the write, never trusted from the card.
      if (!mayRename(profile)) {
        throw new CustomerActionError(
          'not_permitted',
          'This customer has also bought at another outlet, so only the owner can rename them.',
        )
      }
      // The profile only. Every bill and order keeps the name it snapshotted.
      profile.name = trimmed
      return card(profile, outletId)
    },

    async grantMembership(outletId, customerId) {
      requireOutlet(outletId)
      requireGold(outletId)
      const profile = profileAt(outletId, customerId)
      // A second tap on a slow network lands here with gold already granted,
      // and answering with the card is the honest result: it is a member.
      if (!currentSpell(customers, profile.id, outletId)) {
        const grantedAt = new Date().toISOString()
        const months =
          store.loyaltySettings?.get(outletId)?.goldDurationMonths ??
          ALL_OFF_LOYALTY_SETTINGS.goldDurationMonths
        customers.memberships.push({
          customerId: profile.id,
          outletId,
          grantedAt,
          grantedBy: actorId,
          grantedVia: 'management',
          counterDeviceId: null,
          expiresAt: goldEndsAt(grantedAt, months),
          revokedAt: null,
          revokedBy: null,
        })
      }
      return card(profile, outletId)
    },

    async revokeMembership(outletId, customerId) {
      requireOutlet(outletId)
      requireGold(outletId)
      const profile = profileAt(outletId, customerId)
      const spell = currentSpell(customers, profile.id, outletId)
      // Ends the spell and keeps it — the fact that tells a future rule a person
      // took this membership away.
      if (spell) {
        spell.revokedAt = new Date().toISOString()
        spell.revokedBy = actorId
      }
      return card(profile, outletId)
    },
  }
}
