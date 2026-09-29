import { describe, expect, it } from 'vitest'

import {
  CustomerActionError,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SEARCH_LIMIT,
  type AppRole,
} from '../adapters'
import { withGoldSwitched } from '@/domain'

import { createDemoCustomers, createMockCustomersAdapter } from './customers'
import { createDemoStore } from './store'
import { createDemoData, createMockAdapters } from './index'
import { DEMO_OPEN_SHIFT_ID } from './fixtures/billing'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'
import {
  customerIdForPhone,
  DEMO_LAPSED_CUSTOMER_PHONE,
  DEMO_MEMBER_CUSTOMER_PHONE,
  DEMO_REGULAR_CUSTOMER_PHONE,
  DEMO_RETURNING_CUSTOMER_PHONE,
  DEMO_UNNAMED_CUSTOMER_PHONE,
} from './fixtures/customers'

/**
 * The owner's customer path over the demo directory (a-gold-member-is-a-label).
 *
 * The mock has to refuse everything the database will refuse and derive every
 * figure the way the database will derive it — a mock laxer than the real
 * boundary teaches a screen to expect access it will not be given.
 */

function session(role: AppRole = 'super_admin') {
  const data = createDemoData()
  return { data, adapters: createMockAdapters(role, data) }
}

const K = OUTLET_KALYANI_ID
const N = OUTLET_KANCHRAPARA_ID

/** Put a visit at an outlet on a test customer, so that outlet has served them. */
function servedAt(data: ReturnType<typeof createDemoData>, customerId: string, outletId = K) {
  data.customers.olderVisits.push({
    customerId,
    outletId,
    businessDate: data.store.businessDate(40),
    paidAt: '2026-08-01T08:00:00.000Z',
    totalPaise: 19900,
    voided: false,
  })
}
const RITIKA = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
const ARJUN = customerIdForPhone(DEMO_MEMBER_CUSTOMER_PHONE)
const MOUMITA = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)
const SOURAV = customerIdForPhone(DEMO_LAPSED_CUSTOMER_PHONE)

describe('the owner customer path — who may use it', () => {
  it.each(['biller', 'employee'] as AppRole[])('refuses %s on every method', async (role) => {
    const { customerDirectory } = session(role).adapters
    const calls = [
      () => customerDirectory.list(K, 'regulars', 0),
      () => customerDirectory.list(K, 'members', 0),
      () => customerDirectory.search(K, 'ritika'),
      () => customerDirectory.card(K, RITIKA),
      () => customerDirectory.rename(K, RITIKA, 'Somebody'),
      () => customerDirectory.grantMembership(K, MOUMITA),
      () => customerDirectory.revokeMembership(K, RITIKA),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(CustomerActionError)
      await expect(call()).rejects.toMatchObject({ code: 'not_permitted' })
    }
  })

  it('keeps the two boundaries apart: the owner is refused the till’s lookup', async () => {
    const { customers } = session('super_admin').adapters
    await expect(customers.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })

  it('writes nothing when a refused grant is attempted', async () => {
    const { data, adapters } = session('biller')
    const before = data.customers.memberships.length
    await expect(adapters.customerDirectory.grantMembership(K, MOUMITA)).rejects.toThrow()
    expect(data.customers.memberships.length).toBe(before)
  })
})

describe('a manager’s directory — their own outlets only', () => {
  // The demo manager runs Kalyani. Ritika, Moumita and Imran have bought at
  // both outlets; Arjun only at Kalyani; Sourav only at Kanchrapara.

  it('finds only customers the outlet has served, and reads no other outlet', async () => {
    const { customerDirectory } = session('franchise_admin').adapters
    const members = await customerDirectory.list(K, 'members', 0)
    const regulars = await customerDirectory.list(K, 'regulars', 0)
    const everyone = [...members.rows, ...regulars.rows].map((row) => row.id)
    expect(everyone).toEqual(expect.arrayContaining([RITIKA, ARJUN, MOUMITA]))
    expect(everyone).not.toContain(SOURAV)
    await expect(customerDirectory.search(K, 'pal')).resolves.toEqual({ matches: [], more: 0 })
    // Kanchrapara is not theirs: asked about, it is refused outright.
    await expect(customerDirectory.list(N, 'regulars', 0)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })

  it('answers a customer of another outlet exactly as it answers nobody', async () => {
    const { customerDirectory } = session('franchise_admin').adapters
    await expect(customerDirectory.card(K, SOURAV)).rejects.toMatchObject({ code: 'not_found' })
    await expect(customerDirectory.card(K, 'not-a-customer')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reads the same outlet the owner reads, figure for figure', async () => {
    const { data, adapters } = session('franchise_admin')
    const owner = await createMockAdapters('super_admin', data).customerDirectory.card(K, RITIKA)
    const manager = await adapters.customerDirectory.card(K, RITIKA)
    expect(manager.visits30d).toBe(owner.visits30d)
    expect(manager.spend30dPaise).toBe(owner.spend30dPaise)
    expect(manager.customerSince).toBe(owner.customerSince)
  })

  it('changes gold for any customer their outlet served, recorded against them', async () => {
    const { data, adapters } = session('franchise_admin')
    // Ritika also buys at Kanchrapara; her gold here is still this outlet's.
    await adapters.customerDirectory.revokeMembership(K, RITIKA)
    const spell = data.customers.memberships.find(
      (entry) =>
        entry.customerId === RITIKA && entry.revokedAt !== null && entry.revokedBy !== null,
    )
    expect(spell).toBeDefined()
    const ended = data.customers.memberships.filter(
      (entry) =>
        entry.customerId === RITIKA &&
        entry.revokedBy === personaFixtures.franchise_admin.profile.id,
    )
    expect(ended).toHaveLength(1)

    const granted = await adapters.customerDirectory.grantMembership(K, MOUMITA)
    expect(granted.memberUntil).not.toBeNull()
    expect(granted.grantedVia).toBe('management')
  })

  it('renames only a customer who has bought nowhere else', async () => {
    const { data, adapters } = session('franchise_admin')
    expect((await adapters.customerDirectory.card(K, ARJUN)).editable).toBe(true)
    await adapters.customerDirectory.rename(K, ARJUN, 'Arjun K. Das')

    expect((await adapters.customerDirectory.card(K, RITIKA)).editable).toBe(false)
    await expect(adapters.customerDirectory.rename(K, RITIKA, 'Somebody')).rejects.toMatchObject({
      code: 'not_permitted',
    })
    expect(data.customers.byPhone.get(DEMO_RETURNING_CUSTOMER_PHONE)?.name).toBe('Ritika Sen')
  })

  it('loses the rename the moment the customer buys at another outlet, and keeps gold', async () => {
    const { data, adapters } = session('franchise_admin')
    expect((await adapters.customerDirectory.card(K, ARJUN)).editable).toBe(true)

    // Arjun is served at Kanchrapara for the first time.
    data.customers.olderVisits.push({
      customerId: ARJUN,
      outletId: OUTLET_KANCHRAPARA_ID,
      businessDate: data.store.businessDate(0),
      paidAt: new Date().toISOString(),
      totalPaise: 19900,
      voided: false,
    })

    expect((await adapters.customerDirectory.card(K, ARJUN)).editable).toBe(false)
    await expect(adapters.customerDirectory.rename(K, ARJUN, 'Somebody')).rejects.toMatchObject({
      code: 'not_permitted',
    })
    await expect(adapters.customerDirectory.revokeMembership(K, ARJUN)).resolves.toMatchObject({
      memberSince: null,
    })
  })

  it('leaves the owner free to change anybody', async () => {
    const { adapters } = session('super_admin')
    const card = await adapters.customerDirectory.card(K, RITIKA)
    expect(card).toMatchObject({ scope: 'business', editable: true })
  })
})

describe('the owner customer path — finding somebody', () => {
  it('finds by a complete number however it was typed', async () => {
    const { customerDirectory } = session().adapters
    for (const typed of ['90000 00104', '+91 90000 00104', '9000000104']) {
      const { matches } = await customerDirectory.search(K, typed)
      expect(matches.map((row) => row.id)).toEqual([MOUMITA])
    }
    await expect(customerDirectory.search(K, '9000000999')).resolves.toEqual({
      matches: [],
      more: 0,
    })
  })

  it('finds by the digits somebody remembers, anywhere in the number', async () => {
    const { customerDirectory } = session().adapters
    const { matches } = await customerDirectory.search(K, '0104')
    expect(matches.map((row) => row.id)).toEqual([MOUMITA])
  })

  it('finds by any part of a name, ignoring case — misspelt names included', async () => {
    const { customerDirectory } = session().adapters
    await expect(customerDirectory.search(K, 'ghosh')).resolves.toMatchObject({
      matches: [{ id: MOUMITA, name: 'Moumta Ghosh' }],
    })
    const { matches } = await customerDirectory.search(K, 'RIT')
    expect(matches.map((row) => row.name)).toEqual(expect.arrayContaining(['Ritika Sen']))
  })

  it('falls back to the same letters in order when exact matches leave room', async () => {
    const { customerDirectory } = session().adapters
    // `mmta` is not a run in any name, but it is M-m-ta in `Moumta Ghosh`.
    const { matches } = await customerDirectory.search(K, 'mmta')
    expect(matches.map((row) => row.id)).toEqual([MOUMITA])
  })

  it('puts exact name matches ahead of loose ones', async () => {
    const { data, adapters } = session()
    // "Sita" contains `sita` exactly; "Suresh Iyer Tata" only loosely.
    data.customers.byPhone.set('+919876500001', {
      id: 'loose',
      phone: '+919876500001',
      name: 'Suresh Iyer Tata',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    servedAt(data, 'loose')
    data.customers.byPhone.set('+919876500002', {
      id: 'exact',
      phone: '+919876500002',
      name: 'Sita Das',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    servedAt(data, 'exact')
    const { matches } = await adapters.customerDirectory.search(K, 'sita')
    expect(matches.map((row) => row.id)).toEqual(['exact', 'loose'])
  })

  it('answers nothing, rather than everybody, below the minimums', async () => {
    const { customerDirectory } = session().adapters
    await expect(customerDirectory.search(K, '')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search(K, 'r')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search(K, 'ri')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search(K, '90')).resolves.toEqual({ matches: [], more: 0 })
  })

  it('bounds the results and counts the rest', async () => {
    const { data, adapters } = session()
    for (let n = 0; n < 30; n += 1) {
      const phone = `+9198765${String(n).padStart(5, '0')}`
      data.customers.byPhone.set(phone, {
        id: `extra-${n}`,
        phone,
        name: `Rahul ${n}`,
        createdAt: '2026-09-01T00:00:00.000Z',
      })
      servedAt(data, `extra-${n}`)
    }
    const { matches, more } = await adapters.customerDirectory.search(K, 'rahul')
    expect(matches).toHaveLength(DIRECTORY_SEARCH_LIMIT)
    expect(more).toBe(30 - DIRECTORY_SEARCH_LIMIT)
  })

  it('puts the customer seen most recently first', async () => {
    const { customerDirectory } = session().adapters
    // Every demo number contains `0000`; at Kanchrapara, Sourav, who stopped
    // coming, is last.
    const { matches } = await customerDirectory.search(N, '0000')
    expect(matches.at(-1)?.id).toBe(SOURAV)
  })

  it('lists the current members, newest grant first', async () => {
    const { customerDirectory } = session().adapters
    const members = await customerDirectory.list(K, 'members', 0)
    // Arjun's one grant is more recent than Ritika's second.
    expect(members.rows.map((row) => row.id)).toEqual([ARJUN, RITIKA])
    expect(members.rows.every((row) => row.tier === 'gold')).toBe(true)
    expect(members.next).toBeNull()
  })

  it('ranks everybody seen this month by visits, one visit included, and leaves out who stopped coming', async () => {
    const { customerDirectory } = session().adapters
    const page = await customerDirectory.list(K, 'regulars', 0)
    const regulars = page.rows

    // Moumita is the obvious candidate: the most visits, and not a member.
    expect(regulars[0]).toMatchObject({ id: MOUMITA, tier: null })
    // A single visit still counts; it simply ranks last.
    expect(regulars.at(-1)?.visits30d).toBe(1)
    const counts = regulars.map((row) => row.visits30d)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
    expect(regulars.map((row) => row.id)).not.toContain(SOURAV)
    expect(counts.every((count) => count > 0)).toBe(true)
  })
})

describe('paging a list', () => {
  it('walks the whole list twenty at a time, nobody twice and nobody missed', async () => {
    const { data, adapters } = session()
    // Thirty extra gold members — the size the owner expects the list to reach.
    for (let n = 0; n < 30; n += 1) {
      const phone = `+9198765${String(n).padStart(5, '0')}`
      data.customers.byPhone.set(phone, {
        id: `extra-${String(n).padStart(2, '0')}`,
        phone,
        name: `Member ${n}`,
        createdAt: '2026-09-01T00:00:00.000Z',
      })
      data.customers.memberships.push({
        customerId: `extra-${String(n).padStart(2, '0')}`,
        outletId: OUTLET_KALYANI_ID,
        grantedAt: '2026-09-10T12:00:00.000Z',
        grantedBy: 'owner',
        grantedVia: 'management',
        counterDeviceId: null,
        expiresAt: '2027-03-10T12:00:00.000Z',
        revokedAt: null,
        revokedBy: null,
      })
    }

    const first = await adapters.customerDirectory.list(K, 'members', 0)
    expect(first.rows).toHaveLength(DIRECTORY_PAGE_SIZE)
    expect(first.next).toBe(DIRECTORY_PAGE_SIZE)

    const second = await adapters.customerDirectory.list(K, 'members', first.next!)
    expect(second.rows).toHaveLength(12)
    expect(second.next).toBeNull()

    const ids = [...first.rows, ...second.rows].map((row) => row.id)
    expect(new Set(ids).size).toBe(32)
  })
})

describe('the owner customer path — the card and its figures', () => {
  it('reports thirty days of visits and spend at the outlet, one bill a visit, voids as nothing', async () => {
    const { data, adapters } = session()
    const card = await adapters.customerDirectory.card(K, RITIKA)

    // Her Kalyani visits inside the window, and the store's own Kalyani bills.
    // The voided bill thirteen days back counts for neither; Kanchrapara's bills
    // are that outlet's.
    const inWindowOlder = data.customers.olderVisits.filter(
      (visit) =>
        visit.customerId === RITIKA &&
        visit.outletId === K &&
        !visit.voided &&
        visit.businessDate >= data.store.businessDate(29),
    )
    const storeBills = data.store.bills.filter(
      (bill) => bill.customer_id === RITIKA && bill.status === 'settled' && bill.outlet_id === K,
    )
    expect(card.visits30d).toBe(inWindowOlder.length + storeBills.length)
    expect(card.spend30dPaise).toBe(
      [
        ...inWindowOlder.map((visit) => visit.totalPaise),
        ...storeBills.map((b) => b.total_paise),
      ].reduce((sum, paise) => sum + paise, 0),
    )
    const elsewhere = await adapters.customerDirectory.card(N, RITIKA)
    expect(elsewhere.visits30d).toBeGreaterThan(0)
    expect(elsewhere.memberSince).toBeNull()
  })

  it('still says when a lapsed customer was last seen, with nothing in the window', async () => {
    const { customerDirectory } = session().adapters
    const card = await customerDirectory.card(N, SOURAV)
    expect(card).toMatchObject({ visits30d: 0, spend30dPaise: 0, memberSince: null })
    expect(card.lastSeenAt).not.toBeNull()
    expect(card.customerSince).toBeTruthy()
  })

  it('stores no figure on the customer: reading the card changes no profile', async () => {
    const { data, adapters } = session()
    const before = JSON.stringify([...data.customers.byPhone.values()])
    await adapters.customerDirectory.card(K, RITIKA)
    await adapters.customerDirectory.list(K, 'regulars', 0)
    await adapters.customerDirectory.list(K, 'members', 0)
    expect(JSON.stringify([...data.customers.byPhone.values()])).toBe(before)
    for (const profile of data.customers.byPhone.values()) {
      expect(Object.keys(profile).sort()).toEqual(['createdAt', 'id', 'name', 'phone'])
    }
  })
})

describe('membership', () => {
  it('reads as a member since the NEWEST grant after a revoke and a re-grant', async () => {
    const { data, adapters } = session()
    const spells = data.customers.memberships.filter((spell) => spell.customerId === RITIKA)
    const newest = spells.find((spell) => spell.revokedAt === null)
    expect(spells).toHaveLength(2)

    const card = await adapters.customerDirectory.card(K, RITIKA)
    expect(card.memberSince).toBe(newest?.grantedAt)
  })

  it('keeps a revoked spell as a record rather than deleting it', async () => {
    const { data, adapters } = session()
    const before = data.customers.memberships.length

    const card = await adapters.customerDirectory.revokeMembership(K, ARJUN)

    expect(card.memberSince).toBeNull()
    expect(data.customers.memberships).toHaveLength(before)
    const ended = data.customers.memberships.find((spell) => spell.customerId === ARJUN)
    expect(ended?.revokedAt).not.toBeNull()
    expect(ended?.revokedBy).toBeTruthy()
  })

  it('adds a new spell on a re-grant, and a second tap grants nothing twice', async () => {
    const { data, adapters } = session()
    await adapters.customerDirectory.revokeMembership(K, ARJUN)
    await adapters.customerDirectory.grantMembership(K, ARJUN)
    await adapters.customerDirectory.grantMembership(K, ARJUN)

    const spells = data.customers.memberships.filter((spell) => spell.customerId === ARJUN)
    expect(spells).toHaveLength(2)
    expect(spells.filter((spell) => spell.revokedAt === null)).toHaveLength(1)
  })

  it('tells the till the state here, the balance here and eligibility, and nothing else', async () => {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data)
    const till = createMockAdapters('biller', data)

    const member = await till.customers.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    expect(Object.keys(member ?? {}).sort()).toEqual(
      ['goldEligible', 'id', 'name', 'phone', 'pointsBalance', 'tier'].sort(),
    )
    expect(member).toMatchObject({ id: RITIKA, name: 'Ritika Sen', tier: 'gold' })
    expect(member?.pointsBalance).toBeGreaterThan(0)

    await owner.customerDirectory.grantMembership(K, MOUMITA)
    await expect(till.customers.lookupByPhone(DEMO_REGULAR_CUSTOMER_PHONE)).resolves.toMatchObject({
      tier: 'gold',
      goldEligible: false,
    })
    await owner.customerDirectory.revokeMembership(K, MOUMITA)
    await expect(till.customers.lookupByPhone(DEMO_REGULAR_CUSTOMER_PHONE)).resolves.toMatchObject({
      tier: null,
      goldEligible: true,
    })
  })

  it('is gold at one outlet only', async () => {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data)
    data.store.loyaltySettings.set(N, withGoldSwitched(data.store.loyaltySettings.get(K)!, true))
    await owner.customerDirectory.grantMembership(N, customerIdForPhone('+919000000107'))
    const till = createMockAdapters('biller', data)
    // The demo till stands at Kalyani, where Imran is not gold.
    await expect(till.customers.lookupByPhone('+919000000107')).resolves.toMatchObject({
      tier: null,
    })
  })

  it('carries the mark on the partial-number suggestion too', async () => {
    const store = createDemoStore()
    const customers = createDemoCustomers(store.today)
    const till = createMockCustomersAdapter(customers, 'biller', store)
    const suggested = await till.suggestByPartialPhone('9000')
    expect(suggested?.customer).toMatchObject({ id: RITIKA, tier: 'gold' })
  })

  it('leaves a bill rung for a member marked after the membership is revoked', async () => {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data)
    const till = createMockAdapters('biller', data)

    const before = await till.billing.listShiftHistory(DEMO_OPEN_SHIFT_ID)
    const hers = before.bills.find((bill) => bill.customerPhone === DEMO_RETURNING_CUSTOMER_PHONE)
    expect(hers?.customerTier).toBe('gold')

    await owner.customerDirectory.revokeMembership(K, RITIKA)

    const after = await till.billing.listShiftHistory(DEMO_OPEN_SHIFT_ID)
    expect(after.bills.find((bill) => bill.id === hers?.id)?.customerTier).toBe('gold')
  })
})

describe('correcting a name', () => {
  it('changes the profile and leaves every bill with the name it snapshotted', async () => {
    const { data, adapters } = session()
    const snapshotted = data.store.bills
      .filter((bill) => bill.customer_id === MOUMITA)
      .map((bill) => bill.customer_name)
    expect(snapshotted.length).toBeGreaterThan(0)

    const card = await adapters.customerDirectory.rename(K, MOUMITA, '  Moumita Ghosh  ')

    expect(card.name).toBe('Moumita Ghosh')
    expect(
      data.store.bills.filter((bill) => bill.customer_id === MOUMITA).map((b) => b.customer_name),
    ).toEqual(snapshotted)
  })

  it('refuses to erase a name', async () => {
    const { data, adapters } = session()
    await expect(adapters.customerDirectory.rename(K, MOUMITA, '   ')).rejects.toMatchObject({
      code: 'name_required',
    })
    expect(data.customers.byPhone.get(DEMO_REGULAR_CUSTOMER_PHONE)?.name).toBe('Moumta Ghosh')
  })

  it('names a customer who never gave one', async () => {
    const { customerDirectory } = session().adapters
    const unnamed = customerIdForPhone(DEMO_UNNAMED_CUSTOMER_PHONE)
    await expect(customerDirectory.rename(K, unnamed, 'Tanmoy')).resolves.toMatchObject({
      name: 'Tanmoy',
    })
  })
})
