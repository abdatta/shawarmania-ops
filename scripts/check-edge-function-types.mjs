import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export function edgeFunctionTypeEntrypoints(root = resolve(process.cwd(), 'supabase/functions')) {
  return [resolve(root, '_shared', 'restaurant-mappings.ts')]
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
