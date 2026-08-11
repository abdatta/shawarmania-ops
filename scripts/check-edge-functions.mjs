#!/usr/bin/env node
/**
 * Enforce that every Edge Function declares its gateway authentication.
 *
 * `supabase/config.toml` carries one `[functions.<name>]` block per function,
 * and the only thing in it that matters at the gateway is `verify_jwt`. A
 * function with no block at all does not fail: it silently receives the
 * platform default, `verify_jwt = true`, and the gateway then refuses every
 * unauthenticated request before the function's own code runs.
 *
 * For three of the five functions here that default is correct. For
 * `redeem-invite` and `counter-setup` it is fatal, because both exist precisely
 * to answer a caller who holds no token: somebody who has never set a password,
 * and a tablet that has never been set up. Undeclared, they would answer 401 to
 * every legitimate request while looking perfectly healthy in the dashboard —
 * and `counter-setup`'s 401 reaches a person standing at a counter as a
 * rejected setup code, blaming the one thing that was not at fault.
 *
 * So this checks the cheap half of that: **that the judgement was made**, not
 * which way it went. Which way is a decision the config's own comments record
 * per function, and a check that asserted a particular value would just be the
 * config written twice.
 *
 * The other half cannot be checked from here at all. A block can declare
 * `verify_jwt = false` and the platform can still be serving an older
 * deployment that verifies. `docs/OPERATIONS.md` carries the live probe for
 * that — an unauthenticated POST with a junk payload must be answered by the
 * function's own refusal (400) and not the gateway's (401) — and the two checks
 * are deliberately not merged: this one runs offline on every commit, that one
 * needs a deployed project.
 *
 * Written after `counter-devices` and `counter-setup` spent two days undeployed
 * because nothing in the repo had an opinion about Edge Functions. The release
 * now deploys every directory it finds; this makes sure a directory it finds is
 * one somebody configured.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Shared code bundled into each function. Not a function, has no endpoint. */
const NOT_A_FUNCTION = new Set(['_shared'])

/**
 * Resolved inside the CLI entry rather than at module load, for the same reason
 * `check-todos-index.mjs` does it: the exported rule is the module's contract
 * and must import cleanly under the test runner, which rewrites
 * `import.meta.url` to something `fileURLToPath` rejects.
 */
const functionsDir = () => fileURLToPath(new URL('../supabase/functions', import.meta.url))
const configFile = () => fileURLToPath(new URL('../supabase/config.toml', import.meta.url))

/**
 * Function names declared in a TOML document.
 *
 * Hand-rolled rather than parsed, matching `check-workflow-path-tiers.test.mjs`:
 * no TOML library is in the dependency tree and a table header does not justify
 * adding one. The header must be the whole line, so a commented-out block does
 * not count as a declaration — which is the case worth getting right, because
 * commenting a block out is exactly how one would be lost.
 */
export function declaredFunctions(toml) {
  const names = new Set()
  for (const line of toml.split(/\r?\n/)) {
    const header = line.match(/^\s*\[functions\.([\w-]+)\]\s*$/)
    if (header) names.add(header[1])
  }
  return names
}

/**
 * Compare the functions on disk against the ones the configuration declares.
 *
 * Pure on purpose: the caller supplies the directory listing and the config
 * text, so the rule is testable without a fixture tree on disk.
 *
 * @param {{ entries: string[], toml: string }} input
 * @returns {{ undeclared: string[], orphaned: string[] }}
 */
export function findFunctionConfigDrift({ entries, toml }) {
  const functions = entries.filter((name) => !NOT_A_FUNCTION.has(name))
  const declared = declaredFunctions(toml)

  return {
    undeclared: functions.filter((name) => !declared.has(name)).sort(),
    // A block naming a function that no longer exists is harmless at the
    // gateway and still worth reporting: it is the residue of a deleted
    // function, and it makes the config read as though something is served
    // that is not.
    orphaned: [...declared].filter((name) => !functions.includes(name)).sort(),
  }
}

function main() {
  const { undeclared, orphaned } = findFunctionConfigDrift({
    entries: readdirSync(functionsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    toml: readFileSync(configFile(), 'utf8'),
  })

  if (undeclared.length === 0 && orphaned.length === 0) {
    console.log('Every Edge Function declares its gateway authentication.')
    return
  }

  if (undeclared.length > 0) {
    process.stderr.write(`✗ ${undeclared.length} Edge Function(s) with no configuration block:\n`)
    for (const name of undeclared) process.stderr.write(`  supabase/functions/${name}\n`)
    process.stderr.write(
      '  Add [functions.<name>] with verify_jwt to supabase/config.toml.\n' +
        '  Undeclared means verify_jwt = true, which refuses a token-free caller\n' +
        '  at the gateway before the function runs.\n',
    )
  }

  if (orphaned.length > 0) {
    process.stderr.write(
      `✗ ${orphaned.length} configuration block(s) for a function that is gone:\n`,
    )
    for (const name of orphaned) process.stderr.write(`  [functions.${name}]\n`)
    process.stderr.write('  Remove the block from supabase/config.toml.\n')
  }

  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
