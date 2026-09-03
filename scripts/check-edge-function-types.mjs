import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export function edgeFunctionTypeEntrypoints(root = resolve(process.cwd(), 'supabase/functions')) {
  // The shared modules that *decide* things, rather than the handlers that call
  // them: `restaurant-mappings.ts` maps a channel's restaurant ids onto outlets
  // and `run-outcome.ts` chooses the word a run records. `tsc` cannot see either,
  // because the app project excludes `supabase/functions`, so without this gate
  // they are typechecked by nothing.
  return [
    resolve(root, '_shared', 'restaurant-mappings.ts'),
    resolve(root, '_shared', 'run-outcome.ts'),
  ]
}

/**
 * Where Deno is, when the shell has not been told.
 *
 * The official installer drops the binary in `~/.deno/bin` and leaves adding it
 * to `PATH` to a shell profile — which a non-interactive `npm run` on Windows
 * does not load. The gate then reported "Deno is required… install Deno 2.x" to
 * developers who had Deno installed and working, every session, so it was read
 * as noise and skipped. Looking in the install directory costs one `existsSync`
 * and removes a whole class of false alarm.
 *
 * `PATH` still wins where it is set, so a version manager or a Homebrew install
 * is unaffected.
 */
function resolveDeno() {
  const binary = process.platform === 'win32' ? 'deno.exe' : 'deno'
  const onPath = spawnSync(binary, ['--version'], { stdio: 'ignore' })
  if (!onPath.error) return binary

  const candidates = [
    join(homedir(), '.deno', 'bin', binary),
    join(homedir(), '.local', 'bin', binary),
    '/usr/local/bin/deno',
    '/opt/homebrew/bin/deno',
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? binary
}

export function checkEdgeFunctionTypes(entries = edgeFunctionTypeEntrypoints()) {
  /*
    `--node-modules-dir=none`: resolve npm dependencies from Deno's own global
    cache and leave this repo's `node_modules` alone.

    Both halves matter. `restaurant-mappings.ts` imports the Supabase client
    from JSR, and that package pulls npm dependencies of its own — so with a
    `package.json` present, Deno defaults to looking for them in `node_modules`,
    finds a tree npm installed for the browser build, and fails on the first
    transitive package that is not a direct dependency of this repo. That is the
    error this gate has been producing locally.

    The documented remedy is `auto`, and it is the wrong one here: `auto` makes
    Deno *manage* `node_modules`, which replaces npm's own `@supabase/*`
    installs with symlinks into `node_modules/.deno`. Two package managers
    owning one directory is a bad trade for a typecheck. `none` asks the same
    question without touching anything npm owns.
  */
  const result = spawnSync(
    resolveDeno(),
    ['check', '--no-lock', '--node-modules-dir=none', ...entries],
    { stdio: 'inherit' },
  )

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Deno is required for Edge Function type checking. Install Deno 2.x and retry — ' +
          'the installer puts it in ~/.deno/bin, which this script looks in even when ' +
          'PATH does not mention it.',
      )
    }
    throw result.error
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

const invokedAsScript =
  process.argv[1] && basename(process.argv[1]) === 'check-edge-function-types.mjs'

if (invokedAsScript) checkEdgeFunctionTypes()
