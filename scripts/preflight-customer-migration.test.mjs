import { describe, expect, it, vi } from 'vitest'

import {
  classifyCustomerRows,
  preflightCustomerMigration,
  readCustomerRows,
} from './preflight-customer-migration.mjs'

const config = {
  supabaseUrl: 'https://project.example.test',
  serviceKey: 'service-role-key',
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('classifying customer rows before the merge', () => {
  it('finds nothing to do in the empty database production actually has', () => {
    expect(classifyCustomerRows([])).toEqual({
      total: 0,
      distinctPhones: 0,
      invalidPhoneIds: [],
      mergeableGroups: [],
      conflictingGroups: [],
      blocked: false,
    })
  })

  it('treats presentation variants of one number as one customer', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: 'Rina', phone: '98765 43210' },
      { id: 'b', name: 'Rina', phone: '+91-98765-43210' },
    ])

    expect(result.distinctPhones).toBe(1)
    expect(result.mergeableGroups).toEqual([['a', 'b']])
    expect(result.conflictingGroups).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it('merges when one side simply never recorded a name', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: null, phone: '9876543210' },
      { id: 'b', name: '  Rina  ', phone: '919876543210' },
      { id: 'c', name: '', phone: '+919876543210' },
    ])

    expect(result.mergeableGroups).toEqual([['a', 'b', 'c']])
    expect(result.blocked).toBe(false)
  })

  it('treats case and surrounding space as presentation, not as a different person', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: 'rina', phone: '9876543210' },
      { id: 'b', name: 'Rina ', phone: '9876543210' },
    ])

    expect(result.mergeableGroups).toEqual([['a', 'b']])
  })

  it('refuses to choose between two different names on one number', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: 'Rina', phone: '9876543210' },
      { id: 'b', name: 'Sourav', phone: '9876543210' },
    ])

    expect(result.conflictingGroups).toEqual([['a', 'b']])
    expect(result.mergeableGroups).toEqual([])
    expect(result.blocked).toBe(true)
  })

  it('blocks on a phone the database could not identify anybody by', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: 'Rina', phone: null },
      { id: 'b', name: 'Sourav', phone: '98765' },
      { id: 'c', name: 'Ayan', phone: '9876543210' },
    ])

    expect(result.invalidPhoneIds).toEqual(['a', 'b'])
    expect(result.distinctPhones).toBe(1)
    expect(result.blocked).toBe(true)
  })

  it('reports ids and counts, and never a phone number or a name', () => {
    const result = classifyCustomerRows([
      { id: 'a', name: 'Rina', phone: '9876543210' },
      { id: 'b', name: 'Sourav', phone: '9876543210' },
      { id: 'c', name: 'Ayan', phone: 'nonsense' },
    ])

    const serialized = JSON.stringify(result)
    for (const secret of ['Rina', 'Sourav', 'Ayan', '9876543210', 'nonsense']) {
      expect(serialized).not.toContain(secret)
    }
  })
})

describe('reading the rows', () => {
  it('asks for three columns with the service key and nothing else', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]))

    await readCustomerRows({ ...config, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://project.example.test/rest/v1/customers?select=id,name,phone'),
      expect.objectContaining({
        headers: {
          apikey: 'service-role-key',
          Authorization: 'Bearer service-role-key',
          Accept: 'application/json',
        },
      }),
    )
  })

  it('refuses to run without credentials rather than reporting a clean database', async () => {
    await expect(readCustomerRows({ supabaseUrl: config.supabaseUrl })).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
  })

  it('fails loudly when the read itself fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))

    await expect(preflightCustomerMigration({ ...config, fetchImpl })).rejects.toThrow(/HTTP 401/)
  })

  it('classifies what it read', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { id: 'a', name: 'Rina', phone: '98765 43210' },
        { id: 'b', name: 'Rina', phone: '9876543210' },
      ]),
    )

    await expect(preflightCustomerMigration({ ...config, fetchImpl })).resolves.toMatchObject({
      total: 2,
      mergeableGroups: [['a', 'b']],
      blocked: false,
    })
  })
})
