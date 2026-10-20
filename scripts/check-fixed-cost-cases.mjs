#!/usr/bin/env node
// What a month of a fixed cost costs is written twice: `monthCost()` in
// src/domain/fixed-costs.ts, which the screens and the demo fold with, and
// `fixed_cost_month_cost` in SQL, which the pay function recomputes with. A
// drift between them refuses a payment the sheet offered, or stores one it
// did not (fixed-costs-are-spread-over-the-month, design D3).
//
// `src/domain/fixed-cost-cases.json` is the one table of cases both are held
// to. TypeScript reads it directly. SQL cannot, so the pgTAP suite carries a
// copy between two markers, and this check fails the lint when that copy stops
// matching, printing the block to paste. The same shape as check-totals-cases.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const casesPath = path.join(root, 'src/domain/fixed-cost-cases.json')
const sqlPath = path.join(root, 'supabase/tests/97_fixed_costs_are_spread_over_the_month.sql')

const BEGIN = '-- BEGIN GENERATED FIXED COST CASES'
const END = '-- END GENERATED FIXED COST CASES'

const { monthCost } = JSON.parse(fs.readFileSync(casesPath, 'utf8'))

const quote = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`)

const rows = monthCost
  .map((testCase, index) => {
    const { name, startsOn, stopsOn, amounts, settlements, month, costPaise } = testCase
    for (const row of [...amounts, ...settlements, { amountPaise: costPaise }]) {
      if (!Number.isInteger(row.amountPaise)) {
        throw new Error(`case ${index} (${name}): every amount must be integer paise`)
      }
    }
    const comma = index === monthCost.length - 1 ? '' : ','
    return (
      `  (${quote(name)}, ${quote(startsOn)}::date, ${quote(stopsOn)}::date,\n` +
      `   ${quote(JSON.stringify(amounts))}::jsonb,\n` +
      `   ${quote(JSON.stringify(settlements))}::jsonb,\n` +
      `   ${quote(month)}::date, ${costPaise}::bigint)${comma}`
    )
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
if (actual !== expected) {
  console.error(
    `✗ ${path.relative(root, sqlPath)} has drifted from ${path.relative(root, casesPath)}.`,
  )
  console.error('\nReplace the block between the markers with:\n')
  console.error(expected)
  process.exit(1)
}

console.log(`✓ ${monthCost.length} fixed-cost month cases match between TypeScript and SQL.`)
