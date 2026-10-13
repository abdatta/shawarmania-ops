import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { commandsOf, environmentOf, jobsOf, needsOf, workflowConcurrency } from './lib/workflow.mjs'

/**
 * Promote and the staging pipeline (a-release-can-be-switched-off, D19, D20).
 * Promotion moves the same commit staging ran, after staging verified it, with
 * the owner's approval; Deploy then skips the suite staging already ran. No file
 * can prove the rulesets or the environment's reviewer — `docs/RELEASES.md` says
 * how to read them — so this pins the shapes.
 */

const workflow = (name) => readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8')

describe('Promote', () => {
  const yaml = workflow('promote.yml')

  it('is run by hand, defaulting to the newest commit on stage that Staging verified', () => {
    expect(yaml).toMatch(/^ {2}workflow_dispatch:\s*$/m)
    expect(yaml).not.toMatch(/^ {2}push:/m)
    const check = commandsOf(yaml, 'check')
    expect(check).not.toMatch(/git rev-parse origin\/stage/)
    expect(check).toMatch(/workflows\/staging\.yml\/runs\?status=success/)
    expect(check).toMatch(/git rev-list origin\/main\.\.origin\/stage/)
  })

  it('lists what it leaves on stage, so a docs-only tip is seen waiting', () => {
    expect(commandsOf(yaml, 'check')).toMatch(/git log --reverse .*"\$SHA"\.\.origin\/stage/)
  })

  it('requires a successful Staging run on exactly that commit, and a fast-forward', () => {
    const check = commandsOf(yaml, 'check')
    expect(check).toMatch(/workflows\/staging\.yml\/runs\?head_sha=\$SHA&status=success/)
    expect(check).toMatch(/git merge-base --is-ancestor "\$SHA" origin\/stage/)
    expect(check).toMatch(/git merge-base --is-ancestor origin\/main "\$SHA"/)
  })

  it('pushes only after the owner approves, with the deploy key, never by force', () => {
    expect(needsOf(yaml, 'promote')).toEqual(['check'])
    expect(environmentOf(yaml, 'promote')).toBe('production-promote')
    const push = commandsOf(yaml, 'promote')
    expect(push).toMatch(/ssh-key: \$\{\{ secrets\.PROMOTE_DEPLOY_KEY \}\}/)
    expect(push).toMatch(/git push origin "\$SHA:refs\/heads\/main"/)
    expect(push).not.toMatch(/--force|-f /)
    expect(jobsOf(yaml)).toEqual(['check', 'promote'])
  })
})

describe('Staging', () => {
  const yaml = workflow('staging.yml')

  it('runs on a push to stage, the suite first, then staging’s release in Deploy’s order', () => {
    expect(yaml).toMatch(/^ {4}branches: \[stage\]\s*$/m)
    expect(needsOf(yaml, 'gate')).toEqual([])
    expect(new Set(needsOf(yaml, 'migrate'))).toEqual(new Set(['awake', 'descends', 'gate']))
    expect(needsOf(yaml, 'functions')).toEqual(['migrate'])
    expect(new Set(needsOf(yaml, 'publish'))).toEqual(
      new Set(['gate', 'build', 'migrate', 'functions']),
    )
    expect(needsOf(yaml, 'smoke')).toEqual(['publish'])
  })

  it('keeps each job to the environment holding only what it needs', () => {
    expect(environmentOf(yaml, 'migrate')).toBe('staging-database')
    expect(environmentOf(yaml, 'functions')).toBe('staging-functions')
    expect(environmentOf(yaml, 'publish')).toBe('staging-pages')
    expect(environmentOf(yaml, 'smoke')).toBe('staging-smoke')
  })

  it('refuses production’s project wherever it touches a project', () => {
    for (const job of ['awake', 'migrate', 'functions', 'build']) {
      expect(commandsOf(yaml, job), job).toMatch(/iefcidjbfnmsiqithqbj/)
    }
    expect(commandsOf(yaml, 'build')).toMatch(/VITE_APP_ENVIRONMENT: staging/)
  })

  it('seeds whatever staging is missing, after migrating and before publishing', () => {
    const migrate = commandsOf(yaml, 'migrate')
    expect(migrate).toMatch(/node scripts\/seed-staging\.mjs --if-empty/)
    expect(migrate.indexOf('supabase db push')).toBeLessThan(migrate.indexOf('seed-staging.mjs'))
  })

  it('smokes only at its own outlet, never as Cafe Staging’s accounts or tablets', () => {
    const smoke = readFileSync(resolve(process.cwd(), 'e2e-staging/smoke.spec.ts'), 'utf8')
    const seed = readFileSync(resolve(process.cwd(), 'supabase/staging/seed.sql'), 'utf8')
    expect(seed).toMatch(/'smoke-tests', 'Smoke tests'/)
    expect(smoke).toMatch(/staging\.smoke\.manager/)
    expect(smoke).toMatch(/staging\.smoke\.biller/)
    expect(smoke).not.toMatch(/'staging\.(manager|biller|counter|kitchen)'/)
  })

  it('refuses a rewritten stage that no longer contains main, before staging moves', () => {
    expect(commandsOf(yaml, 'descends')).toMatch(/git merge-base --is-ancestor origin\/main HEAD/)
    expect(commandsOf(yaml, 'descends')).toMatch(/fetch-depth: 0/)
    expect(needsOf(yaml, 'migrate')).toContain('descends')
  })

  it('says in one sentence when the staging project is paused', () => {
    expect(commandsOf(yaml, 'awake')).toMatch(/resume it from the staging account's dashboard/)
  })

  it('never cancels a staging run mid-publish', () => {
    expect(workflowConcurrency(yaml)).toBe('staging')
    expect(yaml).toMatch(/cancel-in-progress: false/)
  })
})

describe('Staging reset', () => {
  const yaml = workflow('staging-reset.yml')

  it('is manual, refuses production, never applies the local seed, and re-seeds synthetically', () => {
    expect(yaml).not.toMatch(/^ {2}push:/m)
    const reset = commandsOf(yaml, 'reset')
    expect(reset).toMatch(/iefcidjbfnmsiqithqbj/)
    expect(reset).toMatch(/supabase db reset --db-url "\$SUPABASE_DB_URL" --no-seed/)
    expect(reset).toMatch(/node scripts\/seed-staging\.mjs/)
  })
})

describe('Deploy runs the suite only for a commit Staging did not verify', () => {
  const yaml = workflow('deploy.yml')

  it('looks for a Staging run first, and skips the suite only when one succeeded', () => {
    expect(commandsOf(yaml, 'staged')).toMatch(
      /workflows\/staging\.yml\/runs\?head_sha=\$SHA&status=success/,
    )
    expect(needsOf(yaml, 'gate')).toEqual(['staged'])
    expect(commandsOf(yaml, 'gate')).toMatch(/if: needs\.staged\.outputs\.verified != 'true'/)
  })

  it('migrates and publishes after a green or skipped suite, never after a red one', () => {
    for (const job of ['migrate', 'deploy']) {
      expect(commandsOf(yaml, job), job).toMatch(
        /\(needs\.gate\.result == 'success' \|\| needs\.gate\.result == 'skipped'\)/,
      )
      expect(commandsOf(yaml, job), job).toMatch(/!cancelled\(\)/)
    }
  })
})
