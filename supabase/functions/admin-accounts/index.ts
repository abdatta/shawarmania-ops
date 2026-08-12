import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  authAliasToUsername,
  canonicalUsername,
  usernameToAuthAlias,
} from '../../../shared/username.ts'
import {
  APP_ROLES,
  callerFrom,
  isOwner,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface IssuedCode {
  profileId: string
  username: string
  code: string
  expiresAt: string
  purpose: 'activation' | 'password_reset'
}

interface IntendedAssignment {
  assignmentId: string | null
  outletId: string | null
  role: AppRole
  startedOn: string
}

async function currentUsername(service: SupabaseClient, profileId: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.getUserById(profileId)
  return error ? null : authAliasToUsername(data.user?.email)
}

async function issueCodeFor(
  service: SupabaseClient,
  profileId: string,
  issuedBy: string,
  purpose: 'activation' | 'password_reset',
): Promise<IssuedCode | null> {
  const code = generateCode()
  const { data: inviteId, error } = await service.rpc('issue_account_invite', {
    p_profile_id: profileId,
    p_issued_by: issuedBy,
    p_code_hash: await hashCode(normaliseCode(code)),
    p_valid_for: INVITE_VALID_FOR,
    p_purpose: purpose,
  })
  if (error || !inviteId) return null

  const [{ data: invite }, username] = await Promise.all([
    service
      .from('account_invites')
      .select('expires_at')
      .eq('id', inviteId as string)
      .maybeSingle(),
    currentUsername(service, profileId),
  ])
  if (!username) return null

  return {
    profileId,
    username,
    code,
    expiresAt: (invite?.expires_at as string | undefined) ?? '',
    purpose,
  }
}

async function provision(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const fullName = str(body['fullName'])
  const username = canonicalUsername(str(body['username']) ?? '')
  const authAlias = usernameToAuthAlias(username ?? '')
  const accountEmail = str(body['accountEmail'])?.toLowerCase() ?? null
  const phone = str(body['phone']) ?? null
  const role = str(body['role']) as AppRole | undefined
  const rawOutletIds = body['outletIds']
  const outletIds = Array.isArray(rawOutletIds) ? rawOutletIds.map(str) : null
  const roleTitle = str(body['roleTitle']) ?? null
  const startedOn = str(body['joinedOn']) ?? null

  if (
    !fullName ||
    !username ||
    !authAlias ||
    !role ||
    !APP_ROLES.includes(role) ||
    outletIds === null ||
    outletIds.some((outletId) => outletId === undefined || !UUID.test(outletId))
  ) {
    return json({ error: 'invalid_request' }, 400)
  }

  const requestedOutletIds = outletIds as string[]
  if (!mayProvision(caller, role, requestedOutletIds)) {
    return json({ error: 'forbidden' }, 403)
  }
  if (
    (role === 'super_admin' && accountEmail === null) ||
    (role !== 'super_admin' && accountEmail !== null)
  ) {
    return json({ error: 'invalid_request' }, 400)
  }

  // A password nobody has seen. The account becomes usable only through the
  // one-time link; the alias is pre-confirmed because nothing is ever mailed
  // to the reserved .invalid address.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: authAlias,
    email_confirm: true,
    password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
  })
  if (createError || !created.user) return json({ error: 'username_unavailable' }, 409)

  const code = generateCode()
  const { data: provisioned, error: provisionError } = await service.rpc(
    'provision_account_with_invite',
    {
      p_profile_id: created.user.id,
      p_full_name: fullName,
      p_phone: phone,
      p_role: role,
      p_outlet_ids: requestedOutletIds,
      p_role_title: roleTitle,
      p_started_on: startedOn,
      p_account_email: accountEmail,
      p_issued_by: caller.id,
      p_code_hash: await hashCode(normaliseCode(code)),
      p_valid_for: INVITE_VALID_FOR,
    },
  )

  if (provisionError) {
    const { error: cleanupError } = await service.auth.admin.deleteUser(created.user.id)
    if (cleanupError) {
      // Opaque user id only: no username, personal email, invite, or password belongs
      // in logs.
      console.error('auth cleanup failed after account transaction', created.user.id)
      return json({ error: 'cleanup_failed' }, 500)
    }
    const detail = `${provisionError.message} ${provisionError.details ?? ''}`
    if (provisionError.code === '23505' && detail.includes('email')) {
      return json({ error: 'email_unavailable' }, 409)
    }
    return json({ error: 'account_rejected' }, 400)
  }

  const row = (
    provisioned as { profile_id: string; invite_id: string; invite_expires_at: string }[] | null
  )?.[0]
  if (!row) {
    await service.auth.admin.deleteUser(created.user.id)
    return json({ error: 'invite_failed' }, 500)
  }

  return json(
    {
      profileId: created.user.id,
      username,
      code,
      expiresAt: row.invite_expires_at,
      purpose: 'activation',
    },
    201,
  )
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

  const { data: authUser, error: authError } = await service.auth.admin.getUserById(target.id)
  if (authError || !authUser.user) return json({ error: 'lookup_failed' }, 500)
  const purpose = authUser.user.last_sign_in_at ? 'password_reset' : 'activation'
  const issued = await issueCodeFor(service, target.id, caller.id, purpose)
  if (!issued) return json({ error: 'invite_failed' }, 500)
  return json(issued, 200)
}

async function issueHandover(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  if (!profileId) return json({ error: 'invalid_request' }, 400)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target)) return json({ error: 'forbidden' }, 403)
  if (!target.isActive) return json({ error: 'account_inactive' }, 409)

  const { data, error } = await service.auth.admin.getUserById(profileId)
  if (error || !data.user) return json({ error: 'lookup_failed' }, 500)
  const purpose = data.user.last_sign_in_at ? 'password_reset' : 'activation'
  const issued = await issueCodeFor(service, profileId, caller.id, purpose)
  if (!issued) return json({ error: 'invite_failed' }, 500)
  return json(issued, 200)
}

async function setActive(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const isActive = body['isActive']
  if (!profileId || typeof isActive !== 'boolean') {
    return json({ error: 'invalid_request' }, 400)
  }

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
 * Usernames are parsed from Auth aliases before returning. Account email is
 * included only for a Super Admin looking at a Super Admin (their own email remains
 * read-only here); no outlet-scoped role can receive it.
 */
async function identifiers(service: SupabaseClient, caller: Caller): Promise<Response> {
  if (!managesAnyone(caller)) return json({ error: 'forbidden' }, 403)

  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return json({ error: 'lookup_failed' }, 500)
  if (data.users.length >= 1000) return json({ error: 'too_many_accounts' }, 500)

  const accountEmails = new Map<string, string>()
  if (isOwner(caller)) {
    const { data: rows, error: accountEmailError } = await service
      .from('account_emails')
      .select('profile_id, email')
    if (accountEmailError) return json({ error: 'lookup_failed' }, 500)
    for (const row of rows ?? []) {
      accountEmails.set(row.profile_id as string, row.email as string)
    }
  }

  const { data: liveInvites, error: inviteError } = await service
    .from('account_invites')
    .select('profile_id, purpose, expires_at')
    .is('consumed_at', null)
    .is('superseded_at', null)
    .gt('expires_at', new Date().toISOString())
  if (inviteError) return json({ error: 'lookup_failed' }, 500)
  const invites = new Map(
    (liveInvites ?? []).map((invite) => [
      invite.profile_id as string,
      {
        purpose: invite.purpose as 'activation' | 'password_reset',
        expiresAt: invite.expires_at as string,
      },
    ]),
  )

  const visible: Record<
    string,
    {
      username: string
      accountEmail: string | null
      hasSignedIn: boolean
      invite: { purpose: 'activation' | 'password_reset'; expiresAt: string } | null
      stateFingerprint: string
    }
  > = {}
  for (const user of data.users) {
    const username = authAliasToUsername(user.email)
    if (!username) continue

    const target = user.id === caller.id ? null : await loadAccount(service, user.id)
    if (user.id !== caller.id && (!target || !mayManage(caller, target))) continue
    const { data: fingerprint, error: fingerprintError } = await service.rpc(
      'account_state_fingerprint',
      { p_profile_id: user.id },
    )
    if (fingerprintError || typeof fingerprint !== 'string') {
      return json({ error: 'lookup_failed' }, 500)
    }
    visible[user.id] = {
      username,
      accountEmail:
        user.id === caller.id || (target && isOwner(caller) && isOwner(target))
          ? (accountEmails.get(user.id) ?? null)
          : null,
      hasSignedIn: Boolean(user.last_sign_in_at),
      invite: invites.get(user.id) ?? null,
      stateFingerprint: fingerprint,
    }
  }

  return json({ identifiers: visible }, 200)
}

function intendedAssignments(value: unknown): IntendedAssignment[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const parsed: IntendedAssignment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    const assignmentId = row['assignmentId'] === null ? null : str(row['assignmentId'])
    const outletId = row['outletId'] === null ? null : str(row['outletId'])
    const role = str(row['role']) as AppRole | undefined
    const startedOn = str(row['startedOn'])
    if (
      (assignmentId !== null && (!assignmentId || !UUID.test(assignmentId))) ||
      (outletId !== null && (!outletId || !UUID.test(outletId))) ||
      !role ||
      !APP_ROLES.includes(role) ||
      !startedOn
    ) {
      return null
    }
    parsed.push({ assignmentId, outletId, role, startedOn })
  }
  return parsed
}

function assignmentFailure(error: { code?: string; message: string; details?: string }): Response {
  const detail = `${error.message} ${error.details ?? ''}`
  if (error.code === 'P0001' && detail.includes('stale account state')) {
    return json({ error: 'stale_edit' }, 409)
  }
  if (error.code === '42501' || error.code === 'insufficient_privilege') {
    return json({ error: 'forbidden' }, 403)
  }
  if (detail.includes('last super admin')) return json({ error: 'last_super_admin' }, 409)
  if (error.code === '23505' && detail.includes('email')) {
    return json({ error: 'email_unavailable' }, 409)
  }
  if (error.code === '23505') return json({ error: 'already_assigned' }, 409)
  return json({ error: 'invalid_request' }, 400)
}

async function editAccount(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const expectedStateFingerprint = str(body['expectedStateFingerprint'])
  const fullName = str(body['fullName'])
  const phone = body['phone'] === null ? null : str(body['phone'])
  const roleTitle = body['roleTitle'] === null ? null : str(body['roleTitle'])
  const accountEmail =
    body['accountEmail'] === null ? null : str(body['accountEmail'])?.toLowerCase()
  const assignments = intendedAssignments(body['assignments'])
  if (
    !profileId ||
    !UUID.test(profileId) ||
    !expectedStateFingerprint ||
    !fullName ||
    phone === undefined ||
    roleTitle === undefined ||
    accountEmail === undefined ||
    !assignments
  ) {
    return json({ error: 'invalid_request' }, 400)
  }

  const code = generateCode()
  const { data, error } = await service.rpc('edit_account_assignment_set', {
    p_actor_id: caller.id,
    p_profile_id: profileId,
    p_expected_fingerprint: expectedStateFingerprint,
    p_full_name: fullName,
    p_phone: phone,
    p_role_title: roleTitle,
    p_account_email: accountEmail,
    p_assignments: assignments,
    p_issued_by: caller.id,
    p_activation_code_hash: await hashCode(normaliseCode(code)),
    p_valid_for: INVITE_VALID_FOR,
  })
  if (error) return assignmentFailure(error)
  const row = (
    data as
      | {
          profile_id: string
          state_fingerprint: string
          assignments: IntendedAssignment[]
          invite_id: string | null
          invite_expires_at: string | null
        }[]
      | null
  )?.[0]
  if (!row) return json({ error: 'update_failed' }, 500)

  const username = row.invite_id ? await currentUsername(service, profileId) : null
  if (row.invite_id && !username) return json({ error: 'account_integrity' }, 500)
  return json(
    {
      profileId: row.profile_id,
      assignments: row.assignments,
      stateFingerprint: row.state_fingerprint,
      replacementHandover: row.invite_id
        ? {
            profileId: row.profile_id,
            username,
            code,
            expiresAt: row.invite_expires_at ?? '',
            purpose: 'activation',
          }
        : null,
    },
    200,
  )
}

async function markAsLeft(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const expectedStateFingerprint = str(body['expectedStateFingerprint'])
  if (!profileId || !UUID.test(profileId) || !expectedStateFingerprint) {
    return json({ error: 'invalid_request' }, 400)
  }
  const { data, error } = await service.rpc('mark_account_as_left', {
    p_actor_id: caller.id,
    p_profile_id: profileId,
    p_expected_fingerprint: expectedStateFingerprint,
  })
  if (error) return assignmentFailure(error)
  const row = (
    data as
      { profile_id: string; state_fingerprint: string; assignments: IntendedAssignment[] }[] | null
  )?.[0]
  if (!row) return json({ error: 'update_failed' }, 500)
  return json(
    {
      profileId: row.profile_id,
      assignments: row.assignments,
      stateFingerprint: row.state_fingerprint,
      replacementHandover: null,
    },
    200,
  )
}

async function setUsername(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const username = canonicalUsername(str(body['username']) ?? '')
  const authAlias = usernameToAuthAlias(username ?? '')
  if (!profileId || !username || !authAlias) {
    return json({ error: 'invalid_request' }, 400)
  }
  if (profileId === caller.id) return json({ error: 'forbidden' }, 403)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target)) return json({ error: 'forbidden' }, 403)

  const { error } = await service.auth.admin.updateUserById(target.id, {
    email: authAlias,
    email_confirm: true,
  })
  if (error) return json({ error: 'username_unavailable' }, 409)
  return json({ profileId: target.id, username }, 200)
}

async function setAccountEmail(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const accountEmail = str(body['accountEmail'])?.toLowerCase()
  if (!profileId || !accountEmail) return json({ error: 'invalid_request' }, 400)
  if (!isOwner(caller)) return json({ error: 'forbidden' }, 403)
  if (profileId === caller.id) return json({ error: 'forbidden' }, 403)

  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayManage(caller, target) || !isOwner(target)) {
    return json({ error: 'forbidden' }, 403)
  }

  const { error } = await service.rpc('set_super_admin_account_email', {
    p_profile_id: profileId,
    p_email: accountEmail,
  })
  if (error?.code === '23505') {
    return json({ error: 'email_unavailable' }, 409)
  }
  if (error) return json({ error: 'invalid_request' }, 400)
  return json({ profileId, accountEmail }, 200)
}

async function assign(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const personId = str(body['personId'])
  const role = str(body['role']) as AppRole | undefined
  const outletId = str(body['outletId']) ?? null
  const accountEmail = str(body['accountEmail'])?.toLowerCase() ?? null
  if (!personId || !role || !APP_ROLES.includes(role)) {
    return json({ error: 'invalid_request' }, 400)
  }
  if (
    (role === 'super_admin' && accountEmail === null) ||
    (role !== 'super_admin' && accountEmail !== null)
  ) {
    return json({ error: 'invalid_request' }, 400)
  }

  const target = await loadAccount(service, personId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (!mayAssign(caller, personId, role, outletId)) {
    return json({ error: 'forbidden' }, 403)
  }

  const code = generateCode()
  const { data, error } = await service.rpc('grant_assignment_with_invite', {
    p_person_id: personId,
    p_role: role,
    p_outlet_id: outletId,
    p_account_email: accountEmail,
    p_issued_by: caller.id,
    p_code_hash: await hashCode(normaliseCode(code)),
    p_valid_for: INVITE_VALID_FOR,
  })
  if (error?.code === '23505' && `${error.message} ${error.details ?? ''}`.includes('email')) {
    return json({ error: 'email_unavailable' }, 409)
  }
  if (error?.code === '23505') return json({ error: 'already_assigned' }, 409)
  if (error) return json({ error: 'assignment_rejected' }, 400)

  const row = (
    data as
      | {
          assignment_id: string
          invite_id: string | null
          invite_expires_at: string | null
        }[]
      | null
  )?.[0]
  if (!row) return json({ error: 'assignment_rejected' }, 500)

  const username = row.invite_id ? await currentUsername(service, personId) : null
  if (row.invite_id && !username) return json({ error: 'account_integrity' }, 500)

  return json(
    {
      assignmentId: row.assignment_id,
      issuedCode: row.invite_id
        ? {
            profileId: personId,
            username,
            code,
            expiresAt: row.invite_expires_at ?? '',
            purpose: 'activation',
          }
        : null,
    },
    201,
  )
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

  const code = generateCode()
  const { data, error } = await service.rpc('end_assignment_with_invite', {
    p_assignment_id: assignmentId,
    p_issued_by: caller.id,
    p_code_hash: await hashCode(normaliseCode(code)),
    p_valid_for: INVITE_VALID_FOR,
  })
  if (error?.code === 'P0002') return json({ error: 'not_found' }, 404)
  if (error?.message.includes('last super admin assignment')) {
    return json({ error: 'last_super_admin' }, 409)
  }
  if (error) return json({ error: 'assignment_rejected' }, 400)

  const row = (
    data as
      | {
          assignment_id: string
          invite_id: string | null
          invite_expires_at: string | null
          person_id: string
        }[]
      | null
  )?.[0]
  if (!row) return json({ error: 'not_found' }, 404)

  const username = row.invite_id ? await currentUsername(service, row.person_id) : null
  if (row.invite_id && !username) return json({ error: 'account_integrity' }, 500)

  return json(
    {
      assignmentId: row.assignment_id,
      issuedCode: row.invite_id
        ? {
            profileId: row.person_id,
            username,
            code,
            expiresAt: row.invite_expires_at ?? '',
            purpose: 'activation',
          }
        : null,
    },
    200,
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const service = serviceClient()
  const resolved = await callerFrom(req, service)
  if (resolved.kind === 'session_invalid') return json({ error: 'session_invalid' }, 401)
  if (resolved.kind === 'backend_failure') return json({ error: 'backend_failure' }, 503)
  const caller = resolved.caller

  const body = await readJson(req)
  if (!body) return json({ error: 'invalid_request' }, 400)

  switch (body['action']) {
    case 'provision':
      return await provision(service, caller, body)
    case 'reissue':
      return await reissue(service, caller, body)
    case 'issue-handover':
      return await issueHandover(service, caller, body)
    case 'set-active':
      return await setActive(service, caller, body)
    case 'identifiers':
      return await identifiers(service, caller)
    case 'set-username':
      return await setUsername(service, caller, body)
    case 'set-account-email':
      return await setAccountEmail(service, caller, body)
    case 'assign':
      return await assign(service, caller, body)
    case 'end-assignment':
      return await endAssignment(service, caller, body)
    case 'edit-account':
      return await editAccount(service, caller, body)
    case 'mark-as-left':
      return await markAsLeft(service, caller, body)
    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
