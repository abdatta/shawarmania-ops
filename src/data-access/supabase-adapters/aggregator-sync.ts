import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  AggregatorSyncAdapter,
  AggregatorSyncEvent,
  AggregatorSyncEventRow,
  AggregatorSyncHealth,
  HyperpureHealth,
  StatementUploadResult,
} from '../adapters'
import type { Database } from '../database.types'

/**
 * The Zomato sync, read from what actually happened.
 *
 * **Nothing here is a table.** There is no `sync_events` row anywhere: every line the
 * surface shows is derived from the records the sync already keeps — the runs, the day
 * figures, the reconciliation conclusions, the sourced expenses. An event table would
 * be a second account of the same facts, free to drift from them, and the first
 * disagreement would be unresolvable because both would look authoritative.
 *
 * Tenancy comes from the policies, as it does for every other adapter here. Each of
 * these tables refuses every outlet role at every outlet including their own, so a
 * query that returns rows has already proved the caller is the owner.
 */

/**
 * One raw ingest result, rendered as a human line for the upload confirmation.
 *
 * The parser returns per-write bookkeeping — orders written for a supply
 * statement, days written (or a reconciliation refusal) for a Zomato cycle. The
 * owner needs the plain fact, not the JSON: "17 Hyperpure supply orders written".
 */
function describeUpload(kind: StatementUploadResult['kind'], r: Record<string, unknown>): string {
  const count = (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0)
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  if (kind === 'hyperpure-statement') {
    return `${plural(count(r.orders_written), 'Hyperpure supply order', 'Hyperpure supply orders')} written`
  }
  if (r.outcome === 'reconciliation_failed') {
    return 'A week did not add up to what Zomato paid — nothing was overwritten'
  }
  return `${plural(count(r.days_written), 'day', 'days')} of Zomato figures written`
}

/** How wide a net the duplicate signal casts. Deliberately loose; see below. */
const DUPLICATE_DAYS = 4
const DUPLICATE_FLOOR_PAISE = 5_000
const DUPLICATE_FRACTION = 0.02

export function createSupabaseAggregatorSyncAdapter(
  client: SupabaseClient<Database>,
): AggregatorSyncAdapter {
  async function call(body: Record<string, unknown>, fn: string): Promise<void> {
    const { error } = await client.functions.invoke(fn, { body })
    if (error) {
      // Deliberately plain. These four actions are all owner-initiated on a screen
      // that already reports the sync's own state, so the surface says "that did not
      // go through" and the next read shows what is actually true. A code-per-failure
      // vocabulary would be inventing distinctions the screen cannot act on.
      throw new Error(`${fn} did not go through`)
    }
  }

  async function health(outletId: string): Promise<AggregatorSyncHealth> {
    const [run, configured, credential] = await Promise.all([
      client
        .from('aggregator_sync_runs')
        .select('started_at, finished_at, outcome, rehearsal')
        .eq('outlet_id', outletId)
        .eq('channel', 'zomato')
        // A rehearsal wrote nothing, so it is not what "last ran" means to somebody
        // asking whether their figures are current.
        .eq('rehearsal', false)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('outlet_channel_sync')
        .select('synced_from')
        .eq('outlet_id', outletId)
        .eq('channel', 'zomato')
        .maybeSingle(),
      // Owner-only, and it answers with dates and booleans: whether a session exists,
      // when it dies, and whether a code is being waited for. Never the session.
      client.rpc('aggregator_credential_health', { p_channel: 'zomato' }).maybeSingle(),
    ])

    const waiting = credential.data?.awaiting_code_since
      ? {
          requestedAt: credential.data.awaiting_code_since,
          expiresAt:
            credential.data.awaiting_code_expires_at ?? credential.data.awaiting_code_since,
        }
      : null

    return {
      outletId,
      lastRunAt: run.data?.started_at ?? null,
      lastOutcome: (run.data?.outcome ?? null) as AggregatorSyncHealth['lastOutcome'],
      // A run with no finish is one still going. There is no separate flag, so the
      // two cannot disagree about whether something is happening.
      running: run.data !== null && run.data.finished_at === null,
      awaitingOneTimePassword: waiting,
      syncedFrom: configured.data?.synced_from ?? null,
    }
  }

  async function hyperpureHealth(): Promise<HyperpureHealth> {
    // Account-level: the statement covers every Hyperpure outlet, so the run is not
    // filtered by outlet — the latest hyperpure run is the account's last read.
    const [run, credential] = await Promise.all([
      client
        .from('aggregator_sync_runs')
        .select('started_at, finished_at, outcome, rehearsal')
        .eq('channel', 'hyperpure')
        .eq('rehearsal', false)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client.rpc('aggregator_credential_health', { p_channel: 'hyperpure' }).maybeSingle(),
    ])

    return {
      lastRunAt: run.data?.started_at ?? null,
      lastOutcome: (run.data?.outcome ?? null) as HyperpureHealth['lastOutcome'],
      running: run.data !== null && run.data.finished_at === null,
      hasSession: credential.data?.has_session ?? false,
      sessionExpiresAt: credential.data?.session_expires_at ?? null,
    }
  }

  /**
   * Every line the page shows, newest first.
   *
   * Five queries rather than one view, because each answers a different question and a
   * view joining them would multiply rows and then need distinct-ing back down — which
   * is where a total quietly doubles.
   */
  async function events(outletId: string): Promise<AggregatorSyncEventRow[]> {
    const [runs, cycles, days, typed, sourced, dismissedPairs] = await Promise.all([
      client
        .from('aggregator_sync_runs')
        .select('id, started_at, outcome, detail, rehearsal')
        .eq('outlet_id', outletId)
        .eq('channel', 'zomato')
        .in('outcome', ['session_lapsed', 'shape_changed'])
        .order('started_at', { ascending: false })
        .limit(20),
      client
        .from('aggregator_cycle_reconciliations')
        .select(
          'id, cycle_start, cycle_end, computed_paise, stated_payout_paise, outcome, accepted_at, updated_at',
        )
        .eq('outlet_id', outletId)
        .eq('channel', 'zomato')
        .order('cycle_start', { ascending: false })
        .limit(8),
      client
        .from('aggregator_channel_days')
        .select(
          'business_date, revenue_paise, commission_paise, provisional_revenue_paise, provisional_commission_paise, revised_at',
        )
        .eq('outlet_id', outletId)
        .eq('channel', 'zomato')
        .not('revised_at', 'is', null)
        .order('business_date', { ascending: false })
        .limit(20),
      client
        .from('manual_ledger_expenses')
        .select('id, business_date, amount_paise, description')
        .eq('outlet_id', outletId)
        .is('source_system', null)
        .is('voided_at', null),
      client
        .from('manual_ledger_expenses')
        .select('id, business_date, amount_paise, description, created_at')
        .eq('outlet_id', outletId)
        .eq('source_system', 'zomato')
        .is('voided_at', null),
      client
        .from('aggregator_dismissed_duplicates')
        .select('expense_a, expense_b')
        .eq('outlet_id', outletId),
    ])

    // Pairs the owner has already settled as two real purchases. Keyed the same
    // way the event id is built, so a dismissed pair never raises the flag again.
    const dismissed = new Set(
      (dismissedPairs.data ?? []).map((row) => `${row.expense_a}-${row.expense_b}`),
    )

    const rows: AggregatorSyncEventRow[] = []
    const push = (id: string, at: string, event: AggregatorSyncEvent, resolvedAt: string | null) =>
      rows.push({ id, outletId, at, event, resolvedAt })

    for (const run of runs.data ?? []) {
      push(
        `run-${run.id}`,
        run.started_at,
        run.outcome === 'session_lapsed'
          ? { kind: 'session-lapsed', detail: run.detail }
          : { kind: 'shape-changed', detail: run.detail },
        // A lapse is over once a session exists again, which the next successful run
        // proves. Resolved rather than removed: "Zomato signed us out on Tuesday" is
        // worth being able to find.
        null,
      )
    }

    for (const cycle of cycles.data ?? []) {
      const difference = cycle.computed_paise - cycle.stated_payout_paise
      if (cycle.outcome === 'disputed') {
        push(
          `cycle-${cycle.id}`,
          cycle.updated_at,
          {
            kind: 'week-disputed',
            from: cycle.cycle_start,
            to: cycle.cycle_end,
            computedPaise: cycle.computed_paise,
            statedPayoutPaise: cycle.stated_payout_paise,
            differencePaise: difference,
          },
          cycle.accepted_at,
        )
      } else {
        push(
          `cycle-${cycle.id}`,
          cycle.updated_at,
          {
            kind: 'week-settled',
            from: cycle.cycle_start,
            to: cycle.cycle_end,
            netPaise: cycle.stated_payout_paise,
          },
          null,
        )
      }
    }

    for (const day of days.data ?? []) {
      // Present is what "revised" means, and the constraint guarantees both sides are
      // there when it is, so neither coalesce below can hide a missing figure.
      const was = (day.provisional_revenue_paise ?? 0) - (day.provisional_commission_paise ?? 0)
      const now = (day.revenue_paise ?? 0) - (day.commission_paise ?? 0)
      push(
        `revised-${day.business_date}`,
        day.revised_at as string,
        {
          kind: 'day-revised',
          businessDate: day.business_date,
          fromNetPaise: was,
          toNetPaise: now,
        },
        null,
      )
    }

    /*
     * Two expenses that may be one purchase entered twice.
     *
     * Matched on the same outlet exactly, an amount within the larger of 2% or ₹50, and
     * a date within four days either way. Never on category or description, which name
     * the same purchase differently by construction: a hand-entered row says what the
     * owner calls it and a sourced row says what Zomato calls it.
     *
     * The looseness is chosen from an asymmetry rather than from taste. A flag the
     * owner dismisses costs one tap. A duplicate nobody flags overstates costs and
     * understates profit, quietly and permanently.
     */
    for (const mine of typed.data ?? []) {
      const twin = (sourced.data ?? []).find((theirs) => {
        const tolerance = Math.max(DUPLICATE_FLOOR_PAISE, mine.amount_paise * DUPLICATE_FRACTION)
        if (Math.abs(theirs.amount_paise - mine.amount_paise) > tolerance) return false
        const apart =
          Math.abs(Date.parse(theirs.business_date) - Date.parse(mine.business_date)) / 86_400_000
        return apart <= DUPLICATE_DAYS
      })
      if (!twin) continue
      // Already settled as two real purchases, so it is not raised again.
      if (dismissed.has(`${mine.id}-${twin.id}`)) continue

      push(
        `duplicate-${mine.id}-${twin.id}`,
        twin.created_at,
        {
          kind: 'possible-duplicate-expense',
          typed: {
            businessDate: mine.business_date,
            amountPaise: mine.amount_paise,
            note: mine.description,
            expenseId: mine.id,
          },
          synced: {
            businessDate: twin.business_date,
            amountPaise: twin.amount_paise,
            note: twin.description,
            expenseId: twin.id,
          },
        },
        null,
      )
    }

    return rows.sort((a, b) => b.at.localeCompare(a.at))
  }

  return {
    getHealth: health,
    getHyperpureHealth: hyperpureHealth,
    listEvents: events,

    async countNeedsOwner() {
      /*
       * Counted across every outlet the caller reaches, not the one in view.
       *
       * The badge sits on a navigation tab: a week that would not reconcile at the
       * other outlet, appearing only once that outlet was selected, would be a badge
       * that hides at exactly the moment it is worth having.
       */
      const [outlets, disputed, lapsed] = await Promise.all([
        client.from('outlet_channel_sync').select('outlet_id').eq('channel', 'zomato'),
        client
          .from('aggregator_cycle_reconciliations')
          .select('outlet_id')
          .eq('channel', 'zomato')
          .eq('outcome', 'disputed')
          .is('accepted_at', null),
        client
          .from('aggregator_sync_runs')
          .select('outlet_id, started_at, outcome')
          .eq('channel', 'zomato')
          .eq('rehearsal', false)
          .order('started_at', { ascending: false })
          .limit(50),
      ])

      // The most recent run per outlet decides whether a session is still lapsed. An
      // older lapse followed by a success has been dealt with.
      const latest = new Map<string, string>()
      for (const run of lapsed.data ?? []) {
        if (!latest.has(run.outlet_id)) latest.set(run.outlet_id, run.outcome)
      }

      const counts = new Map<string, number>()
      for (const outlet of outlets.data ?? []) counts.set(outlet.outlet_id, 0)
      const bump = (outletId: string) => counts.set(outletId, (counts.get(outletId) ?? 0) + 1)

      for (const row of disputed.data ?? []) bump(row.outlet_id)
      for (const [outletId, outcome] of latest) {
        if (outcome === 'session_lapsed') bump(outletId)
      }

      // Duplicates are per outlet and need the same pairing the page does, so they are
      // asked for through it rather than reimplemented — one rule, one answer.
      await Promise.all(
        [...counts.keys()].map(async (outletId) => {
          const rows = await events(outletId)
          const duplicates = rows.filter(
            (row) => row.event.kind === 'possible-duplicate-expense' && row.resolvedAt === null,
          ).length
          if (duplicates > 0) counts.set(outletId, (counts.get(outletId) ?? 0) + duplicates)
        }),
      )

      return [...counts].map(([outletId, needing]) => ({ outletId, needing }))
    },

    async requestRun(outletId) {
      await call(
        { outlet_id: outletId, channel: 'zomato', mode: 'sync' },
        'request-aggregator-sync',
      )
    },

    async requestReconnect(outletId) {
      await call(
        { outlet_id: outletId, channel: 'zomato', mode: 'reconnect' },
        'request-aggregator-sync',
      )
    },

    async answerOneTimePassword(_outletId, code) {
      // The code goes nowhere else. Not logged, not held, not put in a URL: it is
      // handed over and this adapter keeps nothing.
      await call({ channel: 'zomato', code }, 'answer-aggregator-otp')
    },

    async recheckWeek(outletId, _from, _to) {
      // A re-check is an ordinary run. The reader re-reads whole cycles every time, so
      // there is nothing to narrow and nothing gained by pretending otherwise.
      await call(
        { outlet_id: outletId, channel: 'zomato', mode: 'sync' },
        'request-aggregator-sync',
      )
    },

    async acceptDifference(outletId, from, to) {
      await call(
        {
          outlet_id: outletId,
          channel: 'zomato',
          mode: 'accept',
          cycle_start: from,
          cycle_end: to,
        },
        'request-aggregator-sync',
      )
    },

    async markNotDuplicate(outletId, eventId) {
      // The event id is `duplicate-<typed>-<synced>`, the two expenses the signal
      // paired. The decision is remembered against that ordered pair, so the next
      // read excludes it and the owner is not asked again. Neither expense is
      // touched: they are two real purchases, and both belong in the ledger.
      const match = eventId.match(/^duplicate-([0-9a-f-]{36})-([0-9a-f-]{36})$/)
      if (!match) {
        throw new Error(`That is not a duplicate flag this surface can dismiss (${eventId}).`)
      }
      const expenseA = match[1] ?? ''
      const expenseB = match[2] ?? ''
      const { data: session } = await client.auth.getUser()
      const { error } = await client.from('aggregator_dismissed_duplicates').insert({
        outlet_id: outletId,
        expense_a: expenseA,
        expense_b: expenseB,
        dismissed_by: session.user?.id ?? '',
      })
      // A pair dismissed twice is already remembered, which is success, not an error.
      if (error && error.code !== '23505') {
        throw new Error('That did not go through')
      }
    },

    async uploadStatement(file) {
      // The bytes go to the one parser both callers share; the outlets it writes
      // for are re-derived server-side from the caller's own session, never sent.
      const { data, error } = await client.functions.invoke('parse-operator-statement', {
        body: { file_base64: file.base64, filename: file.filename, confirmed: file.confirmed },
      })
      if (error) {
        // The function speaks a small vocabulary of refusals; the surface only
        // needs to distinguish "this file is wrong" from "that did not go
        // through", and the former is worth showing verbatim.
        const detail = (error as { context?: { detail?: string } }).context?.detail
        throw new Error(detail ?? 'That upload did not go through')
      }
      const result = data as {
        kind: StatementUploadResult['kind']
        results: Record<string, unknown>[]
      }
      return {
        kind: result.kind,
        wrote: result.results.map((r) => describeUpload(result.kind, r)),
      }
    },
  }
}
