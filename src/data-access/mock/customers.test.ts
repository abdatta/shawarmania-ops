import { describe, expect, it } from 'vitest'

import { CustomerActionError, type AppRole } from '../adapters'
import { createDemoCustomers, createMockCustomersAdapter } from './customers'
import { DEMO_RETURNING_CUSTOMER_PHONE, DEMO_UNNAMED_CUSTOMER_PHONE } from './fixtures/customers'

function billerAdapter() {
  const customers = createDemoCustomers()
  return { customers, adapter: createMockCustomersAdapter(customers, 'biller') }
}

describe('the demo customer directory', () => {
  it('recognises a returning customer however the phone was typed', async () => {
    const { adapter } = billerAdapter()

    for (const typed of ['9000000101', '90000 00101', '919000000101', '+91-90000-00101']) {
      const found = await adapter.lookupByPhone(typed)
      expect(found?.phone).toBe(DEMO_RETURNING_CUSTOMER_PHONE)
      expect(found?.name).toBe('Ritika Sen')
    }
  })

  it('returns a customer who never gave a name, rather than no customer', async () => {
    const { adapter } = billerAdapter()

    const found = await adapter.lookupByPhone(DEMO_UNNAMED_CUSTOMER_PHONE)
    expect(found).toMatchObject({ phone: DEMO_UNNAMED_CUSTOMER_PHONE, name: null })
  })

  it('says nobody rather than failing, for a complete number never seen', async () => {
    const { adapter } = billerAdapter()
    await expect(adapter.lookupByPhone('9000000999')).resolves.toBeNull()
  })

  it.each([
    ['nothing typed', '', 'phone_required'],
    ['half a number', '98765', 'phone_incomplete'],
    ['a prefix somebody hoped would search', '900000', 'phone_incomplete'],
    ['a wildcard', '90000001%', 'phone_incomplete'],
  ])('refuses %s', async (_shape, input, code) => {
    const { adapter } = billerAdapter()
    await expect(adapter.lookupByPhone(input)).rejects.toMatchObject({ code })
  })

  it.each(['super_admin', 'franchise_admin', 'employee'] as AppRole[])(
    'refuses %s, exactly as the database does',
    async (role) => {
      const customers = createDemoCustomers()
      const adapter = createMockCustomersAdapter(customers, role)

      await expect(adapter.lookupByPhone('9000000101')).rejects.toBeInstanceOf(CustomerActionError)
      await expect(adapter.lookupByPhone('9000000101')).rejects.toMatchObject({
        code: 'not_permitted',
      })
    },
  )
})

describe('saving a customer from the counter', () => {
  it('creates one identity the first time a phone is seen', async () => {
    const { adapter, customers } = billerAdapter()
    const before = customers.byPhone.size

    const created = await adapter.createOrGet({ phone: '98765 43210', name: '  Anjali  ' })

    expect(created).toMatchObject({ phone: '+919876543210', name: 'Anjali' })
    expect(customers.byPhone.size).toBe(before + 1)
    await expect(adapter.lookupByPhone('9876543210')).resolves.toMatchObject({ id: created.id })
  })

  it('reuses that identity from the next sale rather than making a second', async () => {
    const { adapter, customers } = billerAdapter()

    const first = await adapter.createOrGet({ phone: '9876543210', name: 'Anjali' })
    const second = await adapter.createOrGet({ phone: '+91 98765 43210' })

    expect(second.id).toBe(first.id)
    expect(customers.byPhone.size).toBe(3)
  })

  it('never rewrites a saved profile from a till', async () => {
    const { adapter } = billerAdapter()

    const reused = await adapter.createOrGet({
      phone: DEMO_RETURNING_CUSTOMER_PHONE,
      name: 'Somebody Else Entirely',
    })

    expect(reused.name).toBe('Ritika Sen')
    await expect(adapter.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)).resolves.toMatchObject({
      name: 'Ritika Sen',
    })
  })

  it('stores no name at all rather than an empty one', async () => {
    const { adapter } = billerAdapter()

    const created = await adapter.createOrGet({ phone: '9876500001', name: '   ' })
    expect(created.name).toBeNull()
  })

  it('creates nothing from an incomplete phone', async () => {
    const { adapter, customers } = billerAdapter()
    const before = customers.byPhone.size

    await expect(adapter.createOrGet({ phone: '98765', name: 'Half' })).rejects.toMatchObject({
      code: 'phone_incomplete',
    })
    expect(customers.byPhone.size).toBe(before)
  })

  it('hands out copies, so a screen editing what it was given renames nobody', async () => {
    const { adapter } = billerAdapter()

    const found = await adapter.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    if (found) found.name = 'Vandalised'

    await expect(adapter.lookupByPhone(DEMO_RETURNING_CUSTOMER_PHONE)).resolves.toMatchObject({
      name: 'Ritika Sen',
    })
  })

  it('survives a role switch, because one identity is the whole point', async () => {
    const customers = createDemoCustomers()
    const counter = createMockCustomersAdapter(customers, 'biller')

    const created = await counter.createOrGet({ phone: '9876543210', name: 'Anjali' })

    // A fresh adapter over the same session data — what a role switch rebuilds.
    const laterCounter = createMockCustomersAdapter(customers, 'biller')
    await expect(laterCounter.lookupByPhone('9876543210')).resolves.toMatchObject({
      id: created.id,
    })
  })
})
