#!/usr/bin/env node
/**
 * Enforce that the living-spec index maps every current capability exactly once.
 *
 * A capability is deliberately a narrow filesystem concept: one direct child
 * directory of `openspec/specs/` containing `spec.md`. The index remains
 * authored prose, so this rule only compares those directories with relative
 * `<capability>/spec.md` links; it never generates, reorders, or rewrites the
 * README.
 *
 * Both directions are drift:
 *
 *   - a **missing capability** has a `spec.md` but no index link;
 *   - a **dangling capability link** names a directory that is gone or lacks
 *     its `spec.md`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const INDEX_FILE = 'README.md'

/** Resolve only when the CLI runs so importing the pure rule stays reliable. */
const specsDir = () => fileURLToPath(new URL('../openspec/specs', import.meta.url))

/** A relative direct link to one capability's living spec, optionally anchored. */
const CAPABILITY_LINK = /\]\((?:\.\/)?([\w.-]+)\/spec\.md(?:#[^)]*)?\)/g

/**
 * Compare direct living-spec directories with the capability links in the index.
 *
 * Pure on purpose: callers supply the directory facts and README text, making
 * every drift direction testable without writing a fixture to disk.
 *
 * @param {{ entries: { name: string, isDirectory: boolean, hasSpec: boolean }[], indexMarkdown: string }} input
 * @returns {{ missing: string[], dangling: string[] }}
 */
export function findLivingSpecIndexDrift({ entries, indexMarkdown }) {
  const capabilities = entries
    .filter((entry) => entry.isDirectory && entry.hasSpec)
    .map((entry) => entry.name)

  const linked = new Set()
  for (const [, capability] of indexMarkdown.matchAll(CAPABILITY_LINK)) {
    linked.add(capability)
  }

  return {
    missing: capabilities.filter((capability) => !linked.has(capability)).sort(),
    dangling: [...linked].filter((capability) => !capabilities.includes(capability)).sort(),
  }
}

function main() {
  const directory = specsDir()
  const entries = readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    hasSpec:
      entry.isDirectory() &&
      existsSync(resolve(directory, entry.name, 'spec.md')) &&
      statSync(resolve(directory, entry.name, 'spec.md')).isFile(),
  }))
  const { missing, dangling } = findLivingSpecIndexDrift({
    entries,
    indexMarkdown: readFileSync(resolve(directory, INDEX_FILE), 'utf8'),
  })

  if (missing.length === 0 && dangling.length === 0) {
    console.log('Living-spec index is in sync.')
    return
  }

  if (missing.length > 0) {
    process.stderr.write(`✕ ${missing.length} living capability(s) missing from the index:\n`)
    for (const capability of missing)
      process.stderr.write(`  openspec/specs/${capability}/spec.md\n`)
    process.stderr.write('  Add a capability link to openspec/specs/README.md.\n')
  }

  if (dangling.length > 0) {
    process.stderr.write(`✕ ${dangling.length} index capability link(s) are gone:\n`)
    for (const capability of dangling)
      process.stderr.write(`  openspec/specs/${capability}/spec.md\n`)
    process.stderr.write('  Remove the link or restore the capability spec.\n')
  }

  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
