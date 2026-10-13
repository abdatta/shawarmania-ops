#!/usr/bin/env node
/**
 * Build `dist/` for one browser suite before Playwright starts:
 *
 *   node scripts/build-for-e2e.mjs demo|auth
 *
 * Each suite's Playwright config builds the app itself, which is right on a
 * laptop and slow in CI: the build waits for the browser install, and in the
 * auth jobs for the whole Supabase stack, although it needs neither. CI runs
 * this beside them instead and sets `E2E_PREBUILT=1`, so the suite's webServer
 * only serves what was built here.
 *
 * The backend each suite is wired to lives in `e2e/support/backends.json`, which
 * both Playwright configs read too. `vite build` only, without `tsc`: the
 * typecheck is its own gate in `verify.yml`, run once rather than once per shard.
 *
 *   node scripts/build-for-e2e.mjs --check demo|auth
 *
 * is what a prebuilt webServer runs before serving. Both suites build into the
 * same `dist/` against different backends, and serving whichever build happens
 * to be on disk is the failure `playwright.auth.config.ts` describes: every
 * step fails as if the product were broken. So the build leaves a note of its
 * backend inside `dist/`, which any other build empties, and the check refuses
 * a `dist/` this suite did not build.
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const backends = JSON.parse(readFileSync(new URL('../e2e/support/backends.json', import.meta.url)))
const MARKER = new URL('../dist/.e2e-backend.json', import.meta.url)

const check = process.argv[2] === '--check'
const suite = process.argv[check ? 3 : 2]
if (!backends[suite]) {
  process.stderr.write(
    `Usage: node scripts/build-for-e2e.mjs [--check] ${Object.keys(backends).join('|')}\n`,
  )
  process.exit(2)
}

// The same precedence as the configs: a value set in the environment wins.
const backend = Object.fromEntries(
  Object.entries(backends[suite]).map(([name, value]) => [name, process.env[name] ?? value]),
)
const expected = JSON.stringify({ suite, ...backend })

if (check) {
  let found = null
  try {
    found = readFileSync(MARKER, 'utf8')
  } catch {
    // No marker: not built by this script, or emptied by another build since.
  }
  if (found !== expected) {
    process.stderr.write(
      `dist/ was not built for the ${suite} suite: run \`node scripts/build-for-e2e.mjs ${suite}\`, or unset E2E_PREBUILT.\n`,
    )
    process.exit(1)
  }
  process.exit(0)
}

const child = spawn('npx vite build', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...backend },
})
child.on('exit', (code, signal) => {
  if (code === 0) writeFileSync(MARKER, expected)
  process.exit(code ?? (signal ? 1 : 0))
})
