#!/usr/bin/env node
/**
 * Every tracked text file is UTF-8 with no byte-order mark, and carries no
 * mojibake - the signature of text that was UTF-8, read back as Windows-1252 or
 * Latin-1, and written out again.
 *
 * AGENTS.md has stated the rule since the middle dot reached the owner with a
 * stray A-circumflex in front of it (duplicate-row-mojibake, 2026-08-31). A rule
 * nothing checks came back: the en dash in the Team form's username hint shipped
 * as three characters of noise, and two living specs and two source comments
 * carried broken em dashes, all found on 2026-09-26. So it is checked now.
 *
 * What it looks for:
 *
 * - a BOM (EF BB BF) at the start of a file;
 * - U+00E2 followed by U+20AC - the two characters every mis-decoded curly
 *   quote, dash, ellipsis and bullet begins with;
 * - U+00C2 or U+00C3 followed by a character from U+0080 to U+00BF - a
 *   mis-decoded middle dot, non-breaking space, or accented letter.
 *
 * This file and its test are written in plain ASCII and build those characters
 * from their codes, because an editor or agent tool that rewrites an escape
 * into the character it names would otherwise make the check trip on itself.
 *
 * Dated archives are history and are not rewritten, so they are not scanned.
 * A line that documents the fault itself says so with `encoding-check: allow`.
 * Binary files are recognised by a NUL byte and skipped.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolved when run, not at import: under Vitest `import.meta.url` is rewritten
// to something `fileURLToPath` rejects, as `check-todos-index.mjs` notes.
const repoRoot = () => fileURLToPath(new URL('..', import.meta.url))

const c = (...codes) => String.fromCharCode(...codes)
const MOJIBAKE = new RegExp(`${c(0xe2, 0x20ac)}|[${c(0xc2, 0xc3)}][${c(0x80)}-${c(0xbf)}]`)
const ALLOW = 'encoding-check: allow'
const EXEMPT = [/^openspec\/changes\/archive\//]

/**
 * The faults in one file, as `{ line, reason }`, line 1 for a BOM. Pure, so it
 * is tested on made-up bytes rather than on the repo.
 */
export function findEncodingFaults(bytes) {
  if (bytes.includes(0)) return []
  const faults = []
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    faults.push({ line: 1, reason: 'starts with a byte-order mark' })
  }
  bytes
    .toString('utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      if (MOJIBAKE.test(text) && !text.includes(ALLOW)) {
        faults.push({ line: index + 1, reason: 'mojibake: UTF-8 decoded as Windows-1252' })
      }
    })
  return faults
}

function main() {
  const root = repoRoot()
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path && !EXEMPT.some((pattern) => pattern.test(path)))

  const violations = []
  for (const path of files) {
    let bytes
    try {
      bytes = readFileSync(join(root, path))
    } catch {
      continue // deleted in the working tree but not yet staged
    }
    for (const fault of findEncodingFaults(bytes)) {
      violations.push(`${path}:${fault.line}: ${fault.reason}`)
    }
  }

  if (violations.length > 0) {
    console.error('Text that is not clean UTF-8:\n')
    for (const violation of violations) console.error(`  ${violation}`)
    console.error(
      '\nRestore the intended character (check git history for it) and save the file as UTF-8 without a BOM.',
    )
    process.exit(1)
  }
  console.log(`Every tracked text file is clean UTF-8 (${files.length} files).`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
