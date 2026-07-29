import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  APP_ROLES,
  callerFrom,
  loadAccount,
  managesAnyone,
  mayAssign,
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
  // The job title is a fact about the person and lives on the account. Where
  // they work and from when is the ASSIGNMENT written below — creating a person
  // is still one act, it simply writes two rows now.
  const roleTitle = str(body['roleTitle']) ?? null
  const startedOn = str(body['joinedOn']) ?? null

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
    is_active: true,
    role_title: roleTitle,
  })
  if (profileError) {
    // Never leave an auth user with no profile behind: it would be invisible to
    // every admin surface and would still hold the email address.
    await service.auth.admin.deleteUser(created.user.id)
    return json({ error: 'profile_rejected' }, 400)
  }

  // The assignment is what places them. An account with none is a person who
  // exists and works nowhere — a real state, but never the one a create
  // produces, so a failure here rolls the whole act back.
  const { error: assignmentError } = await service.from('assignments').insert({
    person_id: created.user.id,
    role,
    outlet_id: outletId,
    ...(startedOn ? { started_on: startedOn } : {}),
  })
  if (assignmentError) {
    await service.auth.admin.deleteUser(created.user.id)
    return json({ error: 'assignment_rejected' }, 400)
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

/**
 * The addresses this caller may see — the one field on an account that RLS
 * cannot serve, because it lives in `auth.users` and no client may read that.
 *
 * Deliberately not mirrored onto `public.profiles`, which a Biller may read for
 * their own outlet: a Biller is a shared counter tablet, and a column there
 * would put every colleague's personal address on a device anyone can pick up
 * (design D12). Hence the outright refusal below rather than a filter that
 * returns nothing — a boundary, not a coincidence.
 */
async function emails(service: SupabaseClient, caller: Caller): Promise<Response> {
  if (!managesAnyone(caller)) return json({ error: 'forbidden' }, 403)

  // One page. This business will hold accounts in the dozens; a franchise
  // network large enough to exceed this needs paging here and a different
  // account surface anyway, and would rather find out from a wrong answer than
  // from a silent truncation — so the cap is asserted, not assumed.
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return json({ error: 'lookup_failed' }, 500)
  if (data.users.length >= 1000) return json({ error: 'too_many_accounts' }, 500)

  const visible: Record<string, string> = {}
  for (const user of data.users) {
    if (!user.email) continue
    // Your own address is yours to see; everyone else's goes through the same
    // matrix that governs re-issuing their code and turning them off.
    if (user.id === caller.id) {
      visible[user.id] = user.email
      continue
    }
    const target = await loadAccount(service, user.id)
    if (target && mayManage(caller, target)) visible[user.id] = user.email
  }

  return json({ emails: visible }, 200)
}

/**
 * Correct the address an account signs in with.
 *
 * The outstanding code is left alone on purpose (design D13): it is bound to
 * the profile rather than to the address, so it starts working the moment the
 * address is right. Re-issuing would cancel a message the admin has already
 * passed on and turn one mistake into two.
 */
async function setEmail(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const email = str(body['email'])?.toLowerCase()
  if (!profileId || !email) return json({ error: 'invalid_request' }, 400)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target)) return json({ error: 'forbidden' }, 403)

  // Confirmed on write, as at creation: nothing in this system ever sends a
  // confirmation mail, so an unconfirmed address is simply an account that
  // cannot sign in.
  const { error } = await service.auth.admin.updateUserById(target.id, {
    email,
    email_confirm: true,
  })
  if (error) return json({ error: 'email_unavailable' }, 409)

  return json({ profileId: target.id, email }, 200)
}

/**
 * Place a person at an outlet, or end their placement there.
 *
 * These are the two writes that make somebody a multi-outlet person, and they
 * go through the privileged path for the same reason provisioning does: the
 * authority is re-derived from the caller's own token. The database enforces
 * the identical rule underneath (`assignments_insert` and its guards), so this
 * is a legible refusal rather than the boundary.
 */
async function assign(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const personId = str(body['personId'])
  const role = str(body['role']) as AppRole | undefined
  const outletId = str(body['outletId']) ?? null
  if (!personId || !role || !APP_ROLES.includes(role)) {
    return json({ error: 'invalid_request' }, 400)
  }

  const target = await loadAccount(service, personId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayAssign(caller, personId, role, outletId)) return json({ error: 'forbidden' }, 403)

  const { data, error } = await service
    .from('assignments')
    .insert({ person_id: personId, role, outlet_id: outletId })
    .select('id')
    .maybeSingle()
  // A live assignment already exists at that outlet — the partial unique index
  // talking. Reported as a conflict rather than a failure, because the state
  // the caller wanted is the state that already holds.
  if (error) return json({ error: 'already_assigned' }, 409)

  return json({ assignmentId: data?.id ?? null }, 201)
}

async function endAssignment(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const assignmentId = str(body['assignmentId'])
  if (!assignmentId) return json({ error: 'invalid_request' }, 400)

  const { data: existing } = await service
    .from('assignments')
    .select('id, person_id, role, outlet_id, ended_on')
    .eq('id', assignmentId)
    .maybeSingle()
  if (!existing || existing.ended_on !== null) return json({ error: 'not_found' }, 404)

  if (
    !mayAssign(
      caller,
      existing.person_id as string,
      existing.role as AppRole,
      (existing.outlet_id as string | null) ?? null,
    )
  ) {
    return json({ error: 'forbidden' }, 403)
  }

  const { error } = await service
    .from('assignments')
    .update({ ended_on: new Date().toISOString().slice(0, 10) })
    .eq('id', assignmentId)
  // The last-owner guard is the one refusal that is not about the caller, so
  // it gets its own name: "you may do this, but not to the only one left".
  if (error) return json({ error: 'last_super_admin' }, 409)

  return json({ assignmentId }, 200)
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
    case 'emails':
      return await emails(service, caller)
    case 'set-email':
      return await setEmail(service, caller, body)
    case 'assign':
      return await assign(service, caller, body)
    case 'end-assignment':
      return await endAssignment(service, caller, body)
    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
