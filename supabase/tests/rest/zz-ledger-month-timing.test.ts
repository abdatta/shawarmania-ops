/**
 * The derived ledger, measured in round trips rather than milliseconds.
 *
 * The derived ledger assembles its days and months from five sources with no
 * stored row. That is deliberate — a stored day row can disagree with its
 * sources and this one cannot — and the read cost is the trade.
 *
 * **This file used to assert a millisecond ceiling, and that measured the wrong
 * thing.** It passed at ~300 ms for a month on a laptop stack while production
 * took 15–16.5 s (measured 2026-09-24): locally a request costs nothing, and in
 * production every request costs ~300 ms whatever it asks. A month was ~600
 * requests and a day 13 sequential round trips, and none of that was visible
 * here. So every request below is delayed by a fixed `LATENCY_MS`, which makes the
 * number of sequential round trips the thing the clock measures, exactly as a
 * phone on a real connection experiences it.
 *
 * **If it stops holding, the remedy is still never a stored day row.** The whole
 * point of the derived reading is that it cannot be wrong about itself.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toMonthDayInput } from '../../../src/data-access/adapters'
import { createSupabaseLedgerStatementAdapter } from '../../../src/data-access/supabase-adapters/ledger-statement'
import { createSupabaseOverviewAdapter } from '../../../src/data-access/supabase-adapters/overview'
import type { Database } from '../../../src/data-access/database.types'
import { resolveBusinessDate, shiftBusinessDate } from '../../../src/domain'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const OUTLETS = {
  Kalyani: '00000000-0000-4000-a000-000000000001',
  Kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

/**
 * The seed is dated relative to the day it is loaded — its bills, expenses and
 * counts sit in the last few days — so the period read here is too. A fixed
 * month read an empty one, which measured nothing: a date with no count skips
 * the drawer's balance reads entirely.
 */
const TODAY = resolveBusinessDate(new Date(), '04:00')
const DAY = shiftBusinessDate(TODAY, -1)
const MONTH = DAY.slice(0, 7)
const DAYS_IN_MONTH = new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 0).getDate()
/** The month reports only what has happened, so its tallies stop at today. */
const THROUGH = TODAY.slice(0, 7) === MONTH ? TODAY : `${MONTH}-${DAYS_IN_MONTH}`
const DATES_SO_FAR = Number(THROUGH.slice(8, 10))

/** What one request costs a phone in production, roughly (300 ms measured). */
const LATENCY_MS = 250
/**
 * Two sequential round trips is the budget (ledger-statement spec); the third
 * is headroom for the stack's own work, which is real but small.
 */
const ROUND_TRIP_BUDGET = 3
/** A month's requests do not grow with its dates. */
const MONTH_REQUEST_CEILING = 6

/** Only the cleanup uses this; it bypasses RLS, so no measurement ever does. */
function serviceClient(): SupabaseClient<Database> {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to clean up after this file')
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** The rows this file writes, and nothing else, go back to the seed. */
async function clearProbeRows(): Promise<void> {
  const service = serviceClient()
  const outlets = Object.values(OUTLETS)
  for (const table of [
    'drawer_observation_adjustments',
    'drawer_cash_out',
    'ledger_day_verifications',
    'drawer_observations',
  ] as const) {
    const { error } = await service.from(table).delete().in('outlet_id', outlets)
    if (error) throw error
  }
}

/**
 * The seed carries no drawer count, and a reading without one measures little.
 *
 * A day without a count never reads a balance — exactly the part of a day that
 * was slowest in production — so each outlet gets an anchor the evening before
 * the measured day and a count with a collection on it, recorded through the
 * real command. (A count may not precede the outlet's first recorded activity,
 * which the seed puts two days back.)
 *
 * The seed has no channel figures either, and nothing but the sync may write
 * them, so channel parity is not compared here. It is pinned field by field in
 * `supabase/tests/58_the_ledger_reads_in_two_round_trips.sql` instead, and the
 * one field that could differ in form between the two readers — a timestamp —
 * is serialised by Postgres's own JSON output in both.
 */
beforeAll(async () => {
  await clearProbeRows()
  const { client } = await ownerClient({ slow: false })
  const at = (date: string) => new Date(`${date}T22:00:00+05:30`).toISOString()
  for (const outletId of Object.values(OUTLETS)) {
    for (const [countedAt, total, collected] of [
      [at(shiftBusinessDate(DAY, -1)), 400000, null],
      [at(DAY), 612500, 450000],
    ] as const) {
      const { error } = await client.rpc('record_drawer_observation', {
        p_outlet_id: outletId,
        p_counted_at: countedAt,
        p_counted_total_paise: total,
        p_away_reason: 'ledger timing probe',
        ...(collected === null ? {} : { p_cash_out_paise: collected }),
      })
      if (error) throw error
    }
  }
}, 60_000)

afterAll(clearProbeRows, 60_000)

/**
 * An owner client whose every request, once `slow` is set, waits `LATENCY_MS`
 * before it leaves and is counted. Sign-in happens before, so it is neither.
 */
async function ownerClient(options: { slow?: boolean } = {}): Promise<{
  client: SupabaseClient<Database>
  meter: { slow: boolean; requests: number }
}> {
  const meter = { slow: false, requests: 0 }
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        if (meter.slow) {
          meter.requests += 1
          await new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
        }
        return fetch(input, init)
      },
    },
  })
  const { error } = await client.auth.signInWithPassword({
    email: 'owner@login.shawarmania.invalid',
    password: 'shawarmania-local',
  })
  if (error) throw error
  meter.slow = options.slow ?? true
  return { client, meter }
}

describe('the derived ledger is read in a bounded number of round trips', () => {
  it.each(Object.entries(OUTLETS))(
    'reads a day and a whole month at %s within the round-trip budget',
    async (name, outletId) => {
      const { client, meter } = await ownerClient()
      const adapter = createSupabaseLedgerStatementAdapter(client)

      meter.requests = 0
      const dayStarted = performance.now()
      const day = await adapter.getDay(outletId, DAY)
      const dayMs = performance.now() - dayStarted
      const dayRequests = meter.requests
      expect(day.businessDate).toBe(DAY)

      meter.requests = 0
      const monthStarted = performance.now()
      const month = await adapter.getMonth(outletId, MONTH)
      const monthMs = performance.now() - monthStarted
      const monthRequests = meter.requests

      // Every day is read, including ones nobody touched — which is the property
      // the derived reading exists for — and every date lands in exactly one of
      // the three drawer states.
      const { countedDays, carriedDays, notTrackedDays } = month.reading
      expect(countedDays + carriedDays + notTrackedDays).toBe(DATES_SO_FAR)
      expect(month.reading.daysWithSales + month.reading.datesWithoutSales.length).toBe(
        DATES_SO_FAR,
      )
      for (const date of month.reading.datesWithoutSales) {
        expect(date.startsWith(`${MONTH}-`)).toBe(true)
      }

      // Print the measurement so a run supplies evidence, not just a verdict.
      console.log(
        `  ${name.padEnd(13)} day ${dayMs.toFixed(0).padStart(5)} ms in ${String(dayRequests).padStart(3)} requests   ` +
          `month ${monthMs.toFixed(0).padStart(6)} ms in ${String(monthRequests).padStart(4)} requests   ` +
          `(${LATENCY_MS} ms a request)`,
      )

      expect(dayMs).toBeLessThan(ROUND_TRIP_BUDGET * LATENCY_MS)
      expect(monthMs).toBeLessThan(ROUND_TRIP_BUDGET * LATENCY_MS)
      expect(monthRequests).toBeLessThanOrEqual(MONTH_REQUEST_CEILING)

      // Overview must agree with the independently assembled Ledger.
      meter.slow = false
      const overview = createSupabaseOverviewAdapter(client)
      const [revenue, expenses, sales] = await Promise.all([
        overview.revenue(outletId, `${MONTH}-01`, THROUGH),
        overview.expenses(outletId, `${MONTH}-01`, THROUGH),
        overview.sales(outletId, day.businessDate),
      ])
      expect(revenue.revenuePaise).toBe(month.reading.netRevenuePaise)
      expect(revenue.provisional).toBe(month.reading.undeterminedDays > 0)
      expect(revenue.hasSales).toBe(month.reading.daysWithSales > 0)
      expect(expenses).toBe(month.reading.totalExpensesPaise)
      expect(sales).toEqual({ cashPaise: day.revenue.cashPaise, upiPaise: day.revenue.upiPaise })
    },
    120_000,
  )

  it.each(Object.entries(OUTLETS))(
    'reads every date of the month at %s identically as a day and within the month',
    async (_name, outletId) => {
      const { client, meter } = await ownerClient()
      meter.slow = false
      const { data, error } = await client.rpc('ledger_month_inputs', {
        p_outlet_id: outletId,
        p_month: `${MONTH}-01`,
      })
      expect(error).toBeNull()
      const fromMonth = data as unknown as ReturnType<typeof toMonthDayInput>[]
      expect(fromMonth).toHaveLength(DAYS_IN_MONTH)

      const adapter = createSupabaseLedgerStatementAdapter(client)
      for (const input of fromMonth) {
        const fromDay = toMonthDayInput(await adapter.getDay(outletId, input.businessDate))
        expect(input, input.businessDate).toEqual(fromDay)
      }
    },
    300_000,
  )
})
