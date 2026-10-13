import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AUTH_SHARDS, AUTH_SHARD_TOTAL, authShardFilter } from '../e2e-auth/shards.ts'
import { commandsOf, jobBlock, jobsOf } from './lib/workflow.mjs'

/**
 * `verify.yml` is split across runners for speed and for nothing else: every
 * gate CI ran before the split still runs, for every code change. A split is
 * where a gate goes missing quietly — a shard nobody runs, a spec file in no
 * shard, a step moved into a job that is skipped — and the run stays green
 * because the thing that would have failed never ran. This pins it.
 *
 * Resolved from the working directory, as `check-workflow-path-tiers.test.mjs`
 * explains.
 */
const yaml = readFileSync(resolve(process.cwd(), '.github/workflows/verify.yml'), 'utf8')
const all = jobsOf(yaml)
  .map((job) => commandsOf(yaml, job))
  .join('\n')

/** A job's shard list and the total its name claims, or null when it is not split. */
function matrixOf(job) {
  const block = jobBlock(yaml, job) ?? ''
  const shards = /^ {8}shard:\s*\[([^\]]*)\]\s*$/m.exec(block)
  if (!shards) return null
  const named = /^ {4}name:.*\/(\d+)\)\s*$/m.exec(block)
  return {
    shards: shards[1].split(',').map((shard) => Number(shard.trim())),
    named: Number(named?.[1]),
  }
}

describe('verify.yml runs every gate', () => {
  it.each([
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm run functions:typecheck',
    'npm run contrast',
    'npm run build',
    'npm test ',
    'npm run test:e2e ',
    'npm run test:e2e:on ',
    'npm run test:db',
    'npm run test:rls',
    'npm run test:e2e:auth\n',
    'npm run test:e2e:auth:on\n',
    'npm run db:types',
    'git diff --exit-code src/data-access/database.types.ts',
  ])('%s', (command) => {
    expect(`${all}\n`).toContain(command)
  })

  it('runs pgTAP, then the REST probes, then the types check, on the stack it started', () => {
    const db = commandsOf(yaml, 'db')
    const order = ['supabase start', 'npm run test:db', 'npm run test:rls', 'npm run db:types'].map(
      (command) => db.indexOf(command),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('a split suite runs every shard', () => {
  const split = jobsOf(yaml).filter((job) => matrixOf(job))

  it('splits the unit tests and all four browser suites', () => {
    expect(split).toEqual(['unit', 'e2e', 'e2e-gates-on', 'auth', 'auth-gates-on'])
  })

  it.each(['unit', 'e2e', 'e2e-gates-on', 'auth', 'auth-gates-on'])(
    '%s runs shards 1..n and says n in its name',
    (job) => {
      const { shards, named } = matrixOf(job)
      expect(shards).toEqual(Array.from({ length: shards.length }, (_, i) => i + 1))
      expect(named).toBe(shards.length)
      expect(commandsOf(yaml, job)).toContain('${{ matrix.shard }}/${{ strategy.job-total }}')
      expect(jobBlock(yaml, job)).toMatch(/^ {6}fail-fast: false$/m)
    },
  )

  it('splits the auth suite as e2e-auth/shards.ts does', () => {
    expect(matrixOf('auth').shards).toHaveLength(AUTH_SHARD_TOTAL)
    expect(matrixOf('auth-gates-on').shards).toHaveLength(AUTH_SHARD_TOTAL)
    for (const job of ['auth', 'auth-gates-on']) {
      expect(commandsOf(yaml, job)).toMatch(/E2E_AUTH_SHARD: \$\{\{ matrix\.shard \}\}/)
    }
  })
})

describe('e2e-auth/shards.ts', () => {
  const specs = readdirSync(resolve(process.cwd(), 'e2e-auth')).filter((file) =>
    file.endsWith('.spec.ts'),
  )

  /** Whether one shard's filter selects a spec file, read the way Playwright reads `**\/<file>`. */
  function selects(filter, file) {
    if ('testMatch' in filter) return filter.testMatch.includes(`**/${file}`)
    if ('testIgnore' in filter) return !filter.testIgnore.includes(`**/${file}`)
    return true
  }

  it('names only spec files that exist', () => {
    for (const file of AUTH_SHARDS.flat()) expect(specs).toContain(file)
  })

  it('runs every spec file in exactly one shard', () => {
    const filters = Array.from({ length: AUTH_SHARD_TOTAL }, (_, i) =>
      authShardFilter(`${i + 1}/${AUTH_SHARD_TOTAL}`),
    )
    for (const file of specs) {
      expect(
        filters.filter((filter) => selects(filter, file)),
        file,
      ).toHaveLength(1)
    }
  })

  it('runs the whole suite when no shard is named, as locally', () => {
    expect(authShardFilter(undefined)).toEqual({})
  })

  it('refuses a shard total the file does not declare', () => {
    expect(() => authShardFilter(`1/${AUTH_SHARD_TOTAL + 1}`)).toThrow(/E2E_AUTH_SHARD/)
    expect(() => authShardFilter(`0/${AUTH_SHARD_TOTAL}`)).toThrow(/E2E_AUTH_SHARD/)
  })
})

describe('a browser suite serves only a build made for it', () => {
  it.each([
    ['e2e', 'demo'],
    ['e2e-gates-on', 'demo'],
    ['auth', 'auth'],
    ['auth-gates-on', 'auth'],
  ])('%s builds for the %s backend and runs prebuilt', (job, suite) => {
    const commands = commandsOf(yaml, job)
    expect(commands).toContain(`node scripts/build-for-e2e.mjs ${suite}`)
    expect(commands).toMatch(/E2E_PREBUILT: 1/)
  })

  it.each([
    ['playwright.config.ts', 'demo'],
    ['playwright.auth.config.ts', 'auth'],
  ])('%s checks the prebuilt dist/ is its own before serving it', (config, suite) => {
    const source = readFileSync(resolve(process.cwd(), config), 'utf8')
    expect(source).toContain(`node scripts/build-for-e2e.mjs --check ${suite}`)
  })
})
