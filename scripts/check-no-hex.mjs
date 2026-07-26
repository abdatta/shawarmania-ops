#!/usr/bin/env node
/**
 * Enforce the token layering: hex colour literals live only in the brand layer.
 *
 * A franchise re-skin must be a one-file change, and it stops being one the
 * first time a component hard-codes `#f97316`. Scans everything under src/
 * except the token source file itself.
 *
 * Known exemption outside this scan: the PWA manifest in vite.config.ts, where
 * `background_color` and `theme_color` must be literal colours by spec — a
 * manifest cannot reference a CSS custom property.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const TOKEN_FILE = join(SRC, 'styles', 'tokens.css')
const EXTENSIONS = ['.ts', '.tsx', '.css', '.html']

/** 3-, 4-, 6- or 8-digit hex, so `#root` and the like are not false positives. */
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (EXTENSIONS.some((extension) => path.endsWith(extension))) yield path
  }
}

const violations = []

for (const path of walk(SRC)) {
  if (path === TOKEN_FILE) continue

  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const match of line.matchAll(HEX)) {
      violations.push({ file: relative(ROOT, path), line: index + 1, value: match[0] })
    }
  })
}

if (violations.length > 0) {
  process.stderr.write(`✗ ${violations.length} hex colour literal(s) outside the brand layer:\n`)
  for (const violation of violations) {
    process.stderr.write(`  ${violation.file}:${violation.line}  ${violation.value}\n`)
  }
  process.stderr.write(
    `\nComponents read semantic tokens. Add the value to src/styles/tokens.css and reference it.\n`,
  )
  process.exit(1)
}

process.stdout.write('✓ No hex colour literals outside src/styles/tokens.css\n')
