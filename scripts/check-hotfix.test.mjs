import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  allNeedsOf,
  commandsOf,
  concurrencyOf,
  environmentOf,
  jobsOf,
  needsOf,
  workflowConcurrency,
} from './lib/workflow.mjs'

/**
 * Hotfix (a-release-can-be-switched-off, D17): the owner-approved way forward
 * when the counter is down. A short gate, the owner's approval, then Deploy's
 * order. No file can prove the environment's reviewer is the owner — that is a
 * repository setting, checked by the runbook in docs/OPERATIONS.md — so this
 * pins everything else: nothing that changes production starts before the
 * approval, and it runs in the same order as Deploy.
 */

const workflow = (name) => readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8')
const yaml = workflow('hotfix.yml')
const PRODUCTION_JOBS = ['migrate', 'functions', 'deploy']

describe('Hotfix', () => {
  it('is run by hand with a commit SHA and a reason', () => {
    expect(yaml).toMatch(/^ {2}workflow_dispatch:\s*\n {4}inputs:\s*\n {6}sha:/m)
    expect(yaml).toMatch(/^ {6}reason:\s*\n(?: {8}.*\n)*? {8}required: true/m)
    expect(yaml).not.toMatch(/^ {2}push:/m)
  })

  it('runs the short gate first: lint, typecheck and unit tests', () => {
    const gate = commandsOf(yaml, 'check')
    for (const command of ['npm run lint', 'npm run typecheck', 'npm test']) {
      expect(gate).toContain(command)
    }
    expect(gate).toMatch(/git merge-base --is-ancestor origin\/main "\$SHA"/)
  })

  it('holds every job that changes production behind the owner’s approval', () => {
    expect(environmentOf(yaml, 'approve')).toBe('production-hotfix')
    expect(needsOf(yaml, 'approve')).toEqual(['check'])
    for (const job of PRODUCTION_JOBS) {
      expect(allNeedsOf(yaml, job), `${job} must wait for the approval`).toContain('approve')
      expect(allNeedsOf(yaml, job), `${job} must wait for the gate`).toContain('check')
    }
  })

  it('goes in Deploy’s order: migrate, then functions, then publish', () => {
    expect(needsOf(yaml, 'functions')).toContain('migrate')
    expect(new Set(needsOf(yaml, 'deploy'))).toEqual(
      new Set(['check', 'build', 'approve', 'migrate', 'functions']),
    )
  })

  it('keeps each production job in the environment that holds its secret', () => {
    expect(environmentOf(yaml, 'migrate')).toBe('production-database')
    expect(environmentOf(yaml, 'functions')).toBe('production-functions')
    expect(environmentOf(yaml, 'deploy')).toBe('github-pages')
    expect(commandsOf(yaml, 'functions')).toMatch(/refusing to guess a project/)
    expect(commandsOf(yaml, 'functions')).not.toMatch(/--prune/)
  })

  it('stops any Deploy still running for another commit once approved', () => {
    expect(commandsOf(yaml, 'approve')).toMatch(/select\(\.head_sha != \\"\$SHA\\"\)/)
    expect(commandsOf(yaml, 'approve')).toMatch(/runs\/\$run\/cancel/)
  })

  it('moves main to the fix only after publishing, with the deploy key and the owner’s approval', () => {
    expect(needsOf(yaml, 'main')).toEqual(['deploy'])
    expect(environmentOf(yaml, 'main')).toBe('production-hotfix')
    const main = commandsOf(yaml, 'main')
    expect(main).toMatch(/ssh-key: \$\{\{ secrets\.PROMOTE_DEPLOY_KEY \}\}/)
    expect(main).toMatch(/git push origin "\$SHA:refs\/heads\/main"/)
    expect(main).not.toMatch(/--force|-f /)
  })

  it('requires the fix to be on stage once stage exists', () => {
    expect(commandsOf(yaml, 'check')).toMatch(/git merge-base --is-ancestor "\$SHA" origin\/stage/)
  })

  it('has no job beyond the seven it is made of', () => {
    expect(jobsOf(yaml)).toEqual([
      'check',
      'build',
      'approve',
      'migrate',
      'functions',
      'deploy',
      'main',
    ])
  })
})

describe('publications never overlap, and a run that is only verifying blocks nothing', () => {
  it('puts pages on the publishing job of Deploy, Republish and Hotfix, and nowhere else', () => {
    for (const name of ['deploy.yml', 'republish.yml', 'hotfix.yml']) {
      expect(concurrencyOf(workflow(name), 'deploy'), name).toBe('pages')
      expect(workflowConcurrency(workflow(name)), name).not.toBe('pages')
    }
  })

  it('keeps Deploy runs one at a time, and one migration run at a time across Deploy and Hotfix', () => {
    expect(workflowConcurrency(workflow('deploy.yml'))).toBe('deploy')
    expect(concurrencyOf(workflow('deploy.yml'), 'migrate')).toBe('production-migrations')
    expect(concurrencyOf(yaml, 'migrate')).toBe('production-migrations')
  })

  it('has replaced the incident’s unchecked publisher', () => {
    expect(existsSync(resolve(process.cwd(), '.github/workflows/emergency-rollback.yml'))).toBe(
      false,
    )
  })
})
