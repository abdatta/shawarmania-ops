#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { authAliasToUsername, usernameToAuthAlias } from '../shared/username.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION = path.join(ROOT, 'scripts/migrate-usernames.mjs')
const MAPPING = 'supabase/.username-migration/rehearsal/mapping.json'
const CHECKPOINT = 'supabase/.username-migration/rehearsal/checkpoint.json'
const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
const PENDING_CODE = 'ABCDE-FGHJK'
const PENDING_USER_ID = '10000000-0000-4000-a000-00000000000c'

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

if (!url || !serviceKey || !anonKey) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY from `supabase status`.',
  )
}
if (url !== 'http://127.0.0.1:54321') {
  throw new Error('Rehearsal is hard-locked to the local Supabase URL.')
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anonymous = () =>
  createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

function migration(args, expectedFailure = false) {
  const result = spawnSync(
    process.execPath,
    [MIGRATION, ...args, '--mapping', MAPPING, '--checkpoint', CHECKPOINT],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
    },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (expectedFailure) {
    if (result.status === 0 || !output.includes('Rehearsal interruption requested')) {
      throw new Error(`Expected a checkpointed rehearsal interruption.\n${output}`)
    }
    return
  }
  if (result.status !== 0) throw new Error(output)
}

async function authUsers() {
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 1000) return users
  }
}

async function rowCounts() {
  const tables = ['profiles', 'assignments', 'attendance', 'account_invites', 'account_emails']
  const counts = {}
  for (const table of tables) {
    const { count, error } = await service.from(table).select('*', { count: 'exact', head: true })
    if (error) throw error
    counts[table] = count
  }
  counts.authUsers = (await authUsers()).length
  return counts
}

async function functionCall(name, body) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      'x-forwarded-for': '203.0.113.88',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  // A database reset does not touch the ignored operator directory. Remove
  // artifacts from an earlier local rehearsal so its checkpoint cannot make a
  // fresh database look migrated.
  migration(['--destroy-mapping'])

  const beforeCounts = await rowCounts()
  const users = await authUsers()
  const { data: ownerRows, error: ownerError } = await service
    .from('assignments')
    .select('person_id')
    .eq('role', 'super_admin')
    .is('ended_on', null)
  if (ownerError) throw ownerError
  const ownerIds = [...new Set((ownerRows ?? []).map((row) => row.person_id))]
  assert(ownerIds.length > 0, 'The production-shaped seed has no live owner.')

  const usernameById = new Map()
  for (const user of users) {
    const username = authAliasToUsername(user.email)
    assert(username, `${user.id}: reset the local seed before rehearsal`)
    usernameById.set(user.id, username)
    const { error } = await service.auth.admin.updateUserById(user.id, {
      email: `${username}@legacy.test`,
      email_confirm: true,
    })
    if (error) throw error
  }

  const ownerId = ownerIds[0]
  const ownerUsername = usernameById.get(ownerId)
  const legacyOwner = await anonymous().auth.signInWithPassword({
    email: `${ownerUsername}@legacy.test`,
    password: SEED_PASSWORD,
  })
  if (legacyOwner.error || !legacyOwner.data.session) throw legacyOwner.error
  const originalSession = legacyOwner.data.session

  migration(['--dry-run', ...ownerIds.flatMap((owner) => ['--approve-email', owner])])
  migration(['--approve-mapping', '--approved-by', 'local-rehearsal'])
  migration(['--apply', '--stop-after', '2'], true)
  migration(['--apply'])

  const migratedUsers = await authUsers()
  assert(
    migratedUsers.every((user) => authAliasToUsername(user.email)),
    'A local Auth user was left outside the reserved alias namespace.',
  )
  const migratedOwnerUsername = authAliasToUsername(
    migratedUsers.find((user) => user.id === ownerId)?.email,
  )
  const migratedPendingUsername = authAliasToUsername(
    migratedUsers.find((user) => user.id === PENDING_USER_ID)?.email,
  )
  assert(migratedOwnerUsername, 'The owner lost their approved username.')
  assert(migratedPendingUsername, 'The pending account lost its approved username.')

  const firstReadiness = await functionCall('email-sign-in', {
    action: 'deployment-readiness',
  })
  assert(
    firstReadiness.status === 200 && firstReadiness.body.ready === true,
    'Static publication did not open after the complete username migration.',
  )

  const passwordSession = await anonymous().auth.signInWithPassword({
    email: usernameToAuthAlias(migratedOwnerUsername),
    password: SEED_PASSWORD,
  })
  assert(!passwordSession.error, 'The existing owner password did not survive migration.')

  const { data: ownerAccountEmail, error: ownerAccountEmailError } = await service
    .from('account_emails')
    .select('email')
    .eq('profile_id', ownerId)
    .single()
  if (ownerAccountEmailError) throw ownerAccountEmailError
  const emailSession = await functionCall('email-sign-in', {
    email: ownerAccountEmail.email,
    password: SEED_PASSWORD,
  })
  assert(emailSession.status === 200, 'The approved account email could not sign in.')
  const emailIdentity = await anonymous().auth.setSession({
    access_token: emailSession.body.accessToken,
    refresh_token: emailSession.body.refreshToken,
  })
  assert(
    !emailIdentity.error && emailIdentity.data.user?.id === ownerId,
    'Username and account email did not reach the same Auth user.',
  )

  const existingRead = await fetch(`${url}/rest/v1/profiles?select=id&id=eq.${ownerId}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${originalSession.access_token}`,
    },
  })
  assert(existingRead.ok && (await existingRead.json()).length === 1, 'The open session was lost.')

  const refreshed = await anonymous().auth.refreshSession({
    refresh_token: originalSession.refresh_token,
  })
  assert(!refreshed.error && refreshed.data.session, 'The refresh session was lost.')

  const preview = await functionCall('redeem-invite', {
    action: 'preview',
    code: PENDING_CODE,
  })
  assert(
    preview.status === 200 && preview.body.username === migratedPendingUsername,
    'The pending invite did not preview its approved username.',
  )
  const redeemed = await functionCall('redeem-invite', {
    action: 'redeem',
    code: PENDING_CODE,
    username: migratedPendingUsername,
    password: NEW_PASSWORD,
  })
  assert(redeemed.status === 204, 'The pending invite did not redeem after migration.')

  migration(['--postflight'])
  assert(
    JSON.stringify(await rowCounts()) === JSON.stringify(beforeCounts),
    'Operational row or Auth-user counts changed during migration.',
  )

  migration(['--rollback'])
  const rolledBack = await anonymous().auth.signInWithPassword({
    email: `${ownerUsername}@legacy.test`,
    password: SEED_PASSWORD,
  })
  assert(!rolledBack.error, 'The reviewed rollback did not restore legacy sign-in.')
  const rollbackReadiness = await functionCall('email-sign-in', {
    action: 'deployment-readiness',
  })
  assert(
    rollbackReadiness.status === 503 && rollbackReadiness.body.ready === false,
    'Static publication remained open after identity rollback.',
  )

  migration(['--apply'])
  migration(['--postflight'])
  const repairedReadiness = await functionCall('email-sign-in', {
    action: 'deployment-readiness',
  })
  assert(
    repairedReadiness.status === 200 && repairedReadiness.body.ready === true,
    'Static publication did not reopen after forward username repair.',
  )
  migration(['--destroy-mapping'])
  console.log(
    'Local rehearsal passed: interruption/resume, username and email sign-in, password and session survival, pending invite, postflight, rollback, forward repair, and fail-closed publication readiness.',
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
