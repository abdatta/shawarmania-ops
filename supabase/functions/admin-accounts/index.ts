import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  authAliasToUsername,
  canonicalUsername,
  LEFT_ALIAS_SUFFIX,
  leftAuthAlias,
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
  verifiedUserId,
  type AppRole,
  type Caller,
  type TargetAccount,
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

/**
 * A change gate's answer, read on every request (AGENTS.md: an Edge Function
 * that changes behaviour reads `app_change_gate` with the service role). A read
 * that fails is off, and off is the behaviour as it was.
 */
async function gateOn(service: SupabaseClient, key: string): Promise<boolean> {
  const { data, error } = await service.rpc('app_change_gate', { p_key: key })
  return !error && data === true
}

/**
 * Owner access is granted and removed only in the database while
 * `owner-access-in-the-database` is on (a-deactivated-person-leaves-in-two-steps,
 * design D5). Every refusal is this one answer.
 */
const OWNER_ACCESS_IN_DATABASE = 'owner-access-in-the-database'
const ownerAccessInDatabase = () => json({ error: 'owner_access_in_database' }, 403)

/** The live Super Admin assignments a person holds, by id. */
async function liveOwnerAssignmentIds(
  service: SupabaseClient,
  profileId: string,
): Promise<string[] | null> {
  const { data, error } = await service
    .from('assignments')
    .select('id')
    .eq('person_id', profileId)
    .eq('role', 'super_admin')
    .is('ended_on', null)
  if (error) return null
  return (data ?? []).map((row) => row.id as string)
}

/**
 * Write the account's sign-in state and the day it was switched off
 * (design D2): the day is stamped going from active to inactive, cleared going
 * back, and left alone when nothing changes. The day is the database's.
 */
async function writeActive(
  service: SupabaseClient,
  target: TargetAccount,
  isActive: boolean,
): Promise<boolean> {
  const patch: { is_active: boolean; deactivated_on?: string | null } = { is_active: isActive }
  if (isActive && !target.isActive) patch.deactivated_on = null
  if (!isActive && target.isActive) {
    const { data: today, error } = await service.rpc('app_kolkata_today')
    if (error || typeof today !== 'string') return false
    patch.deactivated_on = today
  }
  const { error } = await service.from('profiles').update(patch).eq('id', target.id)
  return !error
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
  if (role === 'super_admin' && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
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
  if (isOwner(target) && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
  }

  if (!(await writeActive(service, target, isActive))) return json({ error: 'update_failed' }, 500)
  return json({ profileId: target.id, isActive }, 200)
}

interface IdentifierFactsRow {
  profile_id: string
  auth_email: string | null
  last_sign_in_at: string | null
  account_email: string | null
  invite_purpose: 'activation' | 'password_reset' | null
  invite_expires_at: string | null
  is_active: boolean
  live_assignments: { role: AppRole; outlet_id: string | null }[]
  state_fingerprint: string
}

/**
 * Usernames are parsed from Auth aliases before returning. Account email is
 * included only for a Super Admin looking at a Super Admin (their own email remains
 * read-only here); no outlet-scoped role can receive it.
 *
 * **Two round trips, whatever the number of accounts**: the token check, then
 * `account_identifier_facts()`, which answers for every account at once —
 * including the caller's own, which is what resolves them. It was four waves
 * and 2.4 s warm on production on 2026-09-26 (people-shows-names-first, design
 * D4). Who is answered for is decided here, row by row, exactly as before.
 */
async function identifiers(service: SupabaseClient, userId: string): Promise<Response> {
  const { data, error } = await service.rpc('account_identifier_facts')
  // Not knowing who the caller is, is uncertainty rather than a refusal — the
  // same classification callerFrom gives a failed account read.
  if (error) return json({ error: 'backend_failure' }, 503)
  const rows = (data ?? []) as IdentifierFactsRow[]
  if (rows.length >= 1000) return json({ error: 'too_many_accounts' }, 500)

  const toAccount = (row: IdentifierFactsRow): TargetAccount => ({
    id: row.profile_id,
    isActive: row.is_active,
    assignments: row.live_assignments.map((a) => ({ role: a.role, outletId: a.outlet_id })),
  })

  // The caller is resolved from the same answer, on callerFrom's terms: no
  // account, or a deactivated one, is not a session.
  const own = rows.find((row) => row.profile_id === userId)
  if (!own || !own.is_active) return json({ error: 'session_invalid' }, 401)
  const self = toAccount(own)
  const caller: Caller = { id: self.id, assignments: self.assignments }
  if (!managesAnyone(caller)) return json({ error: 'forbidden' }, 403)

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
  for (const row of rows) {
    const username = authAliasToUsername(row.auth_email)
    if (!username) continue

    const target = row.profile_id === caller.id ? null : toAccount(row)
    if (target && !mayManage(caller, target)) continue
    if (typeof row.state_fingerprint !== 'string') return json({ error: 'lookup_failed' }, 500)

    visible[row.profile_id] = {
      username,
      accountEmail:
        isOwner(caller) && (target === null || isOwner(target)) ? row.account_email : null,
      hasSignedIn: row.last_sign_in_at !== null,
      invite:
        row.invite_purpose && row.invite_expires_at
          ? { purpose: row.invite_purpose, expiresAt: row.invite_expires_at }
          : null,
      stateFingerprint: row.state_fingerprint,
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

  // The intended set carries the target's owner assignments exactly as they
  // are, or the edit grants or removes owner access (design D5).
  if (await gateOn(service, OWNER_ACCESS_IN_DATABASE)) {
    const held = await liveOwnerAssignmentIds(service, profileId)
    if (held === null) return json({ error: 'lookup_failed' }, 500)
    const intended = assignments.filter((assignment) => assignment.role === 'super_admin')
    const same =
      intended.length === held.length &&
      intended.every(
        (assignment) => assignment.assignmentId !== null && held.includes(assignment.assignmentId),
      )
    if (!same) return ownerAccessInDatabase()
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
  // Read only to refuse an owner and to date the departure; a missing account
  // is still the database's to answer, as it was.
  const target = await loadAccount(service, profileId)
  if (target && isOwner(target) && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
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
  // A departure of somebody still signed in is a deactivation on the same day,
  // which is true, so it carries the day as Deactivate does (design D2). The
  // departure has committed; a failed stamp leaves a day for the D7 repair.
  if (target?.isActive) {
    const { data: today } = await service.rpc('app_kolkata_today')
    if (typeof today === 'string') {
      await service.from('profiles').update({ deactivated_on: today }).eq('id', profileId)
    }
  }
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

/**
 * Mark as left, the second step (design D3): only from a deactivated account,
 * dated by its deactivation, clearing the phone in the database and then moving
 * the Auth alias out of the sign-in namespace so the username is free. The
 * database commits first: a failed move leaves somebody left whose username is
 * still held, which is harmless and retried by sending this again, which skips
 * the departure it already made.
 */
async function markAsLeftV2(
  service: SupabaseClient,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<Response> {
  const profileId = str(body['profileId'])
  const expectedStateFingerprint = str(body['expectedStateFingerprint'])
  if (!profileId || !UUID.test(profileId) || !expectedStateFingerprint) {
    return json({ error: 'invalid_request' }, 400)
  }
  if (!(await gateOn(service, 'deactivate-then-leave'))) {
    return json({ error: 'not_available' }, 409)
  }
  const target = await loadAccount(service, profileId)
  if (!target) return json({ error: 'not_found' }, 404)
  if (isOwner(target) && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
  }

  let leftOn: string
  let stateFingerprint: string | null = null
  const alreadyLeft = !target.isActive && target.assignments.length === 0
  if (alreadyLeft) {
    // Somebody already left whose username move failed. Nothing to end again,
    // and nobody but the owner manages a person who works nowhere.
    if (!isOwner(caller)) return json({ error: 'forbidden' }, 403)
    const { data: profile } = await service
      .from('profiles')
      .select('deactivated_on')
      .eq('id', profileId)
      .maybeSingle()
    leftOn = (profile?.deactivated_on as string | null | undefined) ?? ''
  } else {
    const { data, error } = await service.rpc('mark_account_as_left_v2', {
      p_actor_id: caller.id,
      p_profile_id: profileId,
      p_expected_fingerprint: expectedStateFingerprint,
    })
    if (error) {
      const detail = `${error.message} ${error.details ?? ''}`
      if (detail.includes('deactivate first')) return json({ error: 'account_active' }, 409)
      if (detail.includes('deactivate-then-leave is off')) {
        return json({ error: 'not_available' }, 409)
      }
      if (detail.includes('owner access is changed in the database')) {
        return ownerAccessInDatabase()
      }
      return assignmentFailure(error)
    }
    const row = (
      data as { profile_id: string; state_fingerprint: string; left_on: string }[] | null
    )?.[0]
    if (!row) return json({ error: 'update_failed' }, 500)
    leftOn = row.left_on
    stateFingerprint = row.state_fingerprint
  }

  const { data: authUser, error: lookupError } = await service.auth.admin.getUserById(profileId)
  const email = authUser?.user?.email?.toLowerCase() ?? null
  if (lookupError || !email?.endsWith(LEFT_ALIAS_SUFFIX)) {
    const { error: moveError } = lookupError
      ? { error: lookupError }
      : await service.auth.admin.updateUserById(profileId, {
          email: leftAuthAlias(profileId),
          email_confirm: true,
        })
    if (moveError) {
      // Opaque id only: no username belongs in logs.
      console.error('left alias move failed', profileId)
      return json({ error: 'left_username_held', profileId, leftOn }, 409)
    }
  }
  return json({ profileId, leftOn, stateFingerprint }, 200)
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
  if (role === 'super_admin' && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
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
  if (existing.role === 'super_admin' && (await gateOn(service, OWNER_ACCESS_IN_DATABASE))) {
    return ownerAccessInDatabase()
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

  // The one read-only list gets the short path: it resolves its caller from its
  // own answer instead of loading their account first (design D4). Every other
  // action resolves the caller in full before doing anything.
  const body = await readJson(req)
  if (body?.['action'] === 'identifiers') {
    const verified = await verifiedUserId(req, service)
    if (verified.kind === 'session_invalid') return json({ error: 'session_invalid' }, 401)
    if (verified.kind === 'backend_failure') return json({ error: 'backend_failure' }, 503)
    return await identifiers(service, verified.userId)
  }

  const resolved = await callerFrom(req, service)
  if (resolved.kind === 'session_invalid') return json({ error: 'session_invalid' }, 401)
  if (resolved.kind === 'backend_failure') return json({ error: 'backend_failure' }, 503)
  const caller = resolved.caller

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
    case 'mark-as-left-v2':
      return await markAsLeftV2(service, caller, body)
    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
