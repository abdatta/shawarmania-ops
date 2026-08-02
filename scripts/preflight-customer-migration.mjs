/**
 * Read-only rehearsal for the global-customer-identity migration (#32).
 *
 * Run this against production BEFORE applying
 * `20260802000002_global_customer_identity.sql`. It asks the same two questions
 * the migration asks inside its own transaction — is every phone a recognisable
 * Indian mobile, and does any phone carry two different names — and answers them
 * without changing a row.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/preflight-customer-migration.mjs
 *
 * It prints COUNTS and row ids. It never prints a phone number or a customer
 * name: a migration rehearsal is not a reason to put the customer directory in a
 * terminal history, a CI log, or a screenshot in a chat thread.
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizeIndianPhone } from '../shared/phone.ts'

/**
 * The whole decision, as a pure function over rows, so the interesting part is
 * testable without a database.
 *
 * Two rows merge when they normalize to one phone and their nonblank names
 * agree — case and surrounding whitespace being presentation, not identity.
 * Anything else is a conflict, and a conflict is a question for a person.
 */
export function classifyCustomerRows(rows) {
  const invalid = []
  const byPhone = new Map()

  for (const row of rows) {
    const canonical = normalizeIndianPhone(row.phone)
    if (canonical === null) {
      invalid.push(row.id)
      continue
    }
    const group = byPhone.get(canonical) ?? []
    group.push(row)
    byPhone.set(canonical, group)
  }

  const mergeable = []
  const conflicting = []

  for (const group of byPhone.values()) {
    if (group.length < 2) continue

    const names = new Set(
      group.map((row) => (row.name ?? '').trim().toLowerCase()).filter((name) => name.length > 0),
    )
    const ids = group.map((row) => row.id).sort()
    if (names.size > 1) conflicting.push(ids)
    else mergeable.push(ids)
  }

  return {
    total: rows.length,
    distinctPhones: byPhone.size,
    invalidPhoneIds: invalid,
    mergeableGroups: mergeable,
    conflictingGroups: conflicting,
    /** The migration aborts on either of these, so the operator must clear them first. */
    blocked: invalid.length > 0 || conflicting.length > 0,
  }
}

/**
 * Only the three columns the decision needs. `outlet_id` is deliberately not
 * selected, so this same script runs unchanged before and after the migration
 * that drops it — which is what makes it usable as an "is this already done?"
 * check as well as a rehearsal.
 */
export async function readCustomerRows({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Customer migration preflight needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  const endpoint = new URL('/rest/v1/customers?select=id,name,phone', supabaseUrl)
  const response = await fetchImpl(endpoint, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`Could not read customers: HTTP ${response.status}.`)
  }
  return response.json()
}

export async function preflightCustomerMigration(config) {
  return classifyCustomerRows(await readCustomerRows(config))
}

function report(result) {
  const lines = [
    'Customer migration preflight (read-only)',
    '',
    `  customer rows ........................ ${result.total}`,
    `  distinct canonical phones ............ ${result.distinctPhones}`,
    `  rows with an unusable phone .......... ${result.invalidPhoneIds.length}`,
    `  phones that merge cleanly ............ ${result.mergeableGroups.length}`,
    `  phones with conflicting names ........ ${result.conflictingGroups.length}`,
    '',
  ]

  if (result.invalidPhoneIds.length > 0) {
    lines.push('  Rows whose phone is missing or not a recognisable Indian mobile:')
    for (const id of result.invalidPhoneIds) lines.push(`    ${id}`)
    lines.push('')
  }
  if (result.conflictingGroups.length > 0) {
    lines.push('  Rows that normalize to one phone but disagree about the name:')
    for (const ids of result.conflictingGroups) lines.push(`    ${ids.join('  ')}`)
    lines.push('')
  }

  lines.push(
    result.blocked
      ? '  BLOCKED. Resolve the rows above by hand; the migration will refuse to guess.'
      : '  Clear to migrate.',
  )
  return lines.join('\n')
}

async function main() {
  const result = await preflightCustomerMigration({
    supabaseUrl: process.env['SUPABASE_URL'],
    serviceKey: process.env['SUPABASE_SERVICE_ROLE_KEY'],
  })
  console.log(report(result))
  if (result.blocked) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Customer migration preflight failed.')
    process.exitCode = 1
  })
}
