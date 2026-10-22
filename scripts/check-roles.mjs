#!/usr/bin/env node
/**
 * A staff role is never listed by name outside the one place that says which
 * role includes which (staff-roles-include-other-roles, design D5).
 *
 * Biller became staff in August by going round every place that said
 * `'employee'` and adding `'biller'` beside it: 19 database objects and a dozen
 * app files. Those lists became one question, *does a role this person holds
 * here include this one?*, asked of `public.staff_role_includes` in the
 * database and of `src/data-access/role-includes.ts` in the app. This check
 * keeps it that way, so the next role is an includes row and not another trip
 * round the codebase.
 *
 * What it refuses:
 *
 * - **In the app**, an array literal or a single line that names two staff
 *   roles, which is a staff list kept by hand. Naming one role to route to its
 *   own shell (`role === 'biller'` choosing the counter) is not a staff list
 *   and passes.
 * - **In a migration after this change's**, a role compared to a staff role by
 *   name (`role = 'biller'`, `role in ('employee', …)`) and a staff role passed
 *   to `app_has_role_at` or `app_outlets_for`. Ask `app_role_includes`,
 *   `app_acts_as` or `app_outlets_acting_as` instead. `'biller'` as a discount
 *   source is not a role and passes.
 *
 * A line that must name staff roles for another reason says so, on that line
 * or the one above: `// roles-lint: allow <reason>` in the app,
 * `-- roles-lint: allow <reason>` in SQL.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = () => fileURLToPath(new URL('..', import.meta.url))

/** The migration that wrote which role includes which; history before it is left alone. */
export const INCLUDES_MIGRATION = '20261101000000'

const STAFF = ['employee', 'biller']
const ALLOW = /roles-lint:\s*allow\s+\S/

const quoted = (role) => new RegExp(`['"]${role}['"]`)
const namesBoth = (text) => STAFF.every((role) => quoted(role).test(text))

/** The app files this applies to: source, not tests, fixtures or generated types. */
export function appliesToAppFile(path) {
  return (
    /^src\/.*\.(ts|tsx)$/.test(path) &&
    !/\.test\.(ts|tsx)$/.test(path) &&
    !path.startsWith('src/test/') &&
    !path.startsWith('src/data-access/mock/fixtures/') &&
    path !== 'src/data-access/database.types.ts' &&
    path !== 'src/data-access/role-includes.ts'
  )
}

/** The hand-kept staff lists in one app file, as `line: text`. Pure. */
export function findAppStaffLists(source) {
  const lines = source.split('\n')
  const found = []
  const allowed = (index) => ALLOW.test(lines[index] ?? '') || ALLOW.test(lines[index - 1] ?? '')
  lines.forEach((line, index) => {
    if (allowed(index) || /^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (namesBoth(line)) found.push(`${index + 1}: ${line.trim()}`)
  })
  // An array spread over several lines: `[\n 'biller',\n 'employee',\n]`.
  for (const match of source.matchAll(/\[[^\][]*\]/g)) {
    const text = match[0]
    const index = source.slice(0, match.index).split('\n').length - 1
    if (!text.includes('\n') || !namesBoth(text) || ALLOW.test(text) || allowed(index)) continue
    found.push(`${index + 1}: ${text.replace(/\s+/g, ' ').trim()}`)
  }
  return found
}

const ROLE_CHECKS = [
  /\bapp_(?:has_role_at|outlets_for)\s*\(\s*'(?:employee|biller)'/i,
  /\brole\s*(?:=|<>|!=)\s*'(?:employee|biller)'/i,
  /\brole\s+(?:not\s+)?in\s*\([^)]*'(?:employee|biller)'/i,
  /'(?:employee|biller)'\s*::\s*(?:public\.)?app_role\b/i,
]

/** The by-name staff checks in one migration's SQL, as `line: text`. Pure. */
export function findSqlRoleChecks(sql) {
  const found = []
  const lines = sql.split('\n')
  lines.forEach((raw, index) => {
    if (ALLOW.test(raw) || ALLOW.test(lines[index - 1] ?? '')) return
    const line = raw.replace(/--.*$/, '')
    if (ROLE_CHECKS.some((check) => check.test(line))) found.push(`${index + 1}: ${raw.trim()}`)
  })
  return found
}

function main() {
  const root = repoRoot()
  const tracked = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ).split('\0')

  const violations = []
  for (const path of tracked) {
    let source
    try {
      if (appliesToAppFile(path)) {
        source = readFileSync(join(root, path), 'utf8')
        for (const hit of findAppStaffLists(source)) violations.push(`${path}:${hit}`)
      } else if (
        /^supabase\/migrations\/\d{14}_.*\.sql$/.test(path) &&
        path.split('/').pop().slice(0, 14) > INCLUDES_MIGRATION
      ) {
        source = readFileSync(join(root, path), 'utf8')
        for (const hit of findSqlRoleChecks(source)) violations.push(`${path}:${hit}`)
      }
    } catch {
      continue // deleted in the working tree but not yet staged
    }
  }

  if (violations.length > 0) {
    console.error('Staff roles named outside src/data-access/role-includes.ts:\n')
    for (const violation of violations) console.error(`  ${violation}`)
    console.error(
      '\nAsk which role includes which instead: includes, isStaffRole or STAFF_ROLES_BY_SENIORITY from src/data-access/role-includes.ts in the app; app_role_includes, app_acts_as or app_outlets_acting_as in SQL. A line that must name roles for another reason ends with `roles-lint: allow <reason>`.',
    )
    process.exit(1)
  }
  console.log('Every staff check asks which role includes which.')
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
