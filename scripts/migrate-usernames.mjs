#!/usr/bin/env node

import { createHash } from 'node:crypto'
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
    approvedEmails: new Set(),
    approvedBy: null,
    stopAfter: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (
      [
        '--dry-run',
        '--approve-mapping',
        '--apply',
        '--postflight',
        '--rollback',
        '--destroy-mapping',
      ].includes(arg)
    ) {
      options.mode = arg.slice(2)
    } else if (arg === '--mapping') {
      options.mapping = path.resolve(argv[++index] ?? '')
    } else if (arg === '--checkpoint') {
      options.checkpoint = path.resolve(argv[++index] ?? '')
    } else if (arg === '--approve-email') {
      options.approvedEmails.add(argv[++index] ?? '')
    } else if (arg === '--approved-by') {
      options.approvedBy = argv[++index]?.trim() || null
    } else if (arg === '--stop-after') {
      const value = Number(argv[++index])
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('--stop-after requires a positive integer')
      }
      options.stopAfter = value
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
  const source = profile?.full_name || ''
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30)
  return canonicalUsername(normalized)
}

export function buildMapping({ users, profiles, assignments, accountEmails, approvedEmails }) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const accountEmailById = new Map(accountEmails.map((row) => [row.profile_id, row.email]))
  const ownerIds = new Set(
    assignments
      .filter((assignment) => assignment.role === 'super_admin' && assignment.ended_on === null)
      .map((assignment) => assignment.person_id),
  )
  const proposed = users.map((user) => {
    const owner = ownerIds.has(user.id)
    const emailApproved = approvedEmails.has(user.id)
    const username = proposedUsername(user, profileById.get(user.id))
    const candidateEmail =
      accountEmailById.get(user.id) ??
      (user.email && !PLACEHOLDER.test(user.email) && !authAliasToUsername(user.email)
        ? user.email.toLowerCase()
        : null)
    const accountEmail = emailApproved ? candidateEmail : null
    return {
      userId: user.id,
      oldEmail: user.email ?? null,
      username,
      newAlias: username ? usernameToAuthAlias(username) : null,
      isOwner: owner,
      accountEmail,
      emailApproved,
      status: 'pending',
      flags: [
        ...(user.email && PLACEHOLDER.test(user.email) ? ['placeholder_address'] : []),
        ...(!username ? ['username_needs_review'] : []),
        ...(owner && !accountEmail ? ['owner_account_email_missing'] : []),
        ...(candidateEmail && !emailApproved ? ['account_email_needs_approval'] : []),
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
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceUrl: process.env.SUPABASE_URL,
    approval: null,
    users: proposed,
  }
}

function approvalMaterial(mapping) {
  return (mapping.users ?? [])
    .map((row) => ({
      userId: row.userId,
      oldEmail: row.oldEmail,
      username: row.username,
      newAlias: row.newAlias,
      isOwner: row.isOwner,
      accountEmail: row.accountEmail,
      emailApproved: row.emailApproved,
    }))
    .sort((left, right) => String(left.userId).localeCompare(String(right.userId)))
}

export function mappingFingerprint(mapping) {
  return createHash('sha256')
    .update(JSON.stringify(approvalMaterial(mapping)))
    .digest('hex')
}

export function validateMapping(mapping, { requireApproval = true } = {}) {
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
    if (row.isOwner && (!row.accountEmail || !row.emailApproved)) {
      errors.push(`${row.userId}: Super Admin account email is missing or not approved`)
    }
    if (row.accountEmail && !row.emailApproved) {
      errors.push(`${row.userId}: retained account email is not approved`)
    }
    if (row.flags?.includes('username_collision') || row.flags?.includes('username_needs_review')) {
      errors.push(`${row.userId}: unresolved username review flag`)
    }
  }
  if (
    requireApproval &&
    (!mapping.approval?.approvedAt ||
      !mapping.approval?.approvedBy ||
      mapping.approval?.fingerprint !== mappingFingerprint(mapping))
  ) {
    errors.push('the complete mapping has not been owner-approved, or changed after approval')
  }
  return errors
}

async function dryRun(options, config) {
  const [users, profiles, assignments, accountEmails] = await Promise.all([
    loadAuthUsers(config),
    loadRows(config, 'profiles', 'id,full_name,is_active'),
    loadRows(config, 'assignments', 'person_id,role,outlet_id,ended_on'),
    loadRows(config, 'account_emails', 'profile_id,email').catch(() => []),
  ])
  const mapping = buildMapping({
    users,
    profiles,
    assignments,
    accountEmails,
    approvedEmails: options.approvedEmails,
  })
  await writePrivateJson(options.mapping, mapping)
  const flagged = mapping.users.filter((row) => row.flags.length > 0)
  console.log(`Dry run mapped ${mapping.users.length} Auth users.`)
  console.log(`Private mapping: ${options.mapping}`)
  console.log(`Rows requiring review or owner approval: ${flagged.length}`)
  for (const row of flagged) {
    console.log(`${row.userId}: ${row.flags.join(', ')}`)
  }
}

async function approveMapping(options) {
  if (!options.approvedBy) {
    throw new Error('--approve-mapping requires --approved-by after the owner reviews every row')
  }
  const mapping = await readJson(options.mapping)
  const errors = validateMapping(mapping, { requireApproval: false })
  if (errors.length > 0) {
    throw new Error(`Approval refused:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
  mapping.approval = {
    approvedAt: new Date().toISOString(),
    approvedBy: options.approvedBy,
    fingerprint: mappingFingerprint(mapping),
  }
  await writePrivateJson(options.mapping, mapping)
  console.log(`Owner approval sealed for all ${mapping.users.length} mapped users.`)
}

async function setAccountEmail(config, row) {
  if (!row.accountEmail) {
    await request(
      config,
      `/rest/v1/account_emails?profile_id=eq.${encodeURIComponent(row.userId)}`,
      {
        method: 'DELETE',
      },
    )
    return
  }
  await request(config, '/rest/v1/account_emails?on_conflict=profile_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      profile_id: row.userId,
      email: row.accountEmail,
    }),
  })
}

async function updateAuthEmail(config, userId, email) {
  await request(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({ email, email_confirm: true }),
  })
}

export function validateCurrentAuthUsers(mapping, users) {
  const errors = []
  const mappedById = new Map((mapping.users ?? []).map((row) => [row.userId, row]))
  const currentById = new Map(users.map((user) => [user.id, user]))

  for (const user of users) {
    if (!mappedById.has(user.id)) {
      errors.push(`${user.id}: current Auth user is absent from the approved mapping`)
    }
  }
  for (const row of mapping.users ?? []) {
    const current = currentById.get(row.userId)
    if (!current) {
      errors.push(`${row.userId}: approved mapping user no longer exists`)
    } else if (current.email !== row.oldEmail && current.email !== row.newAlias) {
      errors.push(`${row.userId}: Auth identifier drifted after the mapping was generated`)
    }
  }
  return errors
}

async function applyMapping(options, config) {
  const mapping = await readJson(options.mapping)
  const errors = validateMapping(mapping)
  const currentUsers = await loadAuthUsers(config)
  errors.push(...validateCurrentAuthUsers(mapping, currentUsers))
  if (errors.length > 0) {
    throw new Error(`Apply refused:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }

  const checkpoint = await readJson(options.checkpoint).catch(() => ({
    version: 1,
    completedUserIds: [],
  }))
  const completed = new Set(checkpoint.completedUserIds)
  let appliedThisRun = 0
  for (const row of mapping.users) {
    if (completed.has(row.userId)) continue
    await setAccountEmail(config, row)
    await updateAuthEmail(config, row.userId, row.newAlias)
    completed.add(row.userId)
    row.status = 'applied'
    checkpoint.completedUserIds = [...completed]
    checkpoint.updatedAt = new Date().toISOString()
    await writePrivateJson(options.checkpoint, checkpoint)
    await writePrivateJson(options.mapping, mapping)
    console.log(`Applied ${row.userId}`)
    appliedThisRun += 1
    if (options.stopAfter !== null && appliedThisRun >= options.stopAfter) {
      throw new Error(
        `Rehearsal interruption requested after ${appliedThisRun} user; rerun --apply to resume`,
      )
    }
  }
  console.log(`Applied ${completed.size} users; rerunning --apply is idempotent.`)
}

export function auditMigrationState({ mapping, users, assignments, accountEmails, invites, now }) {
  const checkedAt = now ?? new Date().toISOString()
  const checkedAtMs = new Date(checkedAt).getTime()
  const mappedById = new Map(mapping.users.map((row) => [row.userId, row]))
  const mappedIds = new Set(mappedById.keys())
  const userIds = new Set(users.map((user) => user.id))
  const userById = new Map(users.map((user) => [user.id, user]))
  const liveOwners = new Set(
    assignments
      .filter((row) => row.role === 'super_admin' && row.ended_on === null)
      .map((row) => row.person_id),
  )
  const accountEmailById = new Map(accountEmails.map((row) => [row.profile_id, row.email]))
  const findings = []

  for (const user of users) {
    if (!mappedIds.has(user.id)) {
      findings.push(`${user.id}: current Auth user is absent from the approved mapping`)
    }
    if (!authAliasToUsername(user.email)) {
      findings.push(`${user.id}: Auth identifier is not a canonical reserved alias`)
    }
  }
  for (const row of mapping.users) {
    const current = userById.get(row.userId)
    if (!current) {
      findings.push(`${row.userId}: approved mapping user no longer exists`)
    } else if (authAliasToUsername(current.email) !== row.username) {
      findings.push(`${row.userId}: Auth alias does not match the approved username`)
    }
  }
  for (const ownerId of liveOwners) {
    if (!accountEmailById.has(ownerId)) {
      findings.push(`${ownerId}: live owner has no account email`)
    }
  }
  for (const row of mapping.users) {
    if ((accountEmailById.get(row.userId) ?? null) !== (row.accountEmail ?? null)) {
      findings.push(`${row.userId}: account email differs from the approved mapping`)
    }
  }
  for (const profileId of accountEmailById.keys()) {
    if (!mappedById.has(profileId)) {
      findings.push(`${profileId}: account email belongs to a user outside the approved mapping`)
    }
  }
  for (const invite of invites.filter(
    (row) =>
      row.consumed_at === null &&
      row.superseded_at === null &&
      new Date(row.expires_at).getTime() > checkedAtMs,
  )) {
    if (
      !userIds.has(invite.profile_id) ||
      !authAliasToUsername(userById.get(invite.profile_id)?.email)
    ) {
      findings.push(`${invite.profile_id}: live pending invite has no canonical username`)
    }
  }

  return {
    checkedAt,
    users: users.length,
    liveOwners: liveOwners.size,
    accountEmails: accountEmails.length,
    livePendingInvites: invites.filter(
      (row) =>
        row.consumed_at === null &&
        row.superseded_at === null &&
        new Date(row.expires_at).getTime() > checkedAtMs,
    ).length,
    findings,
  }
}

async function postflight(options, config) {
  const mapping = await readJson(options.mapping)
  const mappingErrors = validateMapping(mapping)
  if (mappingErrors.length > 0) {
    throw new Error(`Postflight refused:\n${mappingErrors.map((error) => `- ${error}`).join('\n')}`)
  }
  const [users, assignments, accountEmails, invites] = await Promise.all([
    loadAuthUsers(config),
    loadRows(config, 'assignments', 'person_id,role,ended_on'),
    loadRows(config, 'account_emails', 'profile_id,email'),
    loadRows(config, 'account_invites', 'profile_id,consumed_at,superseded_at,expires_at'),
  ])
  const report = auditMigrationState({
    mapping,
    users,
    assignments,
    accountEmails,
    invites,
  })
  await writePrivateJson(path.join(path.dirname(options.mapping), 'postflight.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.findings.length > 0) process.exitCode = 1
}

async function rollback(options, config) {
  const mapping = await readJson(options.mapping)
  const errors = validateMapping(mapping)
  if (errors.length > 0) {
    throw new Error(`Rollback refused:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
  const checkpoint = await readJson(options.checkpoint).catch(() => ({
    version: 1,
    completedUserIds: [],
  }))
  const completed = new Set(checkpoint.completedUserIds)
  for (const row of [...mapping.users].reverse()) {
    if (!row.oldEmail) throw new Error(`${row.userId}: rollback email is missing`)
    await updateAuthEmail(config, row.userId, row.oldEmail)
    row.status = 'rolled_back'
    completed.delete(row.userId)
    checkpoint.completedUserIds = [...completed]
    checkpoint.updatedAt = new Date().toISOString()
    await writePrivateJson(options.checkpoint, checkpoint)
    await writePrivateJson(options.mapping, mapping)
    console.log(`Rolled back ${row.userId}`)
  }
  await writePrivateJson(path.join(path.dirname(options.mapping), 'rollback.json'), {
    rolledBackAt: new Date().toISOString(),
    users: mapping.users.length,
    accountEmailsRetained: true,
    note: 'The active schema requires every live Super Admin account email to remain. Returning to the final model is a forward username repair.',
  })
}

async function destroyMapping(options) {
  const mapping = requirePrivatePath(options.mapping)
  const checkpoint = requirePrivatePath(options.checkpoint)
  await rm(mapping, { force: true })
  await rm(checkpoint, { force: true })
  await rm(path.join(path.dirname(mapping), 'postflight.json'), { force: true })
  await rm(path.join(path.dirname(mapping), 'rollback.json'), { force: true })
  console.log('Sensitive mapping, checkpoint, and postflight files removed.')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  options.mapping = requirePrivatePath(options.mapping)
  options.checkpoint = requirePrivatePath(options.checkpoint)
  if (options.mode === 'destroy-mapping') return await destroyMapping(options)

  if (options.mode === 'approve-mapping') return await approveMapping(options)

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
