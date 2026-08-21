import { callerFrom, isOwner, serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import { probeChannel } from '../_shared/aggregator-probe.ts'
import { decideRung } from '../_shared/reconnect-ladder.ts'

/**
 * "Read now", and "Reconnect", from the owner's phone.
 *
 * A sync you cannot start is a sync you cannot try, and a session you must repair
 * from a terminal is a session that stays broken while the owner is out.
 *
 * **A reconnect is a repair ladder, not a login redo** (change #44). It probes
 * both channels' stored sessions with one real authenticated call each, then takes
 * the cheapest rung that repairs what is actually broken:
 *
 *   - Both alive           -> answer still-signed-in; nothing dispatched.
 *   - Zomato warm, HP cold -> dispatch capture-hyperpure.yml, which re-mints the
 *                            child from the stored parent. No code request opens.
 *   - Zomato cold          -> dispatch login.yml, whose runner opens the mailbox
 *                            itself when the login actually asks for a code.
 *   - Could not tell       -> refuse rather than guess: an unknown must not spend
 *                            the owner's code on a network hiccup.
 *
 * What this function is careful about:
 *
 *  1. **No GitHub credential reaches the browser.**
 *  2. **Authority is re-derived from the caller's own token**, never the body.
 *  3. **A repeatedly tapped button cannot start six readers**: a dispatch is
 *     refused while a run for that outlet is open or moments old.
 *  4. **One door, so one rate limit.**
 */

/**
 * How recently is too recently. Ninety seconds refuses the double tap and the
 * impatient retry while still letting a genuine second attempt through without
 * waiting for a schedule.
 */
const COOLDOWN_SECONDS = 90

type Mode = 'sync' | 'reconnect'

interface DispatchTarget {
  owner: string
  repo: string
  workflow: string
  ref: string
}

function repositoryParts(): [string, string] | null {
  const repository = Deno.env.get('AGGREGATOR_SYNC_REPOSITORY')
  if (!repository || !repository.includes('/')) return null
  const [owner, repo] = repository.split('/', 2)
  if (!owner || !repo) return null
  return [owner, repo]
}

function targetFor(workflowEnvName: string, fallbackWorkflow: string): DispatchTarget | null {
  const parts = repositoryParts()
  if (!parts) return null
  const ref = Deno.env.get('AGGREGATOR_SYNC_REF') ?? 'main'
  const workflow = Deno.env.get(workflowEnvName) ?? fallbackWorkflow
  return { owner: parts[0], repo: parts[1], workflow, ref }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN')
  if (!token) {
    console.error('the reader dispatch is not configured; refusing every caller')
    return json({ error: 'not_configured' }, 503)
  }

  const service = serviceClient()
  const resolution = await callerFrom(req, service)
  if (resolution.kind === 'backend_failure') {
    console.error('could not resolve the caller', resolution.error)
    return json({ error: 'backend_failure' }, 503)
  }
  if (resolution.kind === 'session_invalid') return json({ error: 'unauthorized' }, 401)
  if (!isOwner(resolution.caller)) return json({ error: 'forbidden' }, 403)

  const body = await readJson(req)
  if (!body) return json({ error: 'malformed_body' }, 400)

  const outletId = str(body['outlet_id'])
  const channel = str(body['channel']) ?? 'zomato'
  const mode: Mode = body['mode'] === 'reconnect' ? 'reconnect' : 'sync'
  const rehearse = body['rehearse'] === true

  // The configured-outlet guard applies where it ever made sense: a zomato sync
  // needs the outlet's restaurant id, which is exactly what the configuration row
  // carries. Hyperpure is account-level with no configuration row by design; its
  // repair does not depend on which outlet's screen the tap came from.
  if (channel !== 'hyperpure') {
    const { data: configured, error: configuredError } = await service
      .from('outlet_channel_sync')
      .select('outlet_id')
      .eq('outlet_id', outletId)
      .eq('channel', 'zomato')
      .maybeSingle()

    if (configuredError) {
      console.error('could not read the channel configuration check', configuredError)
      return json({ error: 'backend_failure' }, 503)
    }
    if (!outletId || !configured) return json({ error: 'channel_not_configured' }, 409)
  }

  // Nothing may be started while something is running. A dead run that never
  // closed itself would hold the door shut forever, so runs older than the
  // cooldown are not counted as open.
  const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString()
  const runChannel = channel === 'hyperpure' && mode === 'sync' ? 'zomato' : channel
  const { data: recent, error: recentError } = await service
    .from('aggregator_sync_runs')
    .select('id, started_at, finished_at')
    .eq('outlet_id', outletId)
    .eq('channel', runChannel)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1)

  if (recentError) {
    console.error('could not read recent runs', recentError)
    return json({ error: 'backend_failure' }, 503)
  }
  if (recent && recent.length > 0) {
    return json({ error: 'already_running', retry_after_seconds: COOLDOWN_SECONDS }, 429)
  }

  /*
   * Probe both channels, then take the ladder's rung. Probes run together; one
   * that cannot tell answers alive-null and decideRung refuses rather than guess.
   */
  let rung: 'still_signed_in' | 'capture_only' | 'full_login' | 'probe_failed'
  if (mode === 'sync') {
    rung = 'full_login'
  } else {
    const [parentProbe, childProbe] = await Promise.all([
      probeChannel('zomato'),
      probeChannel('hyperpure'),
    ])
    rung = decideRung(parentProbe, childProbe)
  }

  if (rung === 'probe_failed') return json({ error: 'probe_failed' }, 503)

  // Choose the workflow by WHAT THE RUNG IS, never by trusting the caller's mode
  // string alone: choosing it by mode was exactly the bug that once ran the
  // figures-reader on a reconnect and never asked for a code.
  let target: DispatchTarget | null = null
  if (mode === 'sync') {
    target = targetFor('AGGREGATOR_SYNC_WORKFLOW', 'sync.yml')
  } else if (rung === 'capture_only') {
    target = targetFor('AGGREGATOR_CAPTURE_WORKFLOW', 'capture-hyperpure.yml')
  } else if (rung === 'full_login') {
    target = targetFor('AGGREGATOR_RECONNECT_WORKFLOW', 'login.yml')
  } else if (rung === 'still_signed_in') {
    // Nothing to repair. Say so and stop: no runner boots, no request opens,
    // and the surface tells the owner they are already signed in.
    return json({ outcome: 'still_signed_in', mode, rehearsal: rehearse }, 200)
  }

  if (!target) {
    console.error('the reader dispatch is not configured; refusing every caller')
    return json({ error: 'not_configured' }, 503)
  }

  const dispatch = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repo}/actions/workflows/${target.workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'shawarmania-ops',
      },
      body: JSON.stringify({
        ref: target.ref,
        inputs: { channel, outlet_id: outletId, mode, rehearse: rehearse ? 'true' : 'false' },
      }),
    },
  )

  if (!dispatch.ok) {
    const detail = await dispatch.text()
    console.error('the reader dispatch was refused', dispatch.status, detail.slice(0, 300))
    return json({ error: 'dispatch_failed' }, 502)
  }

  // 204 with no body is what a successful dispatch returns, so there is no run id
  // to hand back. The surface follows the run rather than the request.
  return json(
    { outcome: 'dispatched', mode: mode === 'sync' ? 'sync' : 'reconnect', rehearsal: rehearse },
    202,
  )
})
