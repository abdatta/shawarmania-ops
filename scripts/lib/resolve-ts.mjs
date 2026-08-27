/**
 * Let a plain Node script import `src/` TypeScript directly.
 *
 * Node 22 strips types happily, but it does not do bundler-style module
 * resolution: `import { x } from './money'` inside a `.ts` file is an
 * extensionless ESM specifier, and Node refuses it. The repo's `tsconfig.json`
 * sets `moduleResolution: "bundler"`, so every module under `src/` is written
 * that way and none of it will change to suit a script.
 *
 * So the script adapts instead. This hook tries `.ts` (then `.tsx`, then
 * `/index.ts`) for a relative specifier Node could not resolve, and also
 * understands the `@/` path alias.
 *
 * **Why this exists rather than a copy of the arithmetic.** A rehearsal that
 * reimplements the module it is rehearsing proves that two pieces of code agree
 * with each other, which is not the question. `scripts/rehearse-august-drawer.mjs`
 * has to run the *real* `src/domain/drawer.ts` for its result to mean anything.
 *
 * Deliberately not used by anything that ships: the application is built by
 * Vite, and the test suites run under Vitest. This is for scripts only.
 */

import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function firstExisting(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`
    if (existsSync(candidate)) return candidate
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The `@/*` -> `./src/*` alias from tsconfig.json.
    if (specifier.startsWith('@/')) {
      const resolved = firstExisting(path.join(ROOT, 'src', specifier.slice(2)))
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true }
    }

    if (specifier.startsWith('.')) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        const parent = context.parentURL
        if (!parent) throw error
        const resolved = firstExisting(path.resolve(path.dirname(fileURLToPath(parent)), specifier))
        if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true }
        throw error
      }
    }

    return nextResolve(specifier, context)
  },
})
