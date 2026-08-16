import { serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'

/**
 * The door the Zomato reader posts settlement through.
 *
 * The reader itself lives in a separate private repository, because it holds a
 * live merchant session and this one is public. What lives here is the contract
 * it writes through, and the reasons that contract is shaped the way it is:
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
 * Registered with verify_jwt = false in supabase/config.toml: the caller is a
 * scheduled job holding its own secret, not a person holding a session.
 */

const CONTRACT_VERSION = 1

type Outcome = 'ok' | 'session_lapsed' | 'shape_changed' | 'reconciliation_failed'

const OUTCOMES: readonly Outcome[] = [
  'ok',
  'session_lapsed',
  'shape_changed',
  'reconciliation_failed',
]

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

  if (!outletId || !outlets.includes(outletId)) {
    return json({ error: 'outlet_not_permitted' }, 403)
  }

  if (declared !== undefined && !OUTCOMES.includes(declared)) {
    return json({ error: 'unknown_outcome' }, 400)
  }

  const cycles = Array.isArray(body['cycles']) ? (body['cycles'] as unknown[]) : []
  const service = serviceClient()

  const finish = async (outcome: Outcome, detail: string | null, status: number, extra = {}) => {
    const { error } = await service.rpc('record_aggregator_sync_run', {
      p_outlet_id: outletId,
      p_channel: channel,
      p_started_at: startedAt,
      p_outcome: outcome,
      p_detail: detail,
    })
    if (error) {
      // The run's own record failing is not a reason to lose the answer, but it
      // does mean the owner's surface will under-report, so it is loud.
      console.error('could not record the sync run', error)
    }
    return json({ outcome, ...extra }, status)
  }

  // A run that reached no data at all still reports itself. It writes nothing
  // for those dates and never a zero, because a zero is indistinguishable from a
  // day with no orders.
  if (declared && declared !== 'ok') {
    return await finish(declared, str(body['detail']) ?? null, 200)
  }

  const results: unknown[] = []
  let unreconciled = 0

  for (const cycle of cycles) {
    const { data, error } = await service.rpc('ingest_aggregator_cycle', {
      p_payload: cycle,
      p_permitted_outlets: outlets,
    })

    if (error) {
      console.error('a cycle was refused by the write contract', error)
      return await finish('shape_changed', error.message, 422, { results })
    }

    results.push(data)
    if ((data as { outcome?: string } | null)?.outcome === 'reconciliation_failed') {
      unreconciled += 1
    }
  }

  if (unreconciled > 0) {
    return await finish(
      'reconciliation_failed',
      `${unreconciled} cycle(s) did not reconcile against the payout Zomato states it made`,
      200,
      { results },
    )
  }

  return await finish('ok', null, 200, { results })
})
