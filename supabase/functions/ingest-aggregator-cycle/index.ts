import { serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import {
  emptySummary,
  mergeSummaries,
  readReadsPerDay,
  readRunOrigin,
  saidHowItBegan,
} from '../_shared/run-summary.ts'
import {
  AGGREGATOR_OUTCOMES,
  type AggregatorOutcome,
  decideRunOutcome,
  declaredDegradation,
  reachedNoData,
} from '../_shared/run-outcome.ts'

/**
 * The door the aggregator readers post settlement through.
 *
 * The readers themselves live in a separate private repository, because they
 * hold live merchant sessions and this one is public. What lives here is the
 * contract they write through, and the reasons that contract is shaped the way
 * it is:
 *
 *  1. **It decides almost nothing.** `ingest_aggregator_cycle` checks the
 *     contract version, resolves every order's trading day through the outlet's
 *     own cutover, enforces the reconciliation gate and writes the whole cycle in
 *     one transaction. A cycle cannot half-write, which it could if this file
 *     issued the statements itself.
 *
 *  2. **The credential is not a database credential.** A GitHub secret can leak.
 *     Had it been the pooler password or the service-role key, a leak would hand
 *     over staff records, attendance and billing; scoped to this endpoint it
 *     hands over the ability to post settlement rows for two named outlets.
 *
 *  3. **The outlets are named by the server, never by the caller.** This function
 *     holds the service role and therefore writes past Row-Level Security, so
 *     the outlet in the body is checked against `AGGREGATOR_SYNC_OUTLETS` rather
 *     than believed.
 *
 *  4. **Every run is recorded, including the ones that wrote nothing.** A sync
 *     that quietly stops is the failure mode being designed out, so silence has
 *     to be visible as silence.
 *
 *  5. **A rehearsal is a different function, not a flag on this one.** Sending
 *     `rehearse: true` routes the cycle to `rehearse_aggregator_cycle`, which runs
 *     every check the real path runs and rolls the writes back. The run is
 *     recorded as a rehearsal so the surface cannot report seven days written by a
 *     run that wrote none.
 *
 * Registered with verify_jwt = false in supabase/config.toml: the caller is a
 * scheduled job holding its own secret, not a person holding a session.
 */

const CONTRACT_VERSION = 1

/**
 * The restaurant channels this boundary serves. Hyperpure is deliberately
 * absent: its statement books supply expenses through a different contract,
 * and a payload claiming it here is either a bug or an impostor — refused by
 * name before anything reaches the database.
 */
const CHANNELS: readonly string[] = ['zomato', 'swiggy']

// The vocabulary and the choice between its words live together in
// `_shared/run-outcome.ts`, where `npm test` can reach them. `Outcome` stays as a
// local alias so the rest of this file reads as it did.
type Outcome = AggregatorOutcome
const OUTCOMES = AGGREGATOR_OUTCOMES

/**
 * Constant-time comparison, so a wrong secret cannot be discovered a character
 * at a time by measuring how quickly it was rejected.
 */
function secretMatches(offered: string, expected: string): boolean {
  if (offered.length !== expected.length) return false
  let difference = 0
  for (let i = 0; i < offered.length; i += 1) {
    difference |= offered.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return difference === 0
}

function permittedOutlets(): string[] {
  return (Deno.env.get('AGGREGATOR_SYNC_OUTLETS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const expected = Deno.env.get('AGGREGATOR_SYNC_SECRET')
  if (!expected) {
    console.error('AGGREGATOR_SYNC_SECRET is not configured; refusing every caller')
    return json({ error: 'not_configured' }, 503)
  }

  const offered = str(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')
  if (!offered || !secretMatches(offered, expected)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const body = await readJson(req)
  if (!body) return json({ error: 'malformed_body' }, 400)

  if (body['contract_version'] !== CONTRACT_VERSION) {
    // Loud and specific. A Zomato shape change should break the job, which a
    // maintainer reads, rather than reach the database, which nobody reads.
    return json({ error: 'unsupported_contract_version', expected: CONTRACT_VERSION }, 400)
  }

  const outletId = str(body['outlet_id'])
  const channel = str(body['channel']) ?? 'zomato'
  const startedAt = str(body['started_at']) ?? new Date().toISOString()
  const declared = str(body['outcome']) as Outcome | undefined
  const outlets = permittedOutlets()

  /*
   * How the run began, from the process that ran it.
   *
   * The runner knows its own trigger context — a timed workflow against a
   * dispatched one — and a client looking at timestamps does not: two scheduled
   * runs and one the owner asked for inside the same minute are
   * indistinguishable by time, and this record exists to be believed.
   *
   * Constrained to the two words rather than passed through. Free text here
   * would be rendered to the owner by a surface that cannot check it, and the
   * database would refuse it anyway — this turns that refusal into a legible
   * 400 instead of a run that failed to record itself.
   */
  const startedBy = readRunOrigin(body['started_by'])
  if (saidHowItBegan(body['started_by']) && startedBy === null) {
    return json({ error: 'unknown_started_by' }, 400)
  }

  /*
   * How often the runner is scheduled, parsed by the runner from its own cron.
   *
   * **Dropped rather than refused when it makes no sense.** An unknown
   * `started_by` is a caller bug worth a 400, because there are two words and a
   * third means somebody invented one. A cadence is arithmetic on a cron the
   * runner read itself, so a bad value means a parse went wrong — and failing
   * the whole run over a caption would trade a wrong number for no run record
   * at all. The app falls back to its own constant.
   */
  const readsPerDay = readReadsPerDay(body['reads_per_day'])

  if (!outletId || !outlets.includes(outletId)) {
    return json({ error: 'outlet_not_permitted' }, 403)
  }

  if (!CHANNELS.includes(channel)) {
    return json({ error: 'unknown_channel', channel }, 400)
  }

  if (declared !== undefined && !OUTCOMES.includes(declared)) {
    return json({ error: 'unknown_outcome' }, 400)
  }

  const cycles = Array.isArray(body['cycles']) ? (body['cycles'] as unknown[]) : []
  const service = serviceClient()

  /**
   * A rehearsal reconciles a real cycle and throws the writes away.
   *
   * `=== true` rather than a truthy check, and defaulting to the writing path
   * rather than to the safe one. A caller that omits the flag, or sends a string,
   * or sends something a proxy mangled, gets the ordinary behaviour — which is
   * the behaviour that runs twice a day for years, and the one whose meaning must
   * never depend on how a field was parsed. Rehearsing is the deliberate, typed,
   * once-in-a-lifetime request, so it is the one that has to be exact.
   */
  const rehearsing = body['rehearse'] === true

  /**
   * What this run changed, carried from the transactions that changed it.
   *
   * Each cycle worked its own movements out while it still held both the stored
   * figure and the incoming one; afterwards a day restated identically is
   * indistinguishable from a day touched, so this is the only chance to know.
   * A run that ingested no cycles carries the empty summary rather than null —
   * null means "recorded before #48", which is a different sentence.
   *
   * **A rehearsal writes nothing, so it summarises nothing.** Its cycles report
   * what they would have moved, and carrying that onto the run would put
   * movements the ledger never saw into the history.
   *
   * **Since a run may now fall short and still write, this field is also what
   * says how far short it fell.** A degraded run carrying an empty summary saved
   * nothing; one carrying movements saved that much. There is deliberately no
   * sixth outcome word for the difference: the outcome names the fault, which is
   * what routes it to a person, and completeness is already recorded here — by
   * the write, inside its own transaction, which is the only moment it is
   * knowable at all.
   */
  const summaryFor = (results: readonly unknown[]) =>
    rehearsing ? emptySummary() : mergeSummaries(results)

  const finish = async (
    outcome: Outcome,
    detail: string | null,
    status: number,
    extra: Record<string, unknown> = {},
    results: readonly unknown[] = [],
  ) => {
    const { error } = await service.rpc('record_aggregator_sync_run', {
      p_outlet_id: outletId,
      p_channel: channel,
      p_started_at: startedAt,
      p_outcome: outcome,
      p_detail: detail,
      p_rehearsal: rehearsing,
      p_started_by: startedBy ?? undefined,
      p_summary: summaryFor(results),
      p_reads_per_day: readsPerDay ?? undefined,
    })
    if (error) {
      // The run's own record failing is not a reason to lose the answer, but it
      // does mean the owner's surface will under-report, so it is loud.
      console.error('could not record the sync run', error)
    }
    return json({ outcome, rehearsal: rehearsing, ...extra }, status)
  }

  const declaredDetail = str(body['detail']) ?? null

  /*
   * A declared degradation is a statement about the READ, and it no longer
   * decides what happens to the write.
   *
   * This used to return here whatever else the request carried, so a runner had
   * two sentences available to it — "I wrote this" or "I failed" — and a run that
   * read six settled weeks and could not read the open one had to pick one and
   * lie with it. On 2026-08-31 the Swiggy reader spent eighteen hours picking the
   * second, discarding every settled week behind one changed operation.
   *
   * With no cycles the behaviour is exactly what it was: a run that reached no
   * data still reports itself, writes nothing for those dates and never a zero,
   * because a zero is indistinguishable from a day with no orders.
   */
  if (reachedNoData(declared, cycles.length)) {
    return await finish(declared as Outcome, declaredDetail, 200)
  }

  // `ok` alongside cycles declares nothing: a caller cannot assert that a run
  // succeeded over what its own writes did. `declaredDegradation` is where that
  // is decided, and where it is tested.
  const degraded = declaredDegradation(declared)

  const results: unknown[] = []
  let unreconciled = 0

  for (const cycle of cycles) {
    const { data, error } = await service.rpc(
      rehearsing ? 'rehearse_aggregator_cycle' : 'ingest_aggregator_cycle',
      {
        p_payload: cycle,
        p_permitted_outlets: outlets,
      },
    )

    if (error) {
      console.error('a cycle was refused by the write contract', error)
      // The cycles that already committed still moved figures, so what they
      // moved is recorded even though the run as a whole failed.
      return await finish('shape_changed', error.message, 422, { results }, results)
    }

    results.push(data)
    if ((data as { outcome?: string } | null)?.outcome === 'reconciliation_failed') {
      unreconciled += 1
    }
  }

  // One word for a run that reached its writes, chosen by the precedence in
  // `_shared/run-outcome.ts` rather than by which branch here happens to run
  // first. What the run nonetheless moved rides on its summary.
  const { outcome, detail } = decideRunOutcome({
    degradation: degraded,
    degradationDetail: declaredDetail,
    unreconciled,
  })
  return await finish(outcome, detail, 200, { results }, results)
})
