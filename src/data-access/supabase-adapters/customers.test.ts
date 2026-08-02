import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../database.types'
import { createSupabaseCustomersAdapter } from './customers'

/**
 * The real adapter against a stubbed client. What is being tested is the seam
 * itself: that a half-typed number never becomes a request, that the request
 * carries the CANONICAL phone rather than whatever was typed, and that each
 * SQLSTATE the migration raises becomes something a counter can act on.
 *
 * The boundary those SQLSTATEs defend is tested where it lives — pgTAP and the
 * REST probes. This file cannot prove a policy and does not pretend to.
 */
function adapterWith(rpc: ReturnType<typeof vi.fn>) {
  const client = { rpc } as unknown as SupabaseClient<Database>
  return createSupabaseCustomersAdapter(client)
}

const ok = (rows: unknown) => vi.fn().mockResolvedValue({ data: rows, error: null })
const fails = (code: string) =>
  vi.fn().mockResolvedValue({ data: null, error: { code, message: 'refused' } })

const ROW = { id: 'c-1', phone: '+919876543210', name: 'Anjali' }

describe('looking a customer up', () => {
  it('sends the canonical phone, not the one somebody typed', async () => {
    const rpc = ok([ROW])
    await adapterWith(rpc).lookupByPhone('  98765-43210 ')

    expect(rpc).toHaveBeenCalledWith('customer_lookup_by_phone', { p_phone: '+919876543210' })
  })

  it('returns the three columns the database is willing to disclose', async () => {
    const found = await adapterWith(ok([ROW])).lookupByPhone('9876543210')
    expect(found).toEqual({ id: 'c-1', phone: '+919876543210', name: 'Anjali' })
  })

  it('reads no rows as "nobody has used this number"', async () => {
    await expect(adapterWith(ok([])).lookupByPhone('9876543210')).resolves.toBeNull()
  })

  it.each([
    ['nothing typed', '', 'phone_required'],
    ['half a number', '98765', 'phone_incomplete'],
    ['a prefix', '9876%', 'phone_incomplete'],
  ])('refuses %s without spending a request', async (_shape, input, code) => {
    const rpc = ok([])
    await expect(adapterWith(rpc).lookupByPhone(input)).rejects.toMatchObject({ code })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['22023', 'phone_incomplete'],
    ['42501', 'not_permitted'],
    ['PT429', 'rate_limited'],
    ['08006', 'failed'],
  ])('turns SQLSTATE %s into %s', async (sqlstate, code) => {
    await expect(adapterWith(fails(sqlstate)).lookupByPhone('9876543210')).rejects.toMatchObject({
      code,
    })
  })

  it('tells a counter to carry on rather than to stop', async () => {
    await expect(adapterWith(fails('PT429')).lookupByPhone('9876543210')).rejects.toThrow(
      /Carry on with the bill/,
    )
  })
})

describe('saving a customer', () => {
  it('sends the canonical phone and the trimmed name', async () => {
    const rpc = ok([ROW])
    await adapterWith(rpc).createOrGet({ phone: '98765 43210', name: '  Anjali  ' })

    expect(rpc).toHaveBeenCalledWith('customer_create_or_get', {
      p_phone: '+919876543210',
      p_name: 'Anjali',
    })
  })

  // The name is spread rather than passed, because `exactOptionalPropertyTypes`
  // makes "absent" and "explicitly undefined" genuinely different things — and
  // a counter form produces both.
  it.each<[string, { name?: string | null }]>([
    ['no name', {}],
    ['a blank name', { name: '   ' }],
    ['a name of only spaces', { name: ' \t ' }],
    ['a null name', { name: null }],
  ])('omits the name argument entirely for %s', async (_shape, extra) => {
    const rpc = ok([{ ...ROW, name: null }])
    await adapterWith(rpc).createOrGet({ phone: '9876543210', ...extra })

    expect(rpc).toHaveBeenCalledWith('customer_create_or_get', { p_phone: '+919876543210' })
  })

  it('returns the saved profile, which may not be the name just typed', async () => {
    const saved = await adapterWith(ok([ROW])).createOrGet({
      phone: '9876543210',
      name: 'Somebody Else',
    })
    expect(saved.name).toBe('Anjali')
  })

  it('creates nothing from an incomplete phone', async () => {
    const rpc = ok([ROW])
    await expect(adapterWith(rpc).createOrGet({ phone: '98765' })).rejects.toMatchObject({
      code: 'phone_incomplete',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to invent an id when the function returns nothing', async () => {
    await expect(adapterWith(ok([])).createOrGet({ phone: '9876543210' })).rejects.toMatchObject({
      code: 'failed',
    })
  })
})
