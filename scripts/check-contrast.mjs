#!/usr/bin/env node
/**
 * Contrast validator. Fails the build when a semantic token pair drops below
 * AA in either theme. Runs from any agent or a plain shell: `npm run contrast`.
 */

import { UNGATED, validateTokens } from './lib/contrast.mjs'

const { results, failures } = validateTokens()

const width = Math.max(...results.map((result) => result.label.length))
let currentTheme = ''

for (const result of results) {
  if (result.theme !== currentTheme) {
    currentTheme = result.theme
    process.stdout.write(`\n  ${currentTheme.toUpperCase()}\n`)
  }
  const mark = result.passed ? '✓' : '✗'
  const ratio = `${result.ratio.toFixed(2)}:1`.padStart(8)
  const via = result.via && result.label.includes('|') ? `  via ${result.via}` : ''
  process.stdout.write(
    `  ${mark} ${result.label.padEnd(width)}${ratio}  (min ${result.min})${via}\n`,
  )
}

process.stdout.write(`\n  Not gated:\n`)
for (const exemption of UNGATED) process.stdout.write(`  · ${exemption}\n`)

if (failures.length > 0) {
  process.stderr.write(`\n✗ ${failures.length} contrast failure(s):\n`)
  for (const failure of failures) {
    process.stderr.write(
      `  ${failure.theme}: ${failure.label} is ${failure.ratio.toFixed(2)}:1, ` +
        `needs ${failure.min}:1 — ${failure.note}\n`,
    )
  }
  process.exit(1)
}

process.stdout.write(`\n✓ ${results.length} pairs pass AA across both themes.\n`)
