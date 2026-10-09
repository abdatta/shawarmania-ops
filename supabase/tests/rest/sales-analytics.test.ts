import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAnalyticsAdapter } from '../../../src/data-access/supabase-adapters/analytics'

const outlet = '00000000-0000-4000-a000-000000000001',
  foreign = '00000000-0000-4000-a000-000000000002'
type Client = SupabaseClient<Database>
const keys = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
) as { ANON_KEY: string }
describe('analytics HTTP authority and bounded projection', () => {
  let owner: Client, manager: Client, employee: Client
  const make = () =>
    createClient<Database>('http://127.0.0.1:54321', keys.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  beforeAll(async () => {
    async function login(email: string) {
      const client = make()
      const { error } = await client.auth.signInWithPassword({
        email,
        password: 'shawarmania-local',
      })
      if (error) throw error
      return client
    }
    ;[owner, manager, employee] = await Promise.all([
      login('owner@login.shawarmania.invalid'),
      login('admin.kalyani@login.shawarmania.invalid'),
      login('staff.kalyani@login.shawarmania.invalid'),
    ])
  })
  afterAll(async () => {
    await Promise.all(
      [owner, manager, employee].filter(Boolean).map((c) => c.auth.signOut({ scope: 'local' })),
    )
  })
  it('manager reads own aggregates but cannot choose another outlet; staff and anonymous are refused', async () => {
    const adapter = createSupabaseAnalyticsAdapter(manager)
    const result = await adapter.read(outlet, '2020-01-01', '2020-01-07', {
      view: 'items',
      periods: 2,
    })
    expect(result.days).toHaveLength(2)
    expect(result.items.some((i) => i.units === 0 && i.active)).toBe(true)
    await expect(adapter.read(foreign, '2020-01-01', '2020-01-07')).rejects.toThrow()
    await expect(
      createSupabaseAnalyticsAdapter(employee).read(outlet, '2020-01-01', '2020-01-07'),
    ).rejects.toThrow()
    await expect(
      createSupabaseAnalyticsAdapter(make()).read(outlet, '2020-01-01', '2020-01-07'),
    ).rejects.toThrow()
  })
  it('returns only requested windows and view data without raw records or identities', async () => {
    const adapter = createSupabaseAnalyticsAdapter(owner)
    const sales = await adapter.read(outlet, '2026-01-01', '2026-01-30', {
      view: 'sales',
      periods: 4,
    })
    expect(sales.days).toHaveLength(120)
    expect(sales.items).toEqual([])
    expect(sales.categories).toEqual([])
    expect(sales.hours.length).toBeLessThanOrEqual(96)
    expect(sales.hours.every((h) => h.hour < 24 && h.period < 4)).toBe(true)
    const items = await adapter.read(outlet, '2026-01-01', '2026-01-30', {
      view: 'items',
      periods: 2,
    })
    expect(items.days).toHaveLength(2)
    expect(items.hours).toEqual([])
    expect(items.delivery).toEqual([])
    expect(JSON.stringify([sales, items])).not.toMatch(
      /customer_phone|customer_name|customer_id|bill_id|ordered_at|engagement/,
    )
    const one = await adapter.read(outlet, '2026-01-01', '2026-01-07', {
      view: 'sales',
      periods: 1,
    })
    expect(one.days).toHaveLength(7)
    expect(one.hours.length).toBeLessThanOrEqual(24)
    const today = new Date().toISOString().slice(0, 10)
    const first = new Date(`${today}T12:00:00Z`)
    first.setUTCDate(first.getUTCDate() - 6)
    const live = await adapter.read(outlet, first.toISOString().slice(0, 10), today, {
      view: 'sales',
      periods: 2,
    })
    expect(live.days.reduce((sum, d) => sum + d.orders, 0)).toBeGreaterThan(0)
    expect(live.hours.length).toBeLessThanOrEqual(48)
    console.info(
      `Analytics nonempty Sales/7d/2 JSON bytes: ${Buffer.byteLength(JSON.stringify(live))}`,
    )
    await expect(
      adapter.read(outlet, '2026-01-01', '2026-01-07', { view: 'sales', periods: 5 }),
    ).rejects.toThrow()
    console.info(
      `Analytics HTTP JSON bytes: Items/30d/2=${Buffer.byteLength(JSON.stringify(items))}; Sales/30d/4=${Buffer.byteLength(JSON.stringify(sales))}; Sales/7d/1=${Buffer.byteLength(JSON.stringify(one))}`,
    )
  })
})
