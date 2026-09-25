import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { DIRECTORY_PAGE_SIZE } from '../adapters'
import type { Database } from '../database.types'
import { createSupabaseCustomerDirectoryAdapter } from './customer-directory'

/**
 * The real management adapter against a stubbed client. What is tested is the
 * seam: how a page and its "is there more" are read, that a too-short search
 * never becomes a request, and that each refusal reads as something the card
 * can say. The scope those refusals defend is proved where it lives — pgTAP
 * (59_a_gold_member_is_a_label) and the REST probes.
 */
function adapterWith(rpc: ReturnType<typeof vi.fn>) {
  return createSupabaseCustomerDirectoryAdapter({ rpc } as unknown as SupabaseClient<Database>)
}

const ok = (rows: unknown) => vi.fn().mockResolvedValue({ data: rows, error: null })
const fails = (code: string) =>
  vi.fn().mockResolvedValue({ data: null, error: { code, message: 'refused' } })

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `c-${n}`,
  phone: `+91900000${String(n).padStart(4, '0')}`,
  name: `Customer ${n}`,
  is_member: false,
  visits_30d: 1,
  ...extra,
})

const CARD = {
  id: 'c-1',
  phone: '+919000000001',
  name: 'Ritika Sen',
  member_since: '2026-08-14T16:00:00.000Z',
  visits_30d: 9,
  spend_30d_paise: 413900,
  last_seen_at: '2026-09-24T07:30:00.000Z',
  customer_since: '2026-03-14T09:12:00.000Z',
  scope: 'outlets',
  editable: false,
}

describe('a list, a page at a time', () => {
  it('reads one row past a page as "there is a next page", and shows only the page', async () => {
    const rpc = ok(Array.from({ length: DIRECTORY_PAGE_SIZE + 1 }, (_, n) => row(n)))
    const page = await adapterWith(rpc).list('members', 40)

    expect(rpc).toHaveBeenCalledWith('customer_directory_list', { p_list: 'members', p_offset: 40 })
    expect(page.rows).toHaveLength(DIRECTORY_PAGE_SIZE)
    expect(page.next).toBe(40 + DIRECTORY_PAGE_SIZE)
  })

  it('ends when a page comes back short', async () => {
    const page = await adapterWith(ok([row(1), row(2)])).list('regulars', 0)
    expect(page.next).toBeNull()
    expect(page.rows.map((entry) => entry.id)).toEqual(['c-1', 'c-2'])
  })

  it('reads gold-or-not as the tier', async () => {
    const page = await adapterWith(ok([row(1, { is_member: true })])).list('members', 0)
    expect(page.rows[0]).toMatchObject({ tier: 'gold', visits30d: 1 })
  })
})

describe('searching', () => {
  it.each(['', 'ri', '90', '+91 9'])('asks nothing for %j', async (query) => {
    const rpc = ok([])
    await expect(adapterWith(rpc).search(query)).resolves.toEqual({ matches: [], more: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('counts the matches it is not showing, from the total each row carries', async () => {
    const rows = Array.from({ length: 20 }, (_, n) => row(n, { matched: 27 }))
    const result = await adapterWith(ok(rows)).search('rahul')
    expect(result.matches).toHaveLength(20)
    expect(result.more).toBe(7)
  })

  it('sends what was typed; the database parses it the same way the screen does', async () => {
    const rpc = ok([])
    await adapterWith(rpc).search('ghosh')
    expect(rpc).toHaveBeenCalledWith('customer_directory_search', { p_query: 'ghosh' })
  })
})

describe('a card', () => {
  it('reads every fact, including whether this reader may change it', async () => {
    await expect(adapterWith(ok([CARD])).card('c-1')).resolves.toEqual({
      id: 'c-1',
      phone: '+919000000001',
      name: 'Ritika Sen',
      memberSince: '2026-08-14T16:00:00.000Z',
      visits30d: 9,
      spend30dPaise: 413900,
      lastSeenAt: '2026-09-24T07:30:00.000Z',
      customerSince: '2026-03-14T09:12:00.000Z',
      scope: 'outlets',
      editable: false,
    })
  })

  it('reads no row as nobody — a customer out of reach answers exactly like one who does not exist', async () => {
    await expect(adapterWith(ok([])).card('c-9')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('writing', () => {
  it('refuses to erase a name without asking', async () => {
    const rpc = ok([CARD])
    await expect(adapterWith(rpc).rename('c-1', '   ')).rejects.toMatchObject({
      code: 'name_required',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends a trimmed name', async () => {
    const rpc = ok([CARD])
    await adapterWith(rpc).rename('c-1', '  Ritika Sen  ')
    expect(rpc).toHaveBeenCalledWith('customer_rename', { p_customer: 'c-1', p_name: 'Ritika Sen' })
  })

  it('says why a manager is refused a customer another outlet also serves', async () => {
    await expect(adapterWith(fails('42501')).grantMembership('c-1')).rejects.toMatchObject({
      code: 'not_permitted',
      message: expect.stringContaining('another outlet'),
    })
  })

  it.each([
    ['P0002', 'not_found'],
    ['22023', 'name_required'],
    ['08006', 'failed'],
  ])('reads %s as %s', async (sqlstate, code) => {
    await expect(adapterWith(fails(sqlstate)).revokeMembership('c-1')).rejects.toMatchObject({
      code,
    })
  })
})
