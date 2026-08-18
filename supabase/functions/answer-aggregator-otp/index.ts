import { callerFrom, isOwner, serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'

/**
 * The code off the owner's phone, on its way to a browser in a datacentre.
 *
 * Zomato sends the one-time password to the phone the merchant account is
 * registered to. The thing that needs it is headed Chromium on a GitHub runner.
 * This function is the whole of the channel between them, and it is deliberately
 * the shortest one in this repo.
 *
 * What it will not do:
 *
 *  1. **Log it, echo it, or put it in a URL.** Not on success, not on failure,
 *     not in an error message. There is no code path here that writes the code
 *     anywhere except the column the runner reads it from.
 *
 *  2. **Tell the caller anything a guesser could use.** A code for a request that
 *     expired, was already answered, was already collected, or never existed all
 *     answer identically. The owner is the only caller who can reach this at all,
 *     so the uniform refusal is not protecting the code from them — it is
 *     protecting against a stolen session being used to probe the state of a
 *     login in progress.
 *
 *  3. **Spend an attempt on a malformed code.** Attempts belong to Zomato's own
 *     rejection of a real code, not to a fat-fingered field. Counting them here
 *     would let three typos close a request the owner is standing in front of.
 *
 * Registered with verify_jwt = true in supabase/config.toml.
 */

/**
 * Zomato's codes are six digits. Checked so an obviously wrong shape never
 * becomes a row the runner will submit and have rejected, which costs an attempt
 * and a minute of the code's life.
 */
const CODE_SHAPE = /^\d{4,8}$/

const REFUSED = { error: 'no_open_request' }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

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

  const channel = str(body['channel']) ?? 'zomato'
  const code = str(body['code'])

  if (channel !== 'zomato') return json({ error: 'unknown_channel' }, 400)
  if (!code || !CODE_SHAPE.test(code)) return json({ error: 'malformed_code' }, 400)

  /*
   * One statement, and the filter is the whole check.
   *
   * Reading the request first and then updating it would leave a window in which
   * the runner collects a code between the two, and this would overwrite a
   * consumed request's row. Every condition that makes a request answerable is a
   * predicate here instead: still open, not yet expired, nothing already waiting
   * in the column, and nothing already collected.
   *
   * `answered_at` is set in the same statement, so a code can never sit in the
   * column without a timestamp saying when it arrived.
   */
  const { data, error } = await service
    .from('aggregator_auth_requests')
    .update({ code, answered_at: new Date().toISOString() })
    .eq('channel', channel)
    .is('closed_at', null)
    .is('code', null)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')

  if (error) {
    // Deliberately not `error.message`: a constraint violation on this table can
    // quote the offending row, and the offending row is the code.
    console.error('could not store the one time password', {
      code: (error as { code?: string }).code,
    })
    return json({ error: 'backend_failure' }, 503)
  }

  // No row matched. Which of the four reasons it was is not said, and is not
  // logged either, because the useful version of that sentence is on the surface
  // already: it knows whether it is waiting for a code.
  if (!data || data.length === 0) return json(REFUSED, 409)

  return json({ outcome: 'accepted' }, 200)
})
