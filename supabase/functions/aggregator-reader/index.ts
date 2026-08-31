import { serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import { probeChannel } from '../_shared/aggregator-probe.ts'
import { parseHyperpureRunRecord } from '../_shared/hyperpure-run-record.ts'

/**
 * The reader's own door: its session, and the code it is waiting for.
 *
 * The reader is a scheduled job in a private repository, holding one shared
 * secret. It is not a person and has no session, so this function is authorised
 * the same way `ingest-aggregator-cycle` is — by a constant-time comparison
 * against a secret the runtime holds.
 *
 * **Why the reader does not talk to Postgres directly.** It could hold the
 * service-role key and call the Vault functions itself. That key opens staff
 * records, attendance, billing and every customer the shop has. Scoped to this
 * endpoint instead, a leaked GitHub secret buys an attacker the Zomato session —
 * bad, and bounded, and revocable by one owner tap. The blast radius is the whole
 * argument.
 *
 * **Why the session lives here at all rather than in a GitHub artifact.** An
 * artifact cannot be updated in place, expires, and is invisible to the app: the
 * sync surface could never say how long a session had left. Vault can be read by
 * the reader and described to the owner without ever being shown to them.
 *
 * Registered with verify_jwt = false in supabase/config.toml: the caller holds
 * its own secret, not a person's session.
 */

type Action =
  | 'load_session'
  | 'save_session'
  | 'forget_session'
  | 'record_hyperpure_run'
  | 'open_code_request'
  | 'await_code'
  | 'reject_code'
  | 'finish_login'
  | 'probe'

const ACTIONS: readonly Action[] = [
  'load_session',
  'save_session',
  'forget_session',
  'record_hyperpure_run',
  'open_code_request',
  'await_code',
  'reject_code',
  'finish_login',
  'probe',
]

/**
 * The channels whose session this door may hold. Hyperpure rides the same Zomato
 * partner login (one sign-in auto-authorises both), so its session is captured in
 * the same pass and stored under its own channel — but it has no one-time-password
 * of its own, so the `await_code` / `reject_code` / `finish_login` actions are only
 * ever exercised by Zomato. Widening the guard here does not invent an OTP flow for
 * Hyperpure; it only lets its session be saved, read and forgotten.
 */
const KNOWN_CHANNELS: readonly string[] = ['zomato', 'hyperpure', 'swiggy']

/** Zomato rejects a wrong code and offers the field again. Three is enough. */
const MAX_ATTEMPTS = 3

/** Zomato's own code lifetime. Theirs to change, so it is stated once, here. */
const OTP_LIFETIME_MINUTES = 5

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
    .filter(Boolean)
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

  const action = str(body['action']) as Action | undefined
  const channel = str(body['channel']) ?? 'zomato'

  if (!action || !ACTIONS.includes(action)) return json({ error: 'unknown_action' }, 400)
  if (!KNOWN_CHANNELS.includes(channel)) return json({ error: 'unknown_channel' }, 400)

  const service = serviceClient()
  const now = new Date()

  switch (action) {
    /*
     * Everything the reader needs to sign in, in one round trip: the session if
     * there is a live one, and the identifier if there is not.
     *
     * The response is the only place in this system where both leave the
     * database. It is sent to a runner over TLS, is never logged by the caller,
     * and the workflow that receives it does not print it — GitHub's log masking
     * only redacts registered secrets, and a session minted at runtime is not
     * one.
     */
    case 'load_session': {
      const [session, identifier, credential] = await Promise.all([
        service.rpc('read_aggregator_session', { p_channel: channel }),
        service.rpc('read_aggregator_login_identifier', { p_channel: channel }),
        service
          .from('aggregator_channel_credentials')
          .select('session_expires_at')
          .eq('channel', channel)
          .maybeSingle(),
      ])

      if (session.error || identifier.error || credential.error) {
        console.error('could not load the credential', {
          session: session.error?.code,
          identifier: identifier.error?.code,
          credential: credential.error?.code,
        })
        return json({ error: 'backend_failure' }, 503)
      }

      const expiresAt = credential.data?.session_expires_at ?? null
      // Expiry is reported rather than enforced. Zomato decides whether a session
      // is dead, and a token this function called stale might still work; a
      // reader that refused to try would turn a working session into an OTP the
      // owner has to walk over and read.
      return json({
        session: session.data ?? null,
        identifier: identifier.data ?? null,
        session_expires_at: expiresAt,
        expired: expiresAt === null ? null : new Date(expiresAt) <= now,
      })
    }

    case 'save_session': {
      const session = str(body['session'])
      const expiresAt = str(body['expires_at'])
      if (!session) return json({ error: 'session_required' }, 400)
      if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
        // Refused rather than defaulted. A session stored with an invented expiry
        // would have the surface counting down to the wrong moment, and the whole
        // reason the expiry is stored is that the sliding window makes it the one
        // number worth showing.
        return json({ error: 'expires_at_required' }, 400)
      }

      const { error } = await service.rpc('save_aggregator_session', {
        p_channel: channel,
        p_session: session,
        p_expires_at: expiresAt,
      })
      if (error) {
        console.error('could not save the session', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: 'saved' })
    }

    case 'forget_session': {
      const { error } = await service.rpc('forget_aggregator_session', { p_channel: channel })
      if (error) {
        console.error('could not forget the session', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: 'forgotten' })
    }

    /*
     * Hyperpure has health rows and credentials but no payout cycles. Keep its
     * run record on this smaller credential bridge rather than widening
     * `ingest-aggregator-cycle`: a supply statement must never look like
     * restaurant revenue merely because both need a health line.
     */
    case 'record_hyperpure_run': {
      if (channel !== 'hyperpure') return json({ error: 'run_channel_not_supported' }, 400)
      const parsed = parseHyperpureRunRecord(body, permittedOutlets())
      if ('error' in parsed) return json({ error: parsed.error }, 400)

      const { error } = await service.rpc('record_aggregator_sync_run', {
        p_outlet_id: parsed.value.outletId,
        p_channel: 'hyperpure',
        p_started_at: parsed.value.startedAt,
        p_outcome: parsed.value.outcome,
        p_detail: parsed.value.detail,
        p_rehearsal: false,
        p_started_by: parsed.value.startedBy ?? undefined,
        p_summary: parsed.value.summary,
      })
      if (error) {
        console.error('could not record the Hyperpure run', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: 'recorded' })
    }

    /*
     * Collect the code, once.
     *
     * The update is the read: filtering on `code not null` and `consumed_at null`
     * and returning the row in one statement means two runners cannot both
     * collect the same code, and the code column is emptied in the same statement
     * that hands it over. A read-then-update would leave the code sitting in the
     * column for as long as the second statement took to arrive.
     */
    case 'await_code': {
      // Through an RPC and not an update-with-select, because `RETURNING` yields
      // the NEW row and this statement's purpose is to null the code out: the
      // obvious version hands back null every time. `claim_aggregator_code` reads
      // the code in a CTE first and returns that copy.
      const { data, error } = await service.rpc('claim_aggregator_code', { p_channel: channel })

      if (error) {
        console.error('could not collect the code', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }

      const claimed = (data as { request_id: string; code: string }[] | null) ?? []
      if (claimed.length > 0) {
        return json({
          outcome: 'collected',
          request_id: claimed[0].request_id,
          code: claimed[0].code,
        })
      }

      /*
       * Nothing to collect, which is four different situations. They are told
       * apart because only one of them is worth waiting through, and waiting is
       * the expensive thing here: an idle runner bills the same as a busy one, so
       * a reader that polls `waiting` for five minutes over a code it already
       * used spends five minutes of the monthly allowance on nothing.
       */
      const { data: open, error: openError } = await service
        .from('aggregator_auth_requests')
        .select('id, expires_at, attempts, consumed_at')
        .eq('channel', channel)
        .is('closed_at', null)
        .maybeSingle()

      if (openError) {
        console.error('could not read the open request', { code: openError.code })
        return json({ error: 'backend_failure' }, 503)
      }
      if (!open) return json({ outcome: 'no_request' })
      if (new Date(open.expires_at as string) <= now) return json({ outcome: 'expired' })
      // Already handed over. The caller is holding it, or dropped it, and either
      // way another one arrives only after `reject_code` asks for it.
      if (open.consumed_at !== null) return json({ outcome: 'already_collected' })
      return json({ outcome: 'waiting', attempts: open.attempts })
    }

    /*
     * Zomato said no.
     *
     * The request stays open with the code cleared and one more attempt spent, so
     * the owner can type another without the surface having to open a new
     * request. At the cap it closes, because a login screen that keeps asking is
     * indistinguishable from one that will never accept.
     */
    case 'reject_code': {
      const { data: open, error: openError } = await service
        .from('aggregator_auth_requests')
        .select('id, attempts')
        .eq('channel', channel)
        .is('closed_at', null)
        .maybeSingle()

      if (openError) {
        console.error('could not read the open request', { code: openError.code })
        return json({ error: 'backend_failure' }, 503)
      }
      if (!open) return json({ outcome: 'no_request' })

      const attempts = (open.attempts as number) + 1
      const exhausted = attempts >= MAX_ATTEMPTS

      const { error } = await service
        .from('aggregator_auth_requests')
        .update(
          exhausted
            ? { attempts, closed_at: now.toISOString(), outcome: 'refused' }
            : { attempts, code: null, answered_at: null, consumed_at: null },
        )
        .eq('id', open.id)

      if (error) {
        console.error('could not record the rejection', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: exhausted ? 'exhausted' : 'retry', attempts })
    }

    case 'finish_login': {
      const outcome = str(body['outcome'])
      if (outcome !== 'signed_in' && outcome !== 'expired' && outcome !== 'abandoned') {
        return json({ error: 'unknown_outcome' }, 400)
      }

      const { error } = await service
        .from('aggregator_auth_requests')
        .update({ closed_at: now.toISOString(), outcome })
        .eq('channel', channel)
        .is('closed_at', null)

      if (error) {
        console.error('could not close the request', { code: error.code })
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: 'closed' })
    }

    /*
     * Open the mailbox — called by the login runner at the moment the OTP screen
     * actually renders, never at dispatch time.
     *
     * This used to happen eagerly in `request-aggregator-sync`, which is why the
     * owner was once shown a code box for a code that never came: the request
     * opened before anyone knew whether the login would ask for a code at all.
     * Only the login flow knows that, so only the login flow opens it. The sweep
     * of expired requests moves here with it, so a request left open past its
     * code's life still cannot deadlock the channel against future reconnects.
     */
    case 'open_code_request': {
      if (channel !== 'zomato' && channel !== 'swiggy') {
        // Hyperpure rides the Zomato login and has no one-time password of its
        // own; there is no mailbox to open for it.
        return json({ error: 'no_code_channel' }, 400)
      }

      const outletId = str(body['outlet_id'])

      const { error: sweepError } = await service
        .from('aggregator_auth_requests')
        .update({ closed_at: now.toISOString(), outcome: 'expired' })
        .eq('channel', channel)
        .is('closed_at', null)
        .lt('expires_at', now.toISOString())
      if (sweepError) {
        console.error('could not clear an expired auth request', sweepError)
        return json({ error: 'backend_failure' }, 503)
      }

      const expiresAt = new Date(now.getTime() + OTP_LIFETIME_MINUTES * 60_000).toISOString()
      const { error } = await service.from('aggregator_auth_requests').insert({
        channel,
        requested_from_outlet_id: outletId || null,
        requested_by: null,
        expires_at: expiresAt,
      })

      if (error) {
        // 23505 is the one-open-per-channel index. A request already under way is
        // not an error: its mailbox is still the right one for this attempt.
        if ((error as { code?: string }).code === '23505') {
          return json({ outcome: 'already_awaiting' })
        }
        console.error('could not open the auth request', error)
        return json({ error: 'backend_failure' }, 503)
      }
      return json({ outcome: 'opened' })
    }

    /*
     * One authenticated call per channel: is the stored session actually alive?
     *
     * Answered by a real call rather than a stored expiry claim, because the
     * claim cannot answer for Hyperpure (its token carries no sliding-expiry
     * claim) and Zomato's own has been observed stale while the session worked.
     * The ladder refuses on "could not tell" instead of guessing.
     */
    case 'probe': {
      return json({ probe: await probeChannel(channel) })
    }
  }
})
