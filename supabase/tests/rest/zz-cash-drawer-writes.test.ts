/**
 * The drawer over HTTP, with real tokens.
 *
 * `supabase/tests/41_cash_drawer.sql` proves the policies exhaustively with
 * simulated claims. This layer proves the deployed stack injects those claims
 * into real tokens and enforces them over PostgREST — which is the only place
 * the roadmap gate's "hand-crafted request with a valid session" is literally
 * true.
 *
 * Two claims here are worth the round trip and cannot be made in pgTAP:
 *
 *   * **A Super Admin holding no assignment anywhere reaches both drawers**, and
 *     the reach survives the journey through GoTrue. Confirmed against
 *     production twice (2026-08-26, 2026-08-27) that this is the only path that
 *     works: no live Franchise Admin assignment exists at either outlet, so a
 *     drawer reachable only through one would be reachable by nobody.
 *
 *   * **A Biller and an Employee are refused every drawer verb at their OWN
 *     outlet**, by the absence of a policy branch. Silent over-permission passes
 *     every functional test in this repo; this and the pgTAP file are the only
 *     things that catch it.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`.
 *
 * **This file makes real writes, which is why it runs in its own phase**
 * (`vitest.drawer-writes.config.ts`) rather than beside the other probes. Its
 * central claim is that the Super Admin path genuinely works over HTTP, and a
 * denied write would prove the opposite of the thing being asserted.
 *
 * It therefore cleans up after itself with the service-role key. Without that,
 * the committed rows are visible to `test:db`'s pgTAP suite on a later run
 * against the same reset, and Kanchrapara's anchor assertions start failing
 * against an outlet that already has an observation — which is what happened
 * before this cleanup existed, and is a better argument for it than any comment.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseCashDrawerAdapter } from '../../../src/data-access/supabase-adapters/cash-drawer'
import { createSupabaseLedgerStatementAdapter } from '../../../src/data-access/supabase-adapters/ledger-statement'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'

const OUTLETS = {
  kalyani: '00000000-0000-4000-a000-000000000001',
  kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

const EMAILS = {
  superAdmin: 'owner@login.shawarmania.invalid',
  faKalyani: 'admin.kalyani@login.shawarmania.invalid',
  billerKalyani: 'biller.kalyani@login.shawarmania.invalid',
  employeeKalyani: 'staff.kalyani@login.shawarmania.invalid',
} as const

/** Kalyani's surveyed position, so a probe is on site deliberately. */
const KALYANI_POSITION = { lat: 22.975, lng: 88.4345 }

type Client = SupabaseClient<Database>

const sessions = new Map<string, Promise<Client>>()

function signIn(email: string): Promise<Client> {
  const existing = sessions.get(email)
  if (existing) return existing

  const opened = (async () => {
    const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw new Error(`could not sign in ${email}: ${error.message}`)
    return client
  })()

  sessions.set(email, opened)
  return opened
}

/**
 * The service-role client, used for nothing but the cleanup below. It bypasses
 * RLS entirely, so it is deliberately never handed to a probe that is asserting
 * a refusal — that would test nothing.
 */
function serviceClient(): Client {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to clean up after this file')
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Put the seed back exactly as it was.
 *
 * Deletion order follows the foreign keys: adjustments and cash-out rows both
 * point at observations, so those go first. The drawer tables are the only ones
 * this file writes — no bill, expense or assignment is touched.
 */
afterAll(async () => {
  const service = serviceClient()
  const outlets = [OUTLETS.kalyani, OUTLETS.kanchrapara]

  // **The notebook expenses this file writes are withdrawn, not deleted, and
  // the difference was a real bug.** `manual_ledger_expenses_no_delete` refuses
  // a delete from every role, and `service_role` holds no grant on that table at
  // all — so the `.delete()` this replaces failed silently on every run and left
  // its row behind. A second run against the same reset then found two rows
  // where the probe asserts one. CI never saw it, because CI resets first and
  // runs once.
  //
  // Withdrawing is what the app itself does, it is what the guard permits, and
  // a withdrawn row never reaches `effective_expenses` — so the figures go back
  // exactly where the seed left them while the record stays honest about having
  // been written. Voided through the owner's own session for the same reason the
  // adapter does: the guard stamps `voided_by` from the session and refuses a
  // forged actor.
  const owner = await signIn(EMAILS.superAdmin)
  const { error: withdrawError } = await owner
    .from('expenses')
    .update({ voided_at: new Date().toISOString(), voided_reason: 'probe cleanup' })
    .in('category', [PROBE_EXPENSE, PROBE_DRAWER_EXPENSE])
    .is('voided_at', null)
  if (withdrawError) throw withdrawError

  await service.from('drawer_observation_adjustments').delete().in('outlet_id', outlets)
  await service.from('drawer_cash_out').delete().in('outlet_id', outlets)
  await service.from('drawer_observations').delete().in('outlet_id', outlets)
  await service.from('ledger_day_verifications').delete().in('outlet_id', outlets)

  // Proved rather than assumed: a cleanup that silently failed would leave the
  // next `test:db` run failing somewhere else entirely, which is a long way from
  // the cause.
  for (const table of [
    'drawer_observations',
    'drawer_cash_out',
    'drawer_observation_adjustments',
    'ledger_day_verifications',
  ] as const) {
    const { data, error } = await service.from(table).select('id')
    if (error) throw error
    if ((data?.length ?? 0) > 0) {
      throw new Error(`${table} still holds ${data?.length} row(s) after cleanup`)
    }
  }
})

/** The category this file's notebook expense carries, so cleanup can find it. */
const PROBE_EXPENSE = 'Probe · gas cylinder'

/** The same, for the row the drawer-breakdown probe writes at Kanchrapara. */
const PROBE_DRAWER_EXPENSE = 'Probe · drawer breakdown'

/** A count instant guaranteed to be after any this file has already used. */
let instantCursor = 0
function freshInstant(): string {
  instantCursor += 1
  return new Date(Date.now() - 60_000 + instantCursor * 1000).toISOString()
}

describe('a Super Admin holding no assignment reaches every drawer', () => {
  it('records an observation at an outlet they are not assigned to', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { data, error } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 450000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      // Kalyani's position is 3 km from Kanchrapara, so this probe is off site
      // on purpose: being elsewhere is recorded, never refused.
      p_away_reason: 'REST probe, deliberately off site',
    })

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('records a collection, a spend and reads both back, at both outlets', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const collection = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      p_amount_paise: 300000,
      p_kind: 'collection',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })
    expect(collection.error).toBeNull()

    const spend = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      p_amount_paise: 250000,
      p_kind: 'spend',
      p_reason: 'Gas cylinder, paid from the till',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })
    expect(spend.error).toBeNull()

    const { data, error } = await owner
      .from('drawer_cash_out')
      .select('outlet_id, kind, amount_paise')
      .in('outlet_id', [OUTLETS.kalyani, OUTLETS.kanchrapara])
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThan(0)
  })

  it('a negative collection is accepted over HTTP, with no reason', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { data, error } = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      // A minus is cash ADDED to a thin drawer. There is deliberately no second
      // endpoint, kind or parameter for it.
      p_amount_paise: -100000,
      p_kind: 'collection',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('verifies a business date', async () => {
    const owner = await signIn(EMAILS.superAdmin)
    const { error } = await owner.rpc('verify_ledger_day', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_business_date: '2026-08-20',
      p_note: 'REST probe',
    })
    expect(error).toBeNull()
  })
})

describe('a Franchise Admin reaches their own outlet and no other', () => {
  it('reads their own outlet and gets nothing for the other', async () => {
    const manager = await signIn(EMAILS.faKalyani)

    const own = await manager.from('drawer_cash_out').select('id').eq('outlet_id', OUTLETS.kalyani)
    expect(own.error).toBeNull()
    expect(own.data?.length ?? 0).toBeGreaterThan(0)

    const other = await manager
      .from('drawer_cash_out')
      .select('id')
      .eq('outlet_id', OUTLETS.kanchrapara)
    expect(other.error).toBeNull()
    // Not an error — an empty result. The row is invisible rather than forbidden,
    // which is what stops a probe learning that it exists.
    expect(other.data).toEqual([])
  })

  it('is refused a hand-crafted write at the outlet they do not manage', async () => {
    const manager = await signIn(EMAILS.faKalyani)
    const { error } = await manager.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 100000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      p_away_reason: 'probe',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/Franchise Admin assigned to this outlet/)
  })
})

describe('a Biller and an Employee are refused every drawer verb, at their own outlet', () => {
  const tables = [
    'drawer_observations',
    'drawer_cash_out',
    'drawer_observation_adjustments',
    'ledger_day_verifications',
  ] as const

  for (const persona of ['billerKalyani', 'employeeKalyani'] as const) {
    describe(persona, () => {
      it.each(tables)('reads no row from %s at any outlet', async (table) => {
        const client = await signIn(EMAILS[persona])
        const { data, error } = await client.from(table).select('id')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it.each(tables)('cannot insert into %s with a valid session', async (table) => {
        const client = await signIn(EMAILS[persona])
        // A hand-crafted insert. The shape is deliberately plausible: what
        // refuses it is the missing grant and the absent policy, not a
        // validation error it could correct.
        const { error } = await client.from(table).insert({
          outlet_id: OUTLETS.kalyani,
        } as never)
        expect(error).not.toBeNull()
      })

      it.each(tables)('cannot update or delete %s', async (table) => {
        const client = await signIn(EMAILS[persona])

        const updated = await client
          .from(table)
          .update({ outlet_id: OUTLETS.kalyani } as never)
          .eq('outlet_id', OUTLETS.kalyani)
          .select('id')
        // Either refused outright, or matched nothing because the select side of
        // the policy hides every row. Both are the refusal; what must never
        // happen is a row coming back changed.
        expect(updated.error !== null || (updated.data?.length ?? 0) === 0).toBe(true)

        const deleted = await client
          .from(table)
          .delete()
          .eq('outlet_id', OUTLETS.kalyani)
          .select('id')
        expect(deleted.error !== null || (deleted.data?.length ?? 0) === 0).toBe(true)
      })

      it('is refused the count command at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('record_drawer_observation', {
          p_outlet_id: OUTLETS.kalyani,
          p_counted_at: freshInstant(),
          p_counted_total_paise: 100000,
          p_certain: true,
          p_lat: KALYANI_POSITION.lat,
          p_lng: KALYANI_POSITION.lng,
          p_accuracy_m: 10,
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/Super Admin/)
      })

      it('is refused the cash-out command at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('record_drawer_cash_out', {
          p_outlet_id: OUTLETS.kalyani,
          p_amount_paise: 100000,
        })
        expect(error).not.toBeNull()
      })

      it('is refused day verification at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('verify_ledger_day', {
          p_outlet_id: OUTLETS.kalyani,
          p_business_date: '2026-08-20',
        })
        expect(error).not.toBeNull()
      })
    })
  }
})

describe('no client supplies a derived figure', () => {
  it('the observation table refuses a direct insert even from a Super Admin', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    // Every derived figure is computed inside the transaction that writes the
    // row. This is the request that would bypass that, and there is no grant for
    // it — so an opening, an expected total and a difference cannot be dictated
    // by a screen even with the most privileged session in the business.
    const { error } = await owner.from('drawer_observations').insert({
      outlet_id: OUTLETS.kalyani,
      counted_at: freshInstant(),
      counted_total_paise: 999999,
      opening_paise: 0,
      expected_paise: 0,
      difference_paise: 999999,
      is_approximate: false,
      recorded_by: '10000000-0000-4000-a000-000000000001',
    } as never)

    expect(error).not.toBeNull()
  })

  it('the command exposes no parameter for an expected total or a difference', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { error } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kalyani,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 100000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      // There is no p_expected_paise and no p_difference_paise. PostgREST
      // refuses an unknown named argument rather than ignoring it, so this
      // assertion is about the function's signature and not about validation.
      p_expected_paise: 0,
    } as never)

    expect(error).not.toBeNull()
  })
})

/**
 * The defect the owner found on 2026-08-28, over HTTP, through the real adapter.
 *
 * The Ledger's Expenses card said "Nothing recorded" on days with real expenses,
 * because both live surfaces read `public.expenses` — a table nothing has ever
 * written. Every live Expenses surface writes `manual_ledger_expenses`.
 *
 * **It has to be tested here rather than as a component test.** The mock store
 * writes and reads one `expenses` array, so demo mode is self-consistent by
 * construction and can never reproduce this. Only production had two tables, one
 * written and the other read — and only a real round trip proves PostgREST
 * exposes the view the fix introduced, which is the same class of failure the
 * `effective_bill_payments` embed comment in the drawer adapter warns about.
 */
describe('expenses are read where they are written', () => {
  it('carries a notebook cash expense onto the Ledger day and into the drawer interval', async () => {
    const owner = await signIn(EMAILS.superAdmin)
    const businessDate = new Date().toISOString().slice(0, 10)
    const occurredAt = new Date(Date.now() - 45 * 60_000).toISOString()

    // Written the way the live Expenses surface writes one, with the caller's
    // own session rather than the service role, so the insert policy is
    // exercised too.
    const { data: profile } = await owner.auth.getUser()
    const { error: writeError } = await owner.from('expenses').insert({
      outlet_id: OUTLETS.kalyani,
      business_date: businessDate,
      category: PROBE_EXPENSE,
      amount_paise: 90000,
      is_cash: true,
      occurred_at: occurredAt,
      recorded_by: profile.user?.id ?? null,
    })
    expect(writeError).toBeNull()

    // 1. The view exposes it over PostgREST at all.
    const { data: viaView, error: viewError } = await owner
      .from('effective_expenses')
      .select('*')
      .eq('outlet_id', OUTLETS.kalyani)
      .eq('category', PROBE_EXPENSE)
    expect(viewError).toBeNull()
    expect(viaView).toHaveLength(1)
    expect(viaView?.[0]?.is_cash).toBe(true)
    expect(viaView?.[0]?.source_table).toBe('expenses')

    // 2. The Ledger day carries it. This is the card that read "Nothing
    //    recorded" — the assertion the owner's screenshot is of.
    const ledger = createSupabaseLedgerStatementAdapter(owner)
    const day = await ledger.getDay(OUTLETS.kalyani, businessDate)
    expect(day.expenses.totalPaise).toBeGreaterThanOrEqual(90000)
    expect(day.expenses.rows.map((row) => row.label)).toContain(PROBE_EXPENSE)
    expect(day.expenses.rows.find((row) => row.label === PROBE_EXPENSE)?.isCash).toBe(true)

    // 3. And the drawer's own arithmetic counts it, which is the half that
    //    would otherwise manufacture a shortfall at the next count.
    const { data: interval, error: intervalError } = await owner.rpc('drawer_cash_expenses_paise', {
      p_outlet_id: OUTLETS.kalyani,
      p_from: new Date(Date.now() - 90 * 60_000).toISOString(),
      p_to: new Date().toISOString(),
    })
    expect(intervalError).toBeNull()
    expect(Number(interval)).toBeGreaterThanOrEqual(90000)
  })

  it('refuses the interval readers to a Biller, at their own outlet', async () => {
    // These three are `security definer` and granted to `authenticated`, so they
    // are the one path around every drawer policy. They shipped taking the
    // outlet from the caller and checking nothing: a Biller read ₹1,005 of
    // Kalyani's receipts through them, measured on 2026-08-28.
    const biller = await signIn(EMAILS.billerKalyani)

    for (const rpc of ['drawer_cash_receipts_paise', 'drawer_cash_expenses_paise'] as const) {
      const { data, error } = await biller.rpc(rpc, {
        p_outlet_id: OUTLETS.kalyani,
        // An explicit early bound rather than null: the generated signature
        // types this as a timestamp, and the window is not what is under test.
        p_from: '2020-01-01T00:00:00.000Z',
        p_to: new Date().toISOString(),
      })
      expect(error).toBeNull()
      expect(Number(data)).toBe(0)
    }

    const { data: cashOut, error: cashOutError } = await biller.rpc('drawer_cash_out_paise', {
      p_outlet_id: OUTLETS.kalyani,
      p_from: '2020-01-01T00:00:00.000Z',
      p_to: new Date().toISOString(),
    })
    expect(cashOutError).toBeNull()
    expect(Number(cashOut)).toBe(0)
  })
})

/**
 * The row counts beside the balance card's figures, through the real adapter.
 *
 * **Nothing else in this repo executes `createSupabaseCashDrawerAdapter`.**
 * pgTAP proves the grouped readers with simulated claims, the component suites
 * prove the screens against mocks. So an RPC name PostgREST does not expose, a
 * `Returns` row shape that maps to `undefined`, or a count still derived from
 * the wrong list would all ship green. This closes that gap, and it is the layer
 * where the two defects this change fixes actually lived:
 *
 *   * `cashReceiptsSinceCount` was `nearbyCashBills.filter(...).length` — over a
 *     list capped at twelve and drawn from the last forty settled bills for the
 *     movable boundary and the exact-coincidence report. Forty cash bills since
 *     the last count reported twelve. The cap on that list is deliberate and
 *     untouched: it is evidence for a person to recognise rather than an
 *     aggregate. Only the count stops being derived from it, and what it is
 *     derived from instead is asserted below. That the grouped reader itself
 *     counts thirteen bills as thirteen is
 *     `supabase/tests/43_the_drawer_explains_its_figures.sql` section 5, which
 *     can hold a bill and its payment in one transaction — the deferred
 *     payment-total guard makes that impossible over two PostgREST requests.
 *
 *   * `cashExpensesSinceCount` was the literal `0`, which one real expense is
 *     enough to falsify.
 */
describe('the counts beside the figures come from the grouped reads', () => {
  it('reconciles both breakdowns to their own tiles, and counts a real expense', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    // An anchor at Kanchrapara, so there is an interval to read. Recorded
    // through the command, because no client may write the table.
    const anchorAt = freshInstant()
    const { error: anchorError } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: anchorAt,
      p_counted_total_paise: 500000,
      p_certain: false,
      p_lat: 22.9345,
      p_lng: 88.42,
      p_accuracy_m: 10,
      p_away_reason: 'probe',
    })
    expect(anchorError).toBeNull()

    // A cash expense inside the interval, written the way the live Expenses
    // surface writes one. On the tree the drawer reported nought expenses
    // whatever this row said.
    const { error: expenseError } = await owner.from('expenses').insert({
      outlet_id: OUTLETS.kanchrapara,
      business_date: resolveBusinessDate(new Date(), '04:00'),
      category: PROBE_DRAWER_EXPENSE,
      amount_paise: 47500,
      is_cash: true,
      occurred_at: new Date(Date.parse(anchorAt) + 1000).toISOString(),
    } as never)
    expect(expenseError).toBeNull()

    const drawer = createSupabaseCashDrawerAdapter(owner)
    const state = await drawer.getState(OUTLETS.kanchrapara)

    // The literal nought, gone.
    expect(state.cashExpensesSinceCount).toBeGreaterThanOrEqual(1)
    expect(state.cashExpensesSincePaise).toBeGreaterThanOrEqual(47500)

    // **And each breakdown adds up to the tile it explains** (design D8).
    // Summed here, in the test, precisely because nothing in the app is allowed
    // to: the groups and the scalar come from one predicate a `group by` apart,
    // and this is what proves the two have not parted company over the wire.
    expect(state.cashExpensesByDay.reduce((sum, day) => sum + day.paise, 0)).toBe(
      state.cashExpensesSincePaise,
    )
    expect(state.cashExpensesByDay.reduce((sum, day) => sum + day.rows, 0)).toBe(
      state.cashExpensesSinceCount,
    )
    expect(state.receiptsByDay.reduce((sum, day) => sum + day.paise, 0)).toBe(
      state.cashReceiptsSincePaise,
    )
    expect(state.receiptsByDay.reduce((sum, day) => sum + day.bills, 0)).toBe(
      state.cashReceiptsSinceCount,
    )

    // Every group is a business date, resolved by the database through the
    // outlet's own cutover rather than by a constant in the adapter.
    for (const day of [...state.receiptsByDay, ...state.cashExpensesByDay]) {
      expect(day.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }

    // The nearby list keeps its cap: it serves the movable boundary and the
    // coincidence report, and is deliberately not a complete set.
    expect(state.nearbyCashBills.length).toBeLessThanOrEqual(12)
  })

  it('edits the newest count in full, and leaves the note alone when it is not touched', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    // Three ticks of the cursor, so the count lands a comfortable few seconds
    // after whatever this file counted last and the boundary below has somewhere
    // to move to without colliding with its predecessor.
    freshInstant()
    freshInstant()
    const countedAt = freshInstant()
    const { data: recorded, error: recordError } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: countedAt,
      p_counted_total_paise: 610000,
      p_certain: false,
      p_lat: 22.9345,
      p_lng: 88.42,
      p_accuracy_m: 10,
      p_away_reason: 'probe',
      p_note: 'the note that must survive',
    })
    expect(recordError).toBeNull()
    const observationId = (recorded as unknown as { id: string }).id
    const expectedBefore = (recorded as unknown as { expected_paise: number | null }).expected_paise

    const drawer = createSupabaseCashDrawerAdapter(owner)

    // An amount-only edit. **This is the live bug**: the adapter sent no note
    // and the command assigned one unconditionally, so every typo correction
    // silently cleared the note.
    const amountOnly = await drawer.editObservation(observationId, {
      countedTotalPaise: 605000,
    })
    expect(amountOnly.countedTotalPaise).toBe(605000)
    expect(amountOnly.note).toBe('the note that must survive')
    expect(amountOnly.expectedPaise).toBe(expectedBefore)
    // Compared as instants: PostgREST renders `+00:00` where the client wrote
    // `Z`, and a string comparison would be about the serialisation.
    expect(Date.parse(amountOnly.countedAt)).toBe(Date.parse(countedAt))

    // Moving the instant recomputes what the count is measured against.
    const movedTo = new Date(Date.parse(countedAt) - 1_500).toISOString()
    const moved = await drawer.editObservation(observationId, {
      countedTotalPaise: 605000,
      countedAt: movedTo,
    })
    expect(Date.parse(moved.countedAt)).toBe(Date.parse(movedTo))
    expect(moved.note).toBe('the note that must survive')
    if (moved.expectedPaise !== null) {
      expect(moved.differencePaise).toBe(moved.countedTotalPaise - moved.expectedPaise)
    }

    // And the bounds a recorded instant carries apply to a moved one.
    await expect(
      drawer.editObservation(observationId, {
        countedTotalPaise: 605000,
        countedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
    ).rejects.toThrow(/future/i)
  })
})

/**
 * The first page of counts, and the reads behind it.
 *
 * `listObservations` scopes a page's movements to that page's observations.
 * `getState` — the FIRST page — used to read the newest sixty movements at the
 * outlet instead, ordered by instant and scoped to nothing. So a burst of
 * spends could push an older row's own collection out of that window, and the
 * row found no movements of its own: `Collected` understated, `Left`
 * overstated, and the carry-forward computed against a counted total that had
 * not had its collection deducted — **which reported an opening break that did
 * not exist.**
 *
 * The fixture is the bug's own shape, which is why it is this size: four counts
 * each carrying a collection, then sixty unattached spends recorded afterwards,
 * so every collection falls outside a newest-sixty window and none falls outside
 * a read scoped by observation. Under the previous code all four rows report a
 * fabricated break; under this one, none does.
 *
 * It is volume-dependent by nature and cannot be shrunk: with few rows the wrong
 * read and the right one return the same answer, which is exactly why this went
 * unnoticed. Unreachable in production until `retire-the-manual-ledger` (#12)
 * carried August across and took each outlet from three counts to nineteen.
 */
describe('the first page of counts reads its own movements, not a sample of recent ones', () => {
  it('reports no break where none exists, with sixty spends sitting on top', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const collectionPaise = 200_000
    const recordedIds: string[] = []
    for (let count = 0; count < 4; count += 1) {
      const { data, error } = await owner.rpc('record_drawer_observation', {
        p_outlet_id: OUTLETS.kanchrapara,
        p_counted_at: freshInstant(),
        p_counted_total_paise: 500_000,
        p_certain: true,
        p_away_reason: 'REST probe, deliberately off site',
        // The collection is the observation's OWN movement, which is the whole
        // point: it is what the carry-forward deducts.
        p_cash_out_paise: collectionPaise,
        p_cash_out_kind: 'collection',
      })
      expect(error).toBeNull()
      recordedIds.push((data as unknown as { id: string }).id)
    }

    // Sixty, exactly filling the window the old read used. Each is trivial in
    // rupees and recorded at `now()`, so all sixty are newer than every
    // collection above.
    for (let batch = 0; batch < 6; batch += 1) {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          owner.rpc('record_drawer_cash_out', {
            p_outlet_id: OUTLETS.kanchrapara,
            p_amount_paise: 100,
            p_kind: 'spend',
            p_reason: 'Probe · window filler',
            p_away_reason: 'REST probe, deliberately off site',
          }),
        ),
      )
      for (const result of results) expect(result.error).toBeNull()
    }

    const drawer = createSupabaseCashDrawerAdapter(owner)
    const state = await drawer.getState(OUTLETS.kanchrapara)

    const mine = state.recentObservations.filter((row) => recordedIds.includes(row.id))
    expect(mine).toHaveLength(4)

    for (const observation of mine) {
      // Each row's own collection is present, so `Collected` and `Left` are the
      // figures that were actually recorded.
      expect(observation.ownCashOut.reduce((sum, movement) => sum + movement.amountPaise, 0)).toBe(
        collectionPaise,
      )
      // And no break is invented. Every one of these openings came from the
      // command's own carry-forward, so a reported break here could only be the
      // read's arithmetic missing a collection.
      expect(observation.openingBreakPaise).toBeNull()
    }

    // The count beside the paise agrees with it: both are the movements since
    // the last count, and they used to come from different bounds.
    expect(state.cashOutSinceCount).toBe(60)
    expect(state.cashOutSincePaise).toBe(60 * 100)
  })
})
