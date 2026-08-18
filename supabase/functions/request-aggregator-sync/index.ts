import { callerFrom, isOwner, serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'

/**
 * "Read now", and "Reconnect", from the owner's phone.
 *
 * A sync you cannot start is a sync you cannot try, and a session you must repair
 * from a terminal is a session that stays broken while the owner is out. Both
 * were non-goals in the proposal and neither survived contact with using the
 * thing.
 *
 * What this function is careful about:
 *
 *  1. **No GitHub credential reaches the browser.** The token that dispatches the
 *     reader's workflow is a server-side secret held here. Had the app held it,
 *     every phone with the app installed would carry the ability to run arbitrary
 *     workflows in a private repository.
 *
 *  2. **Authority is re-derived from the caller's own token**, never from the
 *     body. This function holds the service role, so RLS is not watching: being
 *     an Edge Function is not authorisation (docs/ROLES_AND_PERMISSIONS.md).
 *
 *  3. **A repeatedly tapped button cannot start six readers.** A dispatch is
 *     refused while a run for that outlet is still open, and refused again if one
 *     was started moments ago. Both matter for a different reason: overlapping
 *     readers would race each other for one Zomato session, and the sliding idle
 *     window means the loser can invalidate the winner.
 *
 *  4. **A reconnect and a sync are the same dispatch with a different input.**
 *     One door, so there is one place where the rate limit lives.
 *
 * Registered with verify_jwt = true in supabase/config.toml: the caller is a
 * person holding a session, and the gateway should refuse an anonymous request
 * before it reaches any of this.
 */

/**
 * How recently is too recently.
 *
 * Not a guess: a browser-free read of two cycles takes well under a minute, and
 * a login run takes about five. Ninety seconds refuses the double tap and the
 * impatient retry while still letting somebody who genuinely needs a second run
 * have one without waiting for a schedule.
 */
const COOLDOWN_SECONDS = 90

type Mode = 'sync' | 'reconnect'

/** Zomato's own code lifetime. Theirs to change, so it is stated once, here. */
const OTP_LIFETIME_MINUTES = 5

interface DispatchTarget {
  owner: string
  repo: string
  workflow: string
  ref: string
}

function dispatchTarget(): DispatchTarget | null {
  const repository = Deno.env.get('AGGREGATOR_SYNC_REPOSITORY')
  const workflow = Deno.env.get('AGGREGATOR_SYNC_WORKFLOW') ?? 'sync.yml'
  const ref = Deno.env.get('AGGREGATOR_SYNC_REF') ?? 'main'
  if (!repository || !repository.includes('/')) return null
  const [owner, repo] = repository.split('/', 2)
  if (!owner || !repo) return null
  return { owner, repo, workflow, ref }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN')
  const target = dispatchTarget()
  if (!token || !target) {
    // Distinguished from a refusal on purpose. "Not configured" is a message for
    // whoever deploys this; "not permitted" is a message about the caller, and
    // conflating them would send the owner looking for the wrong problem.
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

  if (!outletId) return json({ error: 'outlet_required' }, 400)
  if (channel !== 'zomato') return json({ error: 'unknown_channel' }, 400)

  // The outlet has to be one the sync is actually configured for. An owner
  // reaches every outlet, so this is not an authority check: it stops a dispatch
  // for an outlet the reader has no restaurant id for, which would burn a runner
  // to discover something this function already knows.
  const { data: configured, error: configuredError } = await service
    .from('outlet_channel_sync')
    .select('outlet_id')
    .eq('outlet_id', outletId)
    .eq('channel', channel)
    .maybeSingle()

  if (configuredError) {
    console.error('could not read the channel configuration', configuredError)
    return json({ error: 'backend_failure' }, 503)
  }
  if (!configured) return json({ error: 'channel_not_configured' }, 409)

  // Nothing may be started while something is running. `finished_at is null` is
  // the open-run marker; a run that died without recording itself would hold the
  // door shut, so runs older than the cooldown are not counted as open.
  const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString()
  const { data: recent, error: recentError } = await service
    .from('aggregator_sync_runs')
    .select('id, started_at, finished_at')
    .eq('outlet_id', outletId)
    .eq('channel', channel)
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
   * A reconnect opens the mailbox before the runner starts.
   *
   * Opened here rather than by the runner so that the moment the owner taps
   * Reconnect, the surface has something to show. If the runner opened it, the
   * screen would sit on "starting" for the ninety seconds it takes a runner to
   * boot, with no way to tell a slow start from a failed one.
   *
   * The unique index on one-open-per-channel is the arbiter, not this read: two
   * taps arriving together both see no open request, and the second insert is
   * refused by the database rather than by a check that raced.
   */
  if (mode === 'reconnect') {
    const { error: openError } = await service.from('aggregator_auth_requests').insert({
      channel,
      requested_from_outlet_id: outletId,
      requested_by: resolution.caller.id,
      expires_at: new Date(Date.now() + OTP_LIFETIME_MINUTES * 60_000).toISOString(),
    })

    if (openError) {
      // 23505 is the one-open-per-channel index. A reconnect already under way is
      // not an error the owner needs to read as one: the screen they are looking
      // at is already the right screen.
      if ((openError as { code?: string }).code === '23505') {
        return json({ outcome: 'already_awaiting_code' }, 200)
      }
      console.error('could not open the auth request', openError)
      return json({ error: 'backend_failure' }, 503)
    }
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
        inputs: {
          channel,
          outlet_id: outletId,
          mode,
          // GitHub workflow inputs are strings. Sent as the words the workflow
          // compares against rather than as booleans, so a `false` cannot arrive
          // as the string "false" and read as truthy on the other side.
          rehearse: rehearse ? 'true' : 'false',
        },
      }),
    },
  )

  if (!dispatch.ok) {
    const detail = await dispatch.text()
    // Never the token, and never the whole response, which echoes request
    // headers on some GitHub errors.
    console.error('the reader dispatch was refused', dispatch.status, detail.slice(0, 300))

    if (mode === 'reconnect') {
      // The mailbox was opened for a runner that will never arrive. Left open it
      // would hold the channel shut against the next attempt and leave the
      // surface waiting for a code nobody will send.
      const { error: closeError } = await service
        .from('aggregator_auth_requests')
        .update({ closed_at: new Date().toISOString(), outcome: 'abandoned' })
        .eq('channel', channel)
        .is('closed_at', null)
      if (closeError) console.error('could not close the orphaned auth request', closeError)
    }

    return json({ error: 'dispatch_failed' }, 502)
  }

  // 204 with no body is what a successful dispatch returns, so there is no run id
  // to hand back. The surface follows the run rather than the request for exactly
  // this reason: what it wants to know next is what the reader did, and that
  // arrives in `aggregator_sync_runs`.
  return json({ outcome: 'dispatched', mode, rehearsal: rehearse }, 202)
})
