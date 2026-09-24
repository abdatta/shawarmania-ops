import { describe, expect, it } from 'vitest'

import {
  CustomerActionError,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SEARCH_LIMIT,
  type AppRole,
} from '../adapters'
import { createDemoCustomers, createMockCustomersAdapter } from './customers'
import { createDemoStore } from './store'
import { createDemoData, createMockAdapters } from './index'
import { DEMO_OPEN_SHIFT_ID } from './fixtures/billing'
import { OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'
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

const RITIKA = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
const ARJUN = customerIdForPhone(DEMO_MEMBER_CUSTOMER_PHONE)
const MOUMITA = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)
const SOURAV = customerIdForPhone(DEMO_LAPSED_CUSTOMER_PHONE)

describe('the owner customer path — who may use it', () => {
  it.each(['biller', 'employee'] as AppRole[])('refuses %s on every method', async (role) => {
    const { customerDirectory } = session(role).adapters
    const calls = [
      () => customerDirectory.list('regulars', 0),
      () => customerDirectory.list('members', 0),
      () => customerDirectory.search('ritika'),
      () => customerDirectory.card(RITIKA),
      () => customerDirectory.rename(RITIKA, 'Somebody'),
      () => customerDirectory.grantMembership(MOUMITA),
      () => customerDirectory.revokeMembership(RITIKA),
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
    await expect(adapters.customerDirectory.grantMembership(MOUMITA)).rejects.toThrow()
    expect(data.customers.memberships.length).toBe(before)
  })
})

describe('a manager’s directory — their own outlets only', () => {
  // The demo manager runs Kalyani. Ritika and Moumita have bought at both
  // outlets; Arjun only at Kalyani; Imran and Sourav only at Kanchrapara.
  const IMRAN = customerIdForPhone('+919000000107')

  it('finds only customers their outlets have served', async () => {
    const { customerDirectory } = session('franchise_admin').adapters
    const members = await customerDirectory.list('members', 0)
    const regulars = await customerDirectory.list('regulars', 0)
    const everyone = [...members.rows, ...regulars.rows].map((row) => row.id)
    expect(everyone).toEqual(expect.arrayContaining([RITIKA, ARJUN, MOUMITA]))
    expect(everyone).not.toContain(SOURAV)
    expect(everyone).not.toContain(IMRAN)
    await expect(customerDirectory.search('sheikh')).resolves.toEqual({ matches: [], more: 0 })
  })

  it('answers a customer of another outlet exactly as it answers nobody', async () => {
    const { customerDirectory } = session('franchise_admin').adapters
    await expect(customerDirectory.card(SOURAV)).rejects.toMatchObject({ code: 'not_found' })
    await expect(customerDirectory.card('not-a-customer')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('counts only their own outlets’ bills on a shared customer’s card', async () => {
    const { data, adapters } = session('franchise_admin')
    const owner = await createMockAdapters('super_admin', data).customerDirectory.card(RITIKA)
    const manager = await adapters.customerDirectory.card(RITIKA)
    expect(manager.scope).toBe('outlets')
    expect(manager.visits30d).toBeLessThan(owner.visits30d)
    // Their "since" is their own first sale, not the business-wide date.
    expect(manager.customerSince).not.toBe(owner.customerSince)
  })

  it('may change a customer who has only ever bought at their outlets', async () => {
    const { data, adapters } = session('franchise_admin')
    const card = await adapters.customerDirectory.card(ARJUN)
    expect(card.editable).toBe(true)

    await adapters.customerDirectory.revokeMembership(ARJUN)
    await adapters.customerDirectory.rename(ARJUN, 'Arjun K. Das')
    const spell = data.customers.memberships.find((entry) => entry.customerId === ARJUN)
    // Recorded against the manager who did it, not against the owner.
    expect(spell?.revokedBy).toBe(personaFixtures.franchise_admin.profile.id)
  })

  it('may not change a customer another outlet also serves', async () => {
    const { data, adapters } = session('franchise_admin')
    const card = await adapters.customerDirectory.card(RITIKA)
    expect(card.editable).toBe(false)
    for (const call of [
      () => adapters.customerDirectory.rename(RITIKA, 'Somebody'),
      () => adapters.customerDirectory.revokeMembership(RITIKA),
      () => adapters.customerDirectory.grantMembership(MOUMITA),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_permitted' })
    }
    expect(data.customers.byPhone.get(DEMO_RETURNING_CUSTOMER_PHONE)?.name).toBe('Ritika Sen')
  })

  it('loses the right to change a customer the moment they buy at another outlet', async () => {
    const { data, adapters } = session('franchise_admin')
    expect((await adapters.customerDirectory.card(ARJUN)).editable).toBe(true)

    // Arjun is served at Kanchrapara for the first time.
    data.customers.olderVisits.push({
      customerId: ARJUN,
      outletId: OUTLET_KANCHRAPARA_ID,
      businessDate: data.store.businessDate(0),
      paidAt: new Date().toISOString(),
      totalPaise: 19900,
      voided: false,
    })

    expect((await adapters.customerDirectory.card(ARJUN)).editable).toBe(false)
    await expect(adapters.customerDirectory.revokeMembership(ARJUN)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })

  it('leaves the owner free to change anybody', async () => {
    const { adapters } = session('super_admin')
    const card = await adapters.customerDirectory.card(RITIKA)
    expect(card).toMatchObject({ scope: 'business', editable: true })
  })
})

describe('the owner customer path — finding somebody', () => {
  it('finds by a complete number however it was typed', async () => {
    const { customerDirectory } = session().adapters
    for (const typed of ['90000 00104', '+91 90000 00104', '9000000104']) {
      const { matches } = await customerDirectory.search(typed)
      expect(matches.map((row) => row.id)).toEqual([MOUMITA])
    }
    await expect(customerDirectory.search('9000000999')).resolves.toEqual({ matches: [], more: 0 })
  })

  it('finds by the digits somebody remembers, anywhere in the number', async () => {
    const { customerDirectory } = session().adapters
    const { matches } = await customerDirectory.search('0104')
    expect(matches.map((row) => row.id)).toEqual([MOUMITA])
  })

  it('finds by any part of a name, ignoring case — misspelt names included', async () => {
    const { customerDirectory } = session().adapters
    await expect(customerDirectory.search('ghosh')).resolves.toMatchObject({
      matches: [{ id: MOUMITA, name: 'Moumta Ghosh' }],
    })
    const { matches } = await customerDirectory.search('RIT')
    expect(matches.map((row) => row.name)).toEqual(expect.arrayContaining(['Ritika Sen']))
  })

  it('falls back to the same letters in order when exact matches leave room', async () => {
    const { customerDirectory } = session().adapters
    // `mmta` is not a run in any name, but it is M-m-ta in `Moumta Ghosh`.
    const { matches } = await customerDirectory.search('mmta')
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
    data.customers.byPhone.set('+919876500002', {
      id: 'exact',
      phone: '+919876500002',
      name: 'Sita Das',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    const { matches } = await adapters.customerDirectory.search('sita')
    expect(matches.map((row) => row.id)).toEqual(['exact', 'loose'])
  })

  it('answers nothing, rather than everybody, below the minimums', async () => {
    const { customerDirectory } = session().adapters
    await expect(customerDirectory.search('')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search('r')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search('ri')).resolves.toEqual({ matches: [], more: 0 })
    await expect(customerDirectory.search('90')).resolves.toEqual({ matches: [], more: 0 })
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
    }
    const { matches, more } = await adapters.customerDirectory.search('rahul')
    expect(matches).toHaveLength(DIRECTORY_SEARCH_LIMIT)
    expect(more).toBe(30 - DIRECTORY_SEARCH_LIMIT)
  })

  it('puts the customer seen most recently first', async () => {
    const { customerDirectory } = session().adapters
    // Every demo number contains `0000`; Sourav, who stopped coming, is last.
    const { matches } = await customerDirectory.search('0000')
    expect(matches.at(-1)?.id).toBe(SOURAV)
  })

  it('lists the current members, newest grant first', async () => {
    const { customerDirectory } = session().adapters
    const members = await customerDirectory.list('members', 0)
    // Arjun's one grant is more recent than Ritika's second.
    expect(members.rows.map((row) => row.id)).toEqual([ARJUN, RITIKA])
    expect(members.rows.every((row) => row.tier === 'gold')).toBe(true)
    expect(members.next).toBeNull()
  })

  it('ranks everybody seen this month by visits, one visit included, and leaves out who stopped coming', async () => {
    const { customerDirectory } = session().adapters
    const page = await customerDirectory.list('regulars', 0)
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
        grantedAt: '2026-09-10T12:00:00.000Z',
        grantedBy: 'owner',
        revokedAt: null,
        revokedBy: null,
      })
    }

    const first = await adapters.customerDirectory.list('members', 0)
    expect(first.rows).toHaveLength(DIRECTORY_PAGE_SIZE)
    expect(first.next).toBe(DIRECTORY_PAGE_SIZE)

    const second = await adapters.customerDirectory.list('members', first.next!)
    expect(second.rows).toHaveLength(12)
    expect(second.next).toBeNull()

    const ids = [...first.rows, ...second.rows].map((row) => row.id)
    expect(new Set(ids).size).toBe(32)
  })
})

describe('the owner customer path — the card and its figures', () => {
  it('reports thirty days of visits and spend, one bill a visit, voided bills as nothing', async () => {
    const { data, adapters } = session()
    const card = await adapters.customerDirectory.card(RITIKA)

    // Seven older visits inside the window, and two of the store's own bills —
    // one at each outlet. The voided bill thirteen days back counts for neither.
    const inWindowOlder = data.customers.olderVisits.filter(
      (visit) =>
        visit.customerId === RITIKA &&
        !visit.voided &&
        visit.businessDate >= data.store.businessDate(29),
    )
    const storeBills = data.store.bills.filter(
      (bill) => bill.customer_id === RITIKA && bill.status === 'settled',
    )
    expect(inWindowOlder).toHaveLength(7)
    expect(storeBills).toHaveLength(2)
    expect(card.visits30d).toBe(9)
    expect(card.spend30dPaise).toBe(
      [
        ...inWindowOlder.map((visit) => visit.totalPaise),
        ...storeBills.map((b) => b.total_paise),
      ].reduce((sum, paise) => sum + paise, 0),
    )
  })

  it('still says when a lapsed customer was last seen, with nothing in the window', async () => {
    const { customerDirectory } = session().adapters
    const card = await customerDirectory.card(SOURAV)
    expect(card).toMatchObject({ visits30d: 0, spend30dPaise: 0, memberSince: null })
    expect(card.lastSeenAt).not.toBeNull()
    expect(card.customerSince).toBeTruthy()
  })

  it('stores no figure on the customer: reading the card changes no profile', async () => {
    const { data, adapters } = session()
    const before = JSON.stringify([...data.customers.byPhone.values()])
    await adapters.customerDirectory.card(RITIKA)
    await adapters.customerDirectory.list('regulars', 0)
    await adapters.customerDirectory.list('members', 0)
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

    const card = await adapters.customerDirectory.card(RITIKA)
    expect(card.memberSince).toBe(newest?.grantedAt)
  })

  it('keeps a revoked spell as a record rather than deleting it', async () => {
    const { data, adapters } = session()
    const before = data.customers.memberships.length

    const card = await adapters.customerDirectory.revokeMembership(ARJUN)

    expect(card.memberSince).toBeNull()
    expect(data.customers.memberships).toHaveLength(before)
    const ended = data.customers.memberships.find((spell) => spell.customerId === ARJUN)
    expect(ended?.revokedAt).not.toBeNull()
    expect(ended?.revokedBy).toBeTruthy()
  })

  it('adds a new spell on a re-grant, and a second tap grants nothing twice', async () => {
    const { data, adapters } = session()
    await adapters.customerDirectory.revokeMembership(ARJUN)
    await adapters.customerDirectory.grantMembership(ARJUN)
    await adapters.customerDirectory.grantMembership(ARJUN)

    const spells = data.customers.memberships.filter((spell) => spell.customerId === ARJUN)
    expect(spells).toHaveLength(2)
    expect(spells.filter((spell) => spell.revokedAt === null)).toHaveLength(1)
  })

  it('tells the till the state and nothing else', async () => {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data)
    const till = createMockAdapters('biller', data)

    const member = await till.customers.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    expect(member).toEqual({
      id: RITIKA,
      phone: DEMO_RETURNING_CUSTOMER_PHONE,
      name: 'Ritika Sen',
      tier: 'gold',
    })

    await owner.customerDirectory.grantMembership(MOUMITA)
    await expect(till.customers.lookupByPhone(DEMO_REGULAR_CUSTOMER_PHONE)).resolves.toMatchObject({
      tier: 'gold',
    })
    await owner.customerDirectory.revokeMembership(MOUMITA)
    await expect(till.customers.lookupByPhone(DEMO_REGULAR_CUSTOMER_PHONE)).resolves.toMatchObject({
      tier: null,
    })
  })

  it('carries the mark on the partial-number suggestion too', async () => {
    const customers = createDemoCustomers(createDemoStore().today)
    const till = createMockCustomersAdapter(customers, 'biller')
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

    await owner.customerDirectory.revokeMembership(RITIKA)

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

    const card = await adapters.customerDirectory.rename(MOUMITA, '  Moumita Ghosh  ')

    expect(card.name).toBe('Moumita Ghosh')
    expect(
      data.store.bills.filter((bill) => bill.customer_id === MOUMITA).map((b) => b.customer_name),
    ).toEqual(snapshotted)
  })

  it('refuses to erase a name', async () => {
    const { data, adapters } = session()
    await expect(adapters.customerDirectory.rename(MOUMITA, '   ')).rejects.toMatchObject({
      code: 'name_required',
    })
    expect(data.customers.byPhone.get(DEMO_REGULAR_CUSTOMER_PHONE)?.name).toBe('Moumta Ghosh')
  })

  it('names a customer who never gave one', async () => {
    const { customerDirectory } = session().adapters
    const unnamed = customerIdForPhone(DEMO_UNNAMED_CUSTOMER_PHONE)
    await expect(customerDirectory.rename(unnamed, 'Tanmoy')).resolves.toMatchObject({
      name: 'Tanmoy',
    })
  })
})
