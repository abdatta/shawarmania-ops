#!/usr/bin/env node
// The bill identity is written in three places and all three must agree:
// `billTotals()` in src/domain/billing.ts, the check constraints on `orders`
// and `bills`, and `billing_validate_totals` in SQL. A drift between them does
// not fail a test on its own — it refuses live bills at a counter.
//
// `src/domain/billing-totals-cases.json` is the one table of cases they are all
// held to. TypeScript reads it directly. SQL cannot, so the pgTAP suite carries
// a copy between two markers, and this check fails the lint when that copy
// stops matching — printing the exact block to paste, so keeping them in step
// is a copy rather than a puzzle.
//
// Same shape as check-todos-index.mjs and check-specs-index.mjs: one invariant
// between two files that no type system can see.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const casesPath = path.join(root, 'src/domain/billing-totals-cases.json')
const sqlPath = path.join(root, 'supabase/tests/47_bill_discount_arithmetic.sql')

const BEGIN = '-- BEGIN GENERATED TOTALS CASES'
const END = '-- END GENERATED TOTALS CASES'

const { cases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'))

const rows = cases
  .map((testCase, index) => {
    const { name, subtotal, discount, rounding, total } = testCase
    for (const [key, value] of Object.entries({ subtotal, discount, rounding, total })) {
      if (!Number.isInteger(value)) {
        throw new Error(`case ${index} (${name}): ${key} must be integer paise, got ${value}`)
      }
    }
    // The identity itself, checked here too. A case that does not satisfy it is
    // a broken fixture, and a broken fixture is worse than no fixture: every
    // implementation would have to reproduce the same mistake to go green.
    if (total !== subtotal - discount + rounding) {
      throw new Error(
        `case ${index} (${name}) does not satisfy total = subtotal - discount + rounding: ` +
          `${total} <> ${subtotal} - ${discount} + ${rounding}`,
      )
    }
    const label = name.replace(/'/g, "''")
    const comma = index === cases.length - 1 ? '' : ','
    return `  (${subtotal}, ${discount}, ${rounding}, ${total}, '${label}')${comma}`
  })
  .join('\n')

const expected = `${BEGIN}\n${rows}\n${END}`

const sql = fs.readFileSync(sqlPath, 'utf8')
const begin = sql.indexOf(BEGIN)
const end = sql.indexOf(END)

if (begin === -1 || end === -1) {
  console.error(`✗ ${path.relative(root, sqlPath)} is missing the generated-cases markers.`)
  console.error(`\nExpected a block delimited by:\n  ${BEGIN}\n  ${END}\n`)
  process.exit(1)
}

const actual = sql.slice(begin, end + END.length)

if (actual.replace(/\r/g, '') !== expected) {
  console.error(
    `✗ The totals cases in ${path.relative(root, sqlPath)} have drifted from ` +
      `${path.relative(root, casesPath)}.`,
  )
  console.error('\nReplace the block between the markers with:\n')
  console.error(expected)
  console.error('')
  process.exit(1)
}

console.log(`Bill totals cases are in sync (${cases.length} cases).`)
