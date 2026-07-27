import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  APP_ROLES,
  callerFrom,
  loadAccount,
  mayManage,
  mayProvision,
  serviceClient,
  type AppRole,
  type Caller,
} from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import { generateCode, hashCode, INVITE_VALID_FOR, normaliseCode } from '../_shared/invite-code.ts'

/**
 * The admin half of account management: create an account, re-issue its code,
 * turn it off and on again. Every action requires a real admin session, and
 * the authority for each is derived from that session rather than from the
 * request (see _shared/authority.ts).
 *
 * The unauthenticated half — redeeming a code — is a separate function on
 * purpose. Its threat model is the opposite of this one's, and sharing a body
 * parser with it would be sharing a mistake surface.
 */

async function issueCodeFor(
  service: SupabaseClient,
  profileId: string,
  issuedBy: string,
): Promise<{ code: string; expiresAt: string } | null> {
  const code = generateCode()
  const { data: inviteId, error } = await service.rpc('issue_account_invite', {
    p_profile_id: profileId,
    p_issued_by: issuedBy,
    p_code_hash: await hashCode(normaliseCode(code)),
    p_valid_for: INVITE_VALID_FOR,
  })
  if (error || !inviteId) return null

  // Read the expiry back rather than recomputing it here: the database's clock
  // is the one that decides, and a display that disagrees with enforcement is
  // a support call waiting to happen.
  const { data: invite } = await service
    .from('account_invites')
    .select('expires_at')
    .eq('id', inviteId as string)
    .maybeSingle()

  return { code, expiresAt: (invite?.expires_at as string | undefined) ?? '' }
}

async function provision(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const fullName = str(body['fullName'])
  const email = str(body['email'])?.toLowerCase()
  const phone = str(body['phone']) ?? null
  const role = str(body['role']) as AppRole | undefined
  // Taken exactly as sent, never coerced to fit the role. A request naming a
  // Super Admin *and* an outlet is contradictory, and quietly dropping half of
  // it would create an account the caller did not ask for. mayProvision judges
  // the shape; this endpoint does not guess.
  const outletId = str(body['outletId']) ?? null

  if (!fullName || !email || !role || !APP_ROLES.includes(role)) {
    return json({ error: 'invalid_request' }, 400)
  }
  if (!mayProvision(caller, role, outletId)) return json({ error: 'forbidden' }, 403)

  // A password nobody has ever seen: the account is unusable until the code is
  // redeemed, without depending on how the auth service treats a null one.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
  })
  if (createError || !created.user) return json({ error: 'email_unavailable' }, 409)

  const { error: profileError } = await service.from('profiles').insert({
    id: created.user.id,
    full_name: fullName,
    phone,
    role,
    outlet_id: outletId,
    is_active: true,
  })
  if (profileError) {
    // Never leave an auth user with no profile behind: it would be invisible to
    // every admin surface and would still hold the email address.
    await service.auth.admin.deleteUser(created.user.id)
    return json({ error: 'profile_rejected' }, 400)
  }

  const issued = await issueCodeFor(service, created.user.id, caller.id)
  if (!issued) {
    await service.auth.admin.deleteUser(created.user.id)
    return json({ error: 'invite_failed' }, 500)
  }

  return json({ profileId: created.user.id, ...issued }, 201)
}

async function reissue(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  if (!profileId) return json({ error: 'invalid_request' }, 400)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target)) return json({ error: 'forbidden' }, 403)

  const issued = await issueCodeFor(service, target.id, caller.id)
  if (!issued) return json({ error: 'invite_failed' }, 500)

  return json({ profileId: target.id, ...issued }, 200)
}

async function setActive(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const isActive = body['isActive']
  if (!profileId || typeof isActive !== 'boolean') return json({ error: 'invalid_request' }, 400)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target)) return json({ error: 'forbidden' }, 403)

  const { error } = await service
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', target.id)
  if (error) return json({ error: 'update_failed' }, 500)

  return json({ profileId: target.id, isActive }, 200)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const service = serviceClient()
  const caller = await callerFrom(req, service)
  if (!caller) return json({ error: 'unauthorised' }, 401)

  const body = await readJson(req)
  if (!body) return json({ error: 'invalid_request' }, 400)

  switch (body['action']) {
    case 'provision':
      return await provision(service, caller, body)
    case 'reissue':
      return await reissue(service, caller, body)
    case 'set-active':
      return await setActive(service, caller, body)
    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
