#!/usr/bin/env node
/**
 * Seed staging with a synthetic history at production's scale
 * (a-release-can-be-switched-off, design D19).
 *
 *   STAGING_SUPABASE_DB_URL=… STAGING_TEST_PASSWORD=… node scripts/seed-staging.mjs
 *   STAGING_TEST_PASSWORD=… node scripts/seed-staging.mjs --local   # rehearse on the local stack
 *   … node scripts/seed-staging.mjs --if-empty   # seed only what staging is missing
 *
 * Runs `supabase/staging/seed.sql` — *Cafe Staging*, an account per role, a generated
 * menu and about three thousand bills rung through the counter's own command; and
 * *Smoke tests*, the smoke suite's own outlet — against the staging database,
 * after refusing anything that names production's project. The Staging workflow
 * runs it with `--if-empty` on every push, which seeds what is missing and leaves
 * what is there alone; the Staging reset workflow runs it after wiping staging.
 *
 * The test accounts' password comes from the environment, never from this
 * repository. It reaches the database inside the statement, written to a
 * temporary file only this process can read and removed when the run ends.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PRODUCTION_REF = 'iefcidjbfnmsiqithqbj'

/** Production's counts, read 2026-10-12 (see the seed's header). */
export const DEFAULT_DAYS = 90
export const DEFAULT_BILLS = 3009

/**
 * Where to seed, or why not. Refuses production's project however the URL is
 * spelled, a URL that is not Postgres, and a password too short to stand
 * between a public address and the owner's test accounts.
 */
export function seedTarget({ url, local, password, days = DEFAULT_DAYS, bills = DEFAULT_BILLS }) {
  if (!password || password.length < 12) {
    throw new Error('STAGING_TEST_PASSWORD must be set, at least 12 characters.')
  }
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(bills) || bills < days) {
    throw new Error('The seed needs at least one day and one bill a day.')
  }
  if (local) return { local: true, days, bills }
  if (!url) throw new Error('STAGING_SUPABASE_DB_URL is not set; pass --local to rehearse locally.')
  if (url.toLowerCase().includes(PRODUCTION_REF)) {
    throw new Error("STAGING_SUPABASE_DB_URL names production's project; refusing.")
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('STAGING_SUPABASE_DB_URL is not a Postgres connection string.')
  }
  return { local: false, url, days, bills }
}

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`

/**
 * The seed with its four `{{…}}` places filled: the password as a quoted literal,
 * the counts as integers, and whether a seeded staging is left alone rather than
 * refused. `supabase db query` runs one statement and keeps no session between
 * runs, so the values travel in the statement itself rather than as settings.
 */
export function seedScript({ password, days, bills, ifEmpty = false }, seedSql) {
  const values = {
    '{{seed.password}}': literal(password),
    '{{seed.days}}': String(Math.trunc(days)),
    '{{seed.bills}}': String(Math.trunc(bills)),
    '{{seed.if_empty}}': ifEmpty ? 'true' : 'false',
  }
  let script = seedSql
  for (const [placeholder, value] of Object.entries(values)) {
    if (!script.includes(placeholder)) throw new Error(`The seed has no ${placeholder}.`)
    script = script.split(placeholder).join(value)
  }
  return script
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const target = seedTarget({
    url: process.env['STAGING_SUPABASE_DB_URL'],
    local: process.argv.includes('--local'),
    password: process.env['STAGING_TEST_PASSWORD'],
    days: Number(process.env['STAGING_SEED_DAYS'] ?? DEFAULT_DAYS),
    bills: Number(process.env['STAGING_SEED_BILLS'] ?? DEFAULT_BILLS),
  })
  const sql = seedScript(
    {
      password: process.env['STAGING_TEST_PASSWORD'],
      days: target.days,
      bills: target.bills,
      ifEmpty: process.argv.includes('--if-empty'),
    },
    readFileSync(join(root, 'supabase/staging/seed.sql'), 'utf8'),
  )

  const dir = mkdtempSync(join(tmpdir(), 'seed-staging-'))
  const file = join(dir, 'seed.sql')
  try {
    writeFileSync(file, sql, { mode: 0o600 })
    const where = target.local ? ['--local'] : ['--db-url', target.url]
    console.log(
      `Seeding ${target.local ? 'the local stack' : 'staging'}: ${target.bills} bills over ${target.days} days…`,
    )
    execFileSync('npx', ['supabase', 'db', 'query', ...where, '--file', file], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
