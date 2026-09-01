import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export function edgeFunctionTypeEntrypoints(root = resolve(process.cwd(), 'supabase/functions')) {
  // Both are dependency-free by design, which is what makes them checkable at
  // all: a function body importing the Supabase client cannot resolve here, so
  // the gate covers the shared modules that decide things rather than the
  // handlers that call them. `run-outcome.ts` chooses the word a run records —
  // and `tsc` cannot see it either, because the app project excludes
  // `supabase/functions`, so without this line it is typechecked by nothing.
  return [
    resolve(root, '_shared', 'restaurant-mappings.ts'),
    resolve(root, '_shared', 'run-outcome.ts'),
  ]
}

export function checkEdgeFunctionTypes(entries = edgeFunctionTypeEntrypoints()) {
  const deno = process.platform === 'win32' ? 'deno.exe' : 'deno'
  const result = spawnSync(deno, ['check', '--no-lock', ...entries], { stdio: 'inherit' })

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        'Deno is required for Edge Function type checking. Install Deno 2.x and retry.',
      )
    }
    throw result.error
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

const invokedAsScript =
  process.argv[1] && basename(process.argv[1]) === 'check-edge-function-types.mjs'

if (invokedAsScript) checkEdgeFunctionTypes()
