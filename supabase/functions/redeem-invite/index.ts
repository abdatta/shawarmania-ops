import { serviceClient } from '../_shared/authority.ts'
import { json, noContent, preflight, readJson, str } from '../_shared/http.ts'
import {
  clientIpHash,
  hashCode,
  MIN_PASSWORD_LENGTH,
  normaliseCode,
} from '../_shared/invite-code.ts'

/**
 * First run and password reset: exchange a one-time code for a password.
 *
 * The only endpoint in the app that takes no session at all — the whole point
 * is that the person does not have one yet — which makes it the most exposed
 * surface here. Four things keep it honest:
 *
 *  1. It decides nothing. `preview_account_invite` and `redeem_account_invite`
 *     do the checking, the rate limiting and the consuming, each in one
 *     transaction (see the migrations), so there is no check-then-act window to
 *     race in this file.
 *  2. Every code failure looks identical. Unknown, wrong, expired, already
 *     used, superseded, deactivated account — one status, one body. Anything
 *     else would make this an account-enumeration oracle.
 *  3. It returns no session. The client signs in afterwards with the password
 *     it just set, so there stays exactly one way a session is minted.
 *  4. The code is the key. Nothing here takes an email address, which is why
 *     `preview` can safely hand one back: whoever asks has already proven
 *     possession of a live, single-use code for that one account, so the only
 *     address they can learn is the one they already hold a code for.
 *
 * Two refusals are allowed to be specific, because each describes the request
 * rather than any account: a password below the minimum, and a caller that has
 * exceeded the endpoint's rate limit.
 *
 * Registered with verify_jwt = false in supabase/config.toml; a caller with no
 * password also has no token.
 */

/** The two refusals that say nothing about any account. */
const WEAK_PASSWORD = { error: 'weak_password', minLength: MIN_PASSWORD_LENGTH }
const RATE_LIMITED = { error: 'rate_limited' }

/** Everything else. Deliberately indistinguishable. */
const INVALID = { error: 'invalid_code' }

type Action = 'preview' | 'redeem'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  if (!body) return json(INVALID, 400)

  const action = body['action'] === 'preview' ? 'preview' : ('redeem' as Action)
  const rawCode = str(body['code'])
  const password = typeof body['password'] === 'string' ? body['password'] : ''

  // Checked before anything is looked up, so a fumbled password never reaches
  // the rate limiter, never costs the caller a failure, and never consumes the
  // code.
  if (action === 'redeem' && password.length < MIN_PASSWORD_LENGTH) {
    return json(WEAK_PASSWORD, 400)
  }
  if (!rawCode) return json(INVALID, 400)

  const service = serviceClient()
  const codeHash = await hashCode(normaliseCode(rawCode))
  const ipHash = await clientIpHash(req)

  if (action === 'preview') {
    const { data, error } = await service.rpc('preview_account_invite', {
      p_code_hash: codeHash,
      p_ip_hash: ipHash,
    })
    const row = (Array.isArray(data) ? data[0] : data) as
      { status?: string; email?: string | null } | undefined

    if (error) return json(INVALID, 400)
    if (row?.status === 'rate_limited') return json(RATE_LIMITED, 429)
    if (row?.status !== 'ok' || !row.email) return json(INVALID, 400)

    return json({ email: row.email })
  }

  const { data, error } = await service.rpc('redeem_account_invite', {
    p_code_hash: codeHash,
    p_ip_hash: ipHash,
  })
  const row = (Array.isArray(data) ? data[0] : data) as
    { status?: string; user_id?: string | null } | undefined

  if (error) return json(INVALID, 400)
  if (row?.status === 'rate_limited') return json(RATE_LIMITED, 429)
  if (row?.status !== 'ok' || !row.user_id) return json(INVALID, 400)

  const { error: passwordError } = await service.auth.admin.updateUserById(row.user_id, {
    password,
  })
  if (passwordError) {
    // The code is spent by now. Say so plainly rather than pretending the code
    // was bad: the person did nothing wrong and an admin must re-issue.
    console.error('password update failed after consuming an invite', passwordError)
    return json({ error: 'activation_failed' }, 500)
  }

  return noContent()
})
