#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { authAliasToUsername, canonicalUsername, usernameToAuthAlias } from '../shared/username.ts'

const PRIVATE_ROOT = path.resolve('supabase/.username-migration')
const DEFAULT_MAPPING = path.join(PRIVATE_ROOT, 'mapping.json')
const DEFAULT_CHECKPOINT = path.join(PRIVATE_ROOT, 'checkpoint.json')
const PLACEHOLDER = /@(placeholder\.invalid|example\.com)$/i

function parseArgs(argv) {
  const options = {
    mode: 'dry-run',
    mapping: DEFAULT_MAPPING,
    checkpoint: DEFAULT_CHECKPOINT,
    approvedOwners: new Set(),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (['--dry-run', '--apply', '--postflight', '--rollback', '--destroy-mapping'].includes(arg)) {
      options.mode = arg.slice(2)
    } else if (arg === '--mapping') {
      options.mapping = path.resolve(argv[++index] ?? '')
    } else if (arg === '--checkpoint') {
      options.checkpoint = path.resolve(argv[++index] ?? '')
    } else if (arg === '--approve-owner') {
      options.approvedOwners.add(argv[++index] ?? '')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function requirePrivatePath(candidate) {
  const resolved = path.resolve(candidate)
  const relative = path.relative(PRIVATE_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Sensitive migration files must stay under ${PRIVATE_ROOT}`)
  }
  return resolved
}

async function writePrivateJson(file, value) {
  const target = requirePrivatePath(file)
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await chmod(path.dirname(target), 0o700).catch(() => undefined)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600).catch(() => undefined)
  await rename(temporary, target)
  await chmod(target, 0o600).catch(() => undefined)
}

async function readJson(file) {
  return JSON.parse(await readFile(requirePrivatePath(file), 'utf8'))
}

function apiConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the operator shell. ' +
        'Never expose either as a Vite variable.',
    )
  }
  return { url, serviceKey }
}

async function request(config, pathname, init = {}) {
  const response = await fetch(`${config.url}${pathname}`, {
    ...init,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed with ${response.status}`)
  }
  if (response.status === 204) return null
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function loadAuthUsers(config) {
  const users = []
  for (let page = 1; ; page += 1) {
    const payload = await request(config, `/auth/v1/admin/users?page=${page}&per_page=1000`)
    const batch = payload?.users ?? []
    users.push(...batch)
    if (batch.length < 1000) return users
  }
}

async function loadRows(config, table, select) {
  return await request(config, `/rest/v1/${table}?select=${encodeURIComponent(select)}`)
}

function proposedUsername(user, profile) {
  const existing = authAliasToUsername(user.email)
  if (existing) return existing
  const source = user.email?.split('@')[0] || profile?.full_name || ''
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30)
  return canonicalUsername(normalized)
}

export function buildMapping({ users, profiles, assignments, contacts, approvedOwners }) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const contactById = new Map(contacts.map((contact) => [contact.profile_id, contact.email]))
  const ownerIds = new Set(
    assignments
      .filter((assignment) => assignment.role === 'super_admin' && assignment.ended_on === null)
      .map((assignment) => assignment.person_id),
  )
  const proposed = users.map((user) => {
    const owner = ownerIds.has(user.id)
    const ownerApproved = !owner || approvedOwners.has(user.id)
    const username = proposedUsername(user, profileById.get(user.id))
    const recoveryEmail =
      contactById.get(user.id) ??
      (owner && ownerApproved && user.email ? user.email.toLowerCase() : null)
    return {
      userId: user.id,
      oldEmail: user.email ?? null,
      username,
      newAlias: username ? usernameToAuthAlias(username) : null,
      isOwner: owner,
      recoveryEmail: owner ? recoveryEmail : null,
      ownerApproved,
      status: 'pending',
      flags: [
        ...(user.email && PLACEHOLDER.test(user.email) ? ['placeholder_address'] : []),
        ...(!username ? ['username_needs_review'] : []),
        ...(owner && !recoveryEmail ? ['owner_recovery_missing'] : []),
      ],
    }
  })

  const usernameCounts = new Map()
  for (const row of proposed) {
    if (row.username) {
      usernameCounts.set(row.username, (usernameCounts.get(row.username) ?? 0) + 1)
    }
  }
  for (const row of proposed) {
    if (row.username && usernameCounts.get(row.username) > 1) {
      row.flags.push('username_collision')
      row.username = null
      row.newAlias = null
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceUrl: process.env.SUPABASE_URL,
    users: proposed,
  }
}

export function validateMapping(mapping) {
  const errors = []
  const aliases = new Set()
  for (const row of mapping.users ?? []) {
    const username = canonicalUsername(row.username ?? '')
    const alias = username ? usernameToAuthAlias(username) : null
    if (!username || alias !== row.newAlias) {
      errors.push(`${row.userId}: canonical username or alias is incomplete`)
    } else if (aliases.has(alias)) {
      errors.push(`${row.userId}: duplicate alias ${alias}`)
    } else {
      aliases.add(alias)
    }
    if (row.isOwner && (!row.recoveryEmail || !row.ownerApproved)) {
      errors.push(`${row.userId}: owner recovery email is missing or not approved`)
    }
    if (!row.isOwner && row.recoveryEmail) {
      errors.push(`${row.userId}: ordinary account must not carry recovery email`)
    }
    if (row.flags?.includes('username_collision') || row.flags?.includes('username_needs_review')) {
      errors.push(`${row.userId}: unresolved username review flag`)
    }
  }
  return errors
}

async function dryRun(options, config) {
  const [users, profiles, assignments, contacts] = await Promise.all([
    loadAuthUsers(config),
    loadRows(config, 'profiles', 'id,full_name,is_active'),
    loadRows(config, 'assignments', 'person_id,role,outlet_id,ended_on'),
    loadRows(config, 'account_recovery_contacts', 'profile_id,email').catch(() => []),
  ])
  const mapping = buildMapping({
    users,
    profiles,
    assignments,
    contacts,
    approvedOwners: options.approvedOwners,
  })
  await writePrivateJson(options.mapping, mapping)
  const flagged = mapping.users.filter((row) => row.flags.length > 0 || !row.ownerApproved)
  console.log(`Dry run mapped ${mapping.users.length} Auth users.`)
  console.log(`Private mapping: ${options.mapping}`)
  console.log(`Rows requiring review or owner approval: ${flagged.length}`)
  for (const row of flagged) {
    console.log(
      `${row.userId}: ${[...row.flags, ...(!row.ownerApproved ? ['owner_approval'] : [])].join(', ')}`,
    )
  }
}

async function setRecoveryContact(config, row) {
  if (!row.isOwner) return
  await request(config, '/rest/v1/rpc/set_account_recovery_contact', {
    method: 'POST',
    body: JSON.stringify({
      p_profile_id: row.userId,
      p_email: row.recoveryEmail,
    }),
  })
}

async function updateAuthEmail(config, userId, email) {
  await request(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({ email, email_confirm: true }),
  })
}

async function applyMapping(options, config) {
  const mapping = await readJson(options.mapping)
  const errors = validateMapping(mapping)
  if (errors.length > 0) {
    throw new Error(`Apply refused:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }

  const checkpoint = await readJson(options.checkpoint).catch(() => ({
    version: 1,
    completedUserIds: [],
  }))
  const completed = new Set(checkpoint.completedUserIds)
  for (const row of mapping.users) {
    if (completed.has(row.userId)) continue
    await setRecoveryContact(config, row)
    await updateAuthEmail(config, row.userId, row.newAlias)
    completed.add(row.userId)
    row.status = 'applied'
    checkpoint.completedUserIds = [...completed]
    checkpoint.updatedAt = new Date().toISOString()
    await writePrivateJson(options.checkpoint, checkpoint)
    await writePrivateJson(options.mapping, mapping)
    console.log(`Applied ${row.userId}`)
  }
  console.log(`Applied ${completed.size} users; rerunning --apply is idempotent.`)
}

async function postflight(options, config) {
  const mapping = await readJson(options.mapping)
  const [users, assignments, contacts, invites] = await Promise.all([
    loadAuthUsers(config),
    loadRows(config, 'assignments', 'person_id,role,ended_on'),
    loadRows(config, 'account_recovery_contacts', 'profile_id,email'),
    loadRows(config, 'account_invites', 'profile_id,consumed_at,superseded_at,expires_at'),
  ])
  const userById = new Map(users.map((user) => [user.id, user]))
  const liveOwners = new Set(
    assignments
      .filter((row) => row.role === 'super_admin' && row.ended_on === null)
      .map((row) => row.person_id),
  )
  const contactIds = new Set(contacts.map((row) => row.profile_id))
  const findings = []

  for (const row of mapping.users) {
    const current = userById.get(row.userId)
    if (authAliasToUsername(current?.email) !== row.username) {
      findings.push(`${row.userId}: Auth alias does not match the approved username`)
    }
  }
  for (const ownerId of liveOwners) {
    if (!contactIds.has(ownerId)) findings.push(`${ownerId}: live owner has no recovery contact`)
  }
  for (const contactId of contactIds) {
    if (!liveOwners.has(contactId)) {
      findings.push(`${contactId}: recovery contact belongs to a non-owner`)
    }
  }
  for (const invite of invites.filter(
    (row) => row.consumed_at === null && row.superseded_at === null,
  )) {
    if (!authAliasToUsername(userById.get(invite.profile_id)?.email)) {
      findings.push(`${invite.profile_id}: pending invite has no canonical username`)
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    users: users.length,
    liveOwners: liveOwners.size,
    recoveryContacts: contacts.length,
    livePendingInvites: invites.filter(
      (row) => row.consumed_at === null && row.superseded_at === null,
    ).length,
    findings,
  }
  await writePrivateJson(path.join(path.dirname(options.mapping), 'postflight.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (findings.length > 0) process.exitCode = 1
}

async function rollback(options, config) {
  const mapping = await readJson(options.mapping)
  for (const row of [...mapping.users].reverse()) {
    if (!row.oldEmail) throw new Error(`${row.userId}: rollback email is missing`)
    await updateAuthEmail(config, row.userId, row.oldEmail)
    row.status = 'rolled_back'
    await writePrivateJson(options.mapping, mapping)
    console.log(`Rolled back ${row.userId}`)
  }
}

async function destroyMapping(options) {
  const mapping = requirePrivatePath(options.mapping)
  const checkpoint = requirePrivatePath(options.checkpoint)
  await rm(mapping, { force: true })
  await rm(checkpoint, { force: true })
  await rm(path.join(path.dirname(mapping), 'postflight.json'), { force: true })
  console.log('Sensitive mapping, checkpoint, and postflight files removed.')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  options.mapping = requirePrivatePath(options.mapping)
  options.checkpoint = requirePrivatePath(options.checkpoint)
  if (options.mode === 'destroy-mapping') return await destroyMapping(options)

  const config = apiConfig()
  if (options.mode === 'dry-run') return await dryRun(options, config)
  if (options.mode === 'apply') return await applyMapping(options, config)
  if (options.mode === 'postflight') return await postflight(options, config)
  if (options.mode === 'rollback') return await rollback(options, config)
  throw new Error(`Unsupported mode: ${options.mode}`)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
