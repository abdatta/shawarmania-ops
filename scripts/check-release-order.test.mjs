import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A release is three things landing in dependency order: the schema, the
 * privileged code that calls the schema, and the bundle that calls that code.
 *
 * The order is the whole guarantee, and it is expressed entirely in `needs:`
 * edges that GitHub evaluates silently. Reverse one and nothing errors: the
 * workflow still runs, still goes green, and simply publishes a bundle before
 * the thing it calls exists. That is precisely what happened without any edge
 * at all — `counter-devices` and `counter-setup` were outside the workflow
 * entirely, so the counter tablet handshake shipped to production and answered
 * 404 for two days while every check stayed green.
 *
 * Nothing else can catch a reversed or dropped edge. The suite cannot run the
 * deployment, and the deployment only reveals the mistake by making it. Hence
 * this: cheap, offline, and reading the one file the guarantee lives in.
 *
 * Editing a workflow is itself a full-suite change (`.github/**` is deliberately
 * absent from the path-tier ignore lists), so this runs on exactly the commits
 * that could break it.
 */

/**
 * Resolved from the runner's working directory, which Vitest sets to the repo
 * root, for the same reason `check-workflow-path-tiers.test.mjs` does it.
 */
const deploy = () => readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')

/**
 * The `needs:` of one job, in either YAML spelling: `needs: gate` or
 * `needs: [gate, build]`.
 *
 * Hand-rolled rather than parsed, matching the sibling test: no YAML library is
 * in the dependency tree and two scalar spellings do not justify adding one.
 */
export function readNeeds(yaml, job) {
  const lines = yaml.split(/\r?\n/)
  const header = new RegExp(`^ {2}${job}:\\s*$`)
  const start = lines.findIndex((line) => header.test(line))
  if (start === -1) return null

  for (const line of lines.slice(start + 1)) {
    // Stop at the next job rather than running on into it.
    if (/^ {2}\w[\w-]*:\s*$/.test(line)) break
    const list = line.match(/^\s*needs:\s*\[([^\]]*)\]\s*$/)
    if (list)
      return list[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    const one = line.match(/^\s*needs:\s*([\w-]+)\s*$/)
    if (one) return [one[1]]
  }
  return []
}

describe('the release lands in dependency order', () => {
  it('declares every job the order is made of', () => {
    // Without this the assertions below pass vacuously on a renamed job.
    for (const job of ['gate', 'build', 'migrate', 'functions', 'deploy']) {
      expect(readNeeds(deploy(), job), `deploy.yml lost the ${job} job`).not.toBeNull()
    }
  })

  it('deploys Edge Functions only after the migration they call', () => {
    // A function calls the schema. Deployed first, it is broken for as long as
    // the race lasts, with the previous bundle still calling it.
    expect(readNeeds(deploy(), 'functions')).toContain('migrate')
  })

  it('publishes only after the schema, the functions and the build', () => {
    // The edge that did not exist. A bundle calls a function; published first,
    // it reaches a counter tablet asking for something that is not there.
    expect(new Set(readNeeds(deploy(), 'deploy'))).toEqual(
      new Set(['gate', 'build', 'migrate', 'functions']),
    )
  })

  it('gates the whole release on verification', () => {
    expect(readNeeds(deploy(), 'migrate')).toContain('gate')
    expect(readNeeds(deploy(), 'deploy')).toContain('gate')
  })

  it('names no function in the workflow', () => {
    // The defect this job exists to close was a hand-maintained list that
    // nobody reconciled with the directory. A list here would be the same bug
    // in a new place, so the deploy must stay argument-free.
    const yaml = deploy()
    expect(yaml).toMatch(/functions deploy --project-ref/)
    for (const name of ['counter-devices', 'counter-setup', 'admin-accounts', 'email-sign-in']) {
      expect(yaml, `deploy.yml must not name ${name}`).not.toMatch(
        new RegExp(`functions deploy[^\\n]*${name}`),
      )
    }
  })

  it('never prunes functions absent from the repository', () => {
    // `--prune` turns a bad checkout into production deletions.
    //
    // Asserted against the command lines rather than the whole file: the job's
    // comment explains why the flag is absent, and naming it there must not
    // read as using it.
    const commands = deploy()
      .split(/\r?\n/)
      .filter((line) => /^\s*run:/.test(line) || /supabase functions deploy/.test(line))
      .filter((line) => !/^\s*#/.test(line.trim()))

    expect(commands.some((line) => line.includes('functions deploy'))).toBe(true)
    for (const line of commands) expect(line).not.toMatch(/--prune/)
  })

  it('refuses to guess a project rather than deploying to a default one', () => {
    // An access token that reaches several projects plus a deploy with no
    // explicit ref is the one way this job could put counter code on the wrong
    // database.
    const yaml = deploy()
    expect(yaml).toMatch(/--project-ref/)
    expect(yaml).toMatch(/refusing to guess a project/)
  })
})

describe('the needs reader', () => {
  const yaml = ['jobs:', '  build:', '    runs-on: ubuntu-latest', '  deploy:', '    needs: [gate, build]', '    runs-on: ubuntu-latest'].join('\n') // prettier-ignore

  it('reads a list', () => {
    expect(readNeeds(yaml, 'deploy')).toEqual(['gate', 'build'])
  })

  it('reads a single scalar', () => {
    expect(readNeeds('jobs:\n  functions:\n    needs: migrate\n', 'functions')).toEqual(['migrate'])
  })

  it('reports a job that declares no needs as an empty list', () => {
    expect(readNeeds(yaml, 'build')).toEqual([])
  })

  it('reports a missing job as null rather than an empty list', () => {
    // The distinction the vacuous-pass guard above depends on.
    expect(readNeeds(yaml, 'migrate')).toBeNull()
  })

  it("does not read the next job's needs as this one's", () => {
    expect(readNeeds(yaml, 'build')).not.toContain('gate')
  })
})
