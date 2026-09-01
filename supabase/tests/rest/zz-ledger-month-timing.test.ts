/**
 * Open question 3, measured rather than estimated.
 *
 * The derived ledger month assembles thirty-one days from five sources with no
 * stored row. That is deliberate — a stored day row can disagree with its
 * sources and this one cannot — and the read cost is the trade. This file is what
 * turns "it should be comfortable at this scale" into a number.
 *
 * **If it stops holding, the remedy is a materialised read model, never a stored
 * day row.** The whole point of the derived reading is that it cannot be wrong
 * about itself.
 *
 * It asserts a generous ceiling rather than a tight one: this runs on a laptop
 * Docker stack against a seeded month, and a tight bound would fail for reasons
 * that have nothing to do with the query. What it is really guarding is an order
 * of magnitude — a month that started taking thirty seconds would be a different
 * design decision, and this is what would say so.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { createSupabaseLedgerStatementAdapter } from '../../../src/data-access/supabase-adapters/ledger-statement'
import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const OUTLETS = {
  Kalyani: '00000000-0000-4000-a000-000000000001',
  Kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

/** A laptop Docker stack, so this is an order-of-magnitude guard. */
const MONTH_CEILING_MS = 20_000

async function ownerClient(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: 'owner@login.shawarmania.invalid',
    password: 'shawarmania-local',
  })
  if (error) throw error
  return client
}

describe('the derived ledger month is measured, not assumed', () => {
  it.each(Object.entries(OUTLETS))(
    'reads a day and a whole month at %s within a sane bound',
    async (name, outletId) => {
      const adapter = createSupabaseLedgerStatementAdapter(await ownerClient())

      const dayStarted = performance.now()
      const day = await adapter.getDay(outletId, '2026-08-26')
      const dayMs = performance.now() - dayStarted
      expect(day.businessDate).toBe('2026-08-26')

      const monthStarted = performance.now()
      const month = await adapter.getMonth(outletId, '2026-08')
      const monthMs = performance.now() - monthStarted

      // Every day is read, including ones nobody touched — which is the property
      // the derived reading exists for. #52 stopped returning the thirty-one
      // rows and returns their tallies instead, so the count is asserted through
      // those: every date lands in exactly one of the three states.
      const { countedDays, carriedDays, notTrackedDays } = month.reading
      expect(countedDays + carriedDays + notTrackedDays).toBe(31)
      expect(month.reading.daysWithSales + month.reading.datesWithoutSales.length).toBe(31)
      for (const date of month.reading.datesWithoutSales) {
        expect(date).toMatch(/^2026-08-\d{2}$/)
      }

      // eslint-disable-next-line no-console -- the measurement IS the output.
      console.log(
        `  ${name.padEnd(13)} one day ${dayMs.toFixed(0).padStart(5)} ms   ` +
          `month ${monthMs.toFixed(0).padStart(6)} ms   ` +
          `per day ${(monthMs / 31).toFixed(0).padStart(4)} ms`,
      )

      expect(monthMs).toBeLessThan(MONTH_CEILING_MS)
    },
    60_000,
  )
})
