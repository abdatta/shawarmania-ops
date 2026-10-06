#!/usr/bin/env node
/**
 * Every on-screen number pad takes a physical keyboard
 * (keypads-take-a-physical-keyboard, owner 2026-10-06).
 *
 * A counter billing from a laptop, or a tablet with a keyboard attached, types
 * on the pads exactly as it taps: the shared `Modal` presses whichever button
 * carries `data-keypad-key` for the key typed. A pad whose keys are not marked
 * simply ignores the keyboard, and nothing else would notice, so this is
 * checked.
 *
 * Two layers hold the rule. `useKeypadKeys` audits every pad a test opens, by
 * its digits, and fails the test with what is missing. This one reads source,
 * so a pop-up nobody has written a test for is held to it too: a file drawing a
 * pad (a `Delete last digit` key, or a `... keypad` label) must mark that
 * delete key Backspace, mark an Enter action, and mark its digits.
 *
 * A pad that is deliberately not a pop-up is listed in EXEMPT with its reason.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolved when run, not at import: under Vitest `import.meta.url` is rewritten
// to something `fileURLToPath` rejects, as `check-todos-index.mjs` notes.
const repoRoot = () => fileURLToPath(new URL('..', import.meta.url))

const EXEMPT = new Map([
  [
    'src/features/billing/shift-unlock.tsx',
    'the legacy PIN page: a page rather than a pop-up, so the Modal key routing does not reach it',
  ],
])

const count = (source, pattern) => source.match(pattern)?.length ?? 0

/**
 * What one source file's pads are missing, as sentences; empty when it draws no
 * pad or misses nothing. Pure, so it is tested on made-up source.
 */
export function findKeypadFaults(source) {
  const deletes = count(source, /aria-label="Delete last digit"/g)
  const draws = deletes > 0 || /aria-label="[^"]*keypad"/i.test(source)
  if (!draws) return []

  const faults = []
  if (count(source, /data-keypad-key="Backspace"/g) < Math.max(deletes, 1)) {
    faults.push('its delete key is not marked data-keypad-key="Backspace"')
  }
  if (!/data-keypad-key="Enter"/.test(source)) {
    faults.push('no action is marked data-keypad-key="Enter"')
  }
  if (!/data-keypad-key=(\{|"[0-9]")/.test(source)) {
    faults.push('its digit keys are not marked data-keypad-key')
  }
  return faults
}

function main() {
  const root = repoRoot()
  const files = execFileSync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path.endsWith('.tsx') && !/\.test\.tsx$/.test(path) && !EXEMPT.has(path))

  const violations = []
  let pads = 0
  for (const path of files) {
    let source
    try {
      source = readFileSync(join(root, path), 'utf8')
    } catch {
      continue // deleted in the working tree but not yet staged
    }
    if (/aria-label="Delete last digit"|aria-label="[^"]*keypad"/i.test(source)) pads += 1
    for (const fault of findKeypadFaults(source)) violations.push(`${path}: ${fault}`)
  }

  if (violations.length > 0) {
    console.error('Number pads a physical keyboard cannot reach:\n')
    for (const violation of violations) console.error(`  ${violation}`)
    console.error(
      '\nMark each key with data-keypad-key (its digit, ".", "Backspace") and the primary action with data-keypad-key="Enter". See src/components/ui/use-keypad-keys.ts.',
    )
    process.exit(1)
  }
  console.log(`Every number pad takes a physical keyboard (${pads} pads, ${EXEMPT.size} exempt).`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
