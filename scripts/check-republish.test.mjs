import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { commandsOf, concurrencyOf, environmentOf, jobsOf, needsOf } from './lib/workflow.mjs'

/**
 * Republish (a-release-can-be-switched-off, D17): going back to a build the full
 * suite once passed, without running it again. Its whole safety is in its
 * shape — the check comes first, and nothing touches the schema or the
 * functions — so the shape is pinned here.
 */

const yaml = readFileSync(resolve(process.cwd(), '.github/workflows/republish.yml'), 'utf8')

describe('Republish', () => {
  it('is run by hand with one commit SHA', () => {
    expect(yaml).toMatch(/^on:\s*\n {2}workflow_dispatch:\s*\n {4}inputs:\s*\n {6}sha:/m)
    expect(yaml).not.toMatch(/^ {2}push:/m)
  })

  it('asks GitHub for a successful Deploy run on exactly that commit, before anything else', () => {
    const verified = commandsOf(yaml, 'verified')
    expect(verified).toMatch(/actions\/workflows\/deploy\.yml\/runs\?head_sha=\$SHA&status=success/)
    expect(verified).toMatch(/exit 1/)
    expect(needsOf(yaml, 'verified')).toEqual([])
    expect(needsOf(yaml, 'build')).toEqual(['verified'])
    expect(new Set(needsOf(yaml, 'deploy'))).toEqual(new Set(['verified', 'build']))
  })

  it('builds the commit it was given', () => {
    expect(commandsOf(yaml, 'build')).toMatch(/ref: \$\{\{ inputs\.sha \}\}/)
  })

  it('never migrates and never deploys a function', () => {
    for (const job of jobsOf(yaml)) {
      expect(commandsOf(yaml, job)).not.toMatch(/supabase db push|functions deploy/)
    }
    expect(jobsOf(yaml)).toEqual(['verified', 'build', 'deploy'])
  })

  it('publishes in the shared pages group and the github-pages environment', () => {
    expect(concurrencyOf(yaml, 'deploy')).toBe('pages')
    expect(environmentOf(yaml, 'deploy')).toBe('github-pages')
  })
})
