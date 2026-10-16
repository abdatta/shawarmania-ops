/**
 * One revenue, read three ways (revenue-reads-the-same-everywhere, design D8).
 *
 * Overview's month (`overview_month`), the Ledger's month (`ledger_month_inputs`
 * folded by `readMonthFigures`) and Analytics' Month (`sales_analytics_v2`'s
 * totals) are three implementations of one definition, and three is the shape
 * that drifted before. This holds them together to the paisa over the live
 * seed, through the same adapters the screens use.
 */
import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAnalyticsAdapter } from '../../../src/data-access/supabase-adapters/analytics'
import { createSupabaseLedgerStatementAdapter } from '../../../src/data-access/supabase-adapters/ledger-statement'
import { createSupabaseOverviewAdapter } from '../../../src/data-access/supabase-adapters/overview'

const OUTLETS = [
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',
] as const
type Client = SupabaseClient<Database>
const keys = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
) as { ANON_KEY: string }

describe('Overview, the Ledger and Analytics give one month', () => {
  let owner: Client
  beforeAll(async () => {
    owner = createClient<Database>('http://127.0.0.1:54321', keys.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await owner.auth.signInWithPassword({
      email: 'owner@login.shawarmania.invalid',
      password: 'shawarmania-local',
    })
    if (error) throw error
  })
  afterAll(async () => {
    await owner?.auth.signOut({ scope: 'local' })
  })

  for (const outlet of OUTLETS) {
    it(`agrees to the paisa at ${outlet.slice(-1)}`, async () => {
      const overview = await createSupabaseOverviewAdapter(owner).month(outlet)
      const ledger = await createSupabaseLedgerStatementAdapter(owner).getMonth(
        outlet,
        overview.month,
        { cutover: '04:00' },
      )
      const analytics = await createSupabaseAnalyticsAdapter(owner).read(
        outlet,
        overview.from,
        overview.through,
        { view: 'sales', periods: 2, align: 'month', cut: true },
      )
      const figures = ledger.figures!
      // The seed must sell something, or this proves nothing.
      expect(overview.revenuePaise).toBeGreaterThan(0)
      expect(figures.revenuePaise).toBe(overview.revenuePaise)
      expect(figures.commissionPaise).toBe(overview.commissionPaise)
      expect(figures.expensesPaise).toBe(overview.expensesPaise)
      expect(figures.profitPaise).toBe(overview.profitPaise)
      expect(figures.waitingDays).toBe(overview.waitingDays)
      const [current, previous] = analytics.totals!
      expect(current!.counter + current!.delivery).toBe(overview.revenuePaise)
      expect(previous!.counter + previous!.delivery).toBe(overview.previous.revenuePaise)
    })
  }
})
