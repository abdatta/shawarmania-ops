import { serviceClient } from '../_shared/authority.ts'
import { json, noContent, preflight, readJson, str } from '../_shared/http.ts'
import { hashCode, MIN_PASSWORD_LENGTH, normaliseCode } from '../_shared/invite-code.ts'

/**
 * First run and password reset: exchange a one-time code for a password.
 *
 * The only endpoint in the app that takes no session at all — the whole point
 * is that the person does not have one yet — which makes it the most exposed
 * surface here. Three things keep it honest:
 *
 *  1. It decides nothing. `redeem_account_invite` does the checking and the
 *     consuming in one transaction (see the migration), so there is no
 *     check-then-act window to race in this file.
 *  2. Every failure looks identical. Unknown address, wrong code, expired,
 *     already used, attempts exhausted, deactivated account — one status, one
 *     body. Anything else would make this an account-enumeration oracle.
 *  3. It returns no session. The client signs in afterwards with the password
 *     it just set, so there stays exactly one way a session is minted.
 *
 * Registered with verify_jwt = false in supabase/config.toml; a caller with no
 * password also has no token.
 */

/** The one refusal that is allowed to be specific: it says nothing about any account. */
const WEAK_PASSWORD = { error: 'weak_password', minLength: MIN_PASSWORD_LENGTH }

/** Everything else. Deliberately indistinguishable. */
const INVALID = { error: 'invalid_code' }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  if (!body) return json(INVALID, 400)

  const email = str(body['email'])
  const rawCode = str(body['code'])
  const password = typeof body['password'] === 'string' ? body['password'] : ''

  // Checked before anything is looked up, so a fumbled password never costs an
  // attempt and never consumes the code.
  if (password.length < MIN_PASSWORD_LENGTH) return json(WEAK_PASSWORD, 400)
  if (!email || !rawCode) return json(INVALID, 400)

  const service = serviceClient()
  const { data, error } = await service.rpc('redeem_account_invite', {
    p_email: email,
    p_code_hash: await hashCode(normaliseCode(rawCode)),
  })

  const row = (Array.isArray(data) ? data[0] : data) as
    { status?: string; user_id?: string | null } | undefined
  if (error || row?.status !== 'ok' || !row.user_id) return json(INVALID, 400)

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
