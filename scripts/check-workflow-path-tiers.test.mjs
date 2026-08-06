import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * CI is split into two tiers by path: the full suite runs on a commit that can
 * change what is built, served or migrated, and a prose tier runs on one that
 * cannot. The split is only safe while the two path lists are exact
 * complements — the moment they drift, a commit can match neither and reach
 * `main` with no checks at all.
 *
 * Nothing else can catch that. The lists live in three separate trigger blocks
 * that GitHub evaluates independently, so a half-finished edit produces no
 * error anywhere; it just quietly stops checking something. Hence this test.
 *
 * Editing a workflow is itself a full-suite change (`.github/**` is deliberately
 * absent from the ignore lists), so this runs on exactly the commits that could
 * break it.
 */

/**
 * Resolved from the runner's working directory, which Vitest sets to the repo
 * root, and NOT from `import.meta.url`: the runner rewrites that to a path
 * `fileURLToPath` resolves against the drive root. Same trap as the check
 * scripts under this directory, different escape — a test reading repo files
 * has a working directory it can trust, so it uses it.
 */
const workflow = (name) => readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8')

/**
 * Read one `paths:` / `paths-ignore:` list out of a workflow.
 *
 * Hand-rolled rather than parsed: no YAML library is in the dependency tree and
 * a list of quoted scalars does not justify adding one. Comments cannot match,
 * because the key must be the whole line.
 */
function readAllPathLists(yaml, key) {
  const lines = yaml.split(/\r?\n/)
  const heading = new RegExp(`^\\s*${key}:\\s*$`)
  const lists = []

  lines.forEach((line, index) => {
    if (!heading.test(line)) return
    const items = []
    for (const next of lines.slice(index + 1)) {
      const item = next.match(/^\s*-\s*'([^']+)'\s*$/)
      if (!item) break
      items.push(item[1])
    }
    lists.push(items)
  })

  return lists
}

/** The single list a workflow declares under `key`, or null if it declares none. */
function readPathList(yaml, key) {
  return readAllPathLists(yaml, key)[0] ?? null
}

const fullSuite = [
  ['ci.yml', 'paths-ignore'],
  ['deploy.yml', 'paths-ignore'],
]

describe('CI path tiers', () => {
  it.each(fullSuite)('%s declares a non-empty prose denylist', (name, key) => {
    expect(readPathList(workflow(name), key)?.length).toBeGreaterThan(0)
  })

  it('the prose tier admits exactly what the full suite ignores', () => {
    const prose = readAllPathLists(workflow('docs.yml'), 'paths')

    // GitHub supports no YAML anchors, so the prose list is written once per
    // event. Every copy has to agree with every denylist or the complement
    // property holds for one event and not the other.
    expect(prose.length, 'docs.yml must declare a list per event').toBeGreaterThan(1)

    for (const [name, key] of fullSuite) {
      for (const copy of prose) {
        // Sets, not sequences: order carries no meaning to GitHub, so requiring
        // it would fail a harmless reordering and teach people to delete the test.
        expect(new Set(readPathList(workflow(name), key)), `${name} drifted from docs.yml`).toEqual(
          new Set(copy),
        )
      }
    }
  })

  /**
   * Coverage is a property of (event × path), not of paths alone. `ci.yml` runs
   * on pull requests and `deploy.yml` on a push to `main`; a prose tier that
   * covered only pull requests would leave a prose-only push to `main` matching
   * nothing at all, and this repo pushes to `main` directly. That hole existed
   * in the first draft of this change and this is the assertion that closes it.
   */
  it('covers both events the full suite covers', () => {
    const docs = workflow('docs.yml')
    expect(docs, 'prose tier must run on pull requests').toMatch(/^\s*pull_request:\s*$/m)
    expect(docs, 'prose tier must run on a push to main').toMatch(/^\s*push:\s*$/m)
    expect(docs).toMatch(/^\s*branches: \[main\]\s*$/m)

    expect(workflow('ci.yml')).toMatch(/^\s*pull_request:\s*$/m)
    expect(workflow('deploy.yml')).toMatch(/^\s*push:\s*$/m)
  })

  // The carve-out the design turns on: this file is eslint-linted JavaScript
  // that rewrites the roadmap, so it must never be filtered out of the suite.
  // `openspec/**` would have swallowed it, which is why the three prose
  // directories are named one by one.
  it('never filters out the roadmap reconciler', () => {
    for (const [name, key] of [...fullSuite, ['docs.yml', 'paths']]) {
      const list = readPathList(workflow(name), key)
      expect(list, `${name} must not match openspec/tools`).not.toContain('openspec/tools/**')
      expect(list, `${name} must name prose directories, not all of openspec/`).not.toContain(
        'openspec/**',
      )
    }
  })

  it('leaves deliberate republication unfiltered', () => {
    // `workflow_dispatch` is the rollback and republish path. GitHub applies
    // path filters only to push and pull_request, so the guarantee here is that
    // the trigger still exists and no filter was nested under it.
    const deploy = workflow('deploy.yml')
    expect(deploy).toMatch(/^\s*workflow_dispatch:\s*$/m)
  })
})

describe('the path-list reader', () => {
  const yaml = ["on:", "  push:", "    paths-ignore:", "      - 'docs/**'", "      - '*.md'", "    branches: [main]"].join('\n') // prettier-ignore

  it('reads a list and stops at the next key', () => {
    expect(readPathList(yaml, 'paths-ignore')).toEqual(['docs/**', '*.md'])
  })

  it('ignores a mention inside a comment', () => {
    expect(readPathList(`# paths-ignore: is a denylist\n${yaml}`, 'paths-ignore')).toEqual([
      'docs/**',
      '*.md',
    ])
  })

  it('reports a missing key rather than an empty list', () => {
    expect(readPathList(yaml, 'paths')).toBeNull()
  })
})
