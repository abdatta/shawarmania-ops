#!/usr/bin/env node
// A menu discount is stored on each line it reduced, so the row a person reads
// is a sum over lines — and it is summed in two places that cannot share one
// implementation: `groupMenuDiscounts()` in src/domain/discount-rows.ts, over a
// draft the counter is still composing and which has no rows in the database;
// and `public.bill_public_discount_rows()` in SQL, for the customer's receipt,
// which must perform no arithmetic on the page.
//
// A drift between them does not fail a test on its own. It shows a customer
// different discount rows from the ones the till showed them.
//
// `src/domain/discount-row-cases.json` is the one table both are held to.
// TypeScript reads it directly. SQL cannot, so `52_what_the_receipt_says.sql`
// carries a copy between markers, and this check fails the lint when the copy
// drifts — printing the exact blocks to paste, so keeping them in step is a copy
// rather than a puzzle.
//
// Same shape as check-totals-cases.mjs, which does this for the bill identity.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const casesPath = path.join(root, 'src/domain/discount-row-cases.json')
const sqlPath = path.join(root, 'supabase/tests/52_what_the_receipt_says.sql')

const LINES_BEGIN = '-- BEGIN GENERATED DISCOUNT ROW LINES'
const LINES_END = '-- END GENERATED DISCOUNT ROW LINES'
const ROWS_BEGIN = '-- BEGIN GENERATED DISCOUNT ROW EXPECTATIONS'
const ROWS_END = '-- END GENERATED DISCOUNT ROW EXPECTATIONS'

const { cases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'))

const quote = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`)

const integer = (context, key, value) => {
  if (!Number.isInteger(value)) {
    throw new Error(`${context}: ${key} must be integer paise, got ${value}`)
  }
  return value
}

const lineRows = []
const expectationRows = []

for (const [index, testCase] of cases.entries()) {
  const context = `case ${index} (${testCase.name})`

  let lineDiscounts = 0
  for (const [lineIndex, line] of testCase.lines.entries()) {
    integer(context, 'unitPricePaise', line.unitPricePaise)
    integer(context, 'quantity', line.quantity)
    integer(context, 'discountPaise', line.discountPaise)
    if (line.discountPercentBp !== null) {
      integer(context, 'discountPercentBp', line.discountPercentBp)
    }
    // A line cannot be discounted below nothing, which the database refuses too.
    if (line.discountPaise > line.unitPricePaise * line.quantity) {
      throw new Error(`${context}: line ${lineIndex} is discounted past its own total`)
    }
    lineDiscounts += line.discountPaise
    lineRows.push(
      `  (${quote(testCase.name)}, ${lineIndex}, ${quote(line.itemName)}, ` +
        `${line.unitPricePaise}, ${line.quantity}, ${line.discountPaise}, ` +
        `${line.discountPercentBp === null ? 'null' : line.discountPercentBp}, ` +
        `${quote(line.categoryName)})`,
    )
  }

  let rowTotal = 0
  for (const [rowIndex, row] of testCase.rows.entries()) {
    integer(context, 'amountPaise', row.amountPaise)
    if ((row.basis === 'percent') !== (row.valueBp !== null)) {
      throw new Error(`${context}: row ${rowIndex} pairs basis ${row.basis} with the wrong value`)
    }
    rowTotal += row.amountPaise
    const categories = `array[${row.categories.map(quote).join(', ')}]::text[]`
    expectationRows.push(
      `  (${quote(testCase.name)}, ${rowIndex}, ${quote(row.basis)}, ` +
        `${row.valueBp === null ? 'null' : row.valueBp}, ` +
        `${row.valuePaise === null ? 'null' : row.valuePaise}, ` +
        `${categories}, ${row.amountPaise})`,
    )
  }

  // The fixture has to be a bill before it can prove anything about one. A
  // broken fixture is worse than none: every implementation would have to
  // reproduce the same mistake to go green.
  if (rowTotal !== lineDiscounts) {
    throw new Error(
      `${context}: the expected rows sum to ${rowTotal} but its lines discount ${lineDiscounts}`,
    )
  }
}

const block = (begin, end, rows) =>
  `${begin}\n${rows.length === 0 ? '' : `${rows.join(',\n')};\n`}${end}`

const expected = {
  [LINES_BEGIN]: block(LINES_BEGIN, LINES_END, lineRows),
  [ROWS_BEGIN]: block(ROWS_BEGIN, ROWS_END, expectationRows),
}

const sql = fs.readFileSync(sqlPath, 'utf8').replace(/\r/g, '')
let failed = false

for (const [begin, end] of [
  [LINES_BEGIN, LINES_END],
  [ROWS_BEGIN, ROWS_END],
]) {
  const from = sql.indexOf(begin)
  const to = sql.indexOf(end)
  if (from === -1 || to === -1) {
    console.error(`✗ ${path.relative(root, sqlPath)} is missing the markers:\n  ${begin}\n  ${end}`)
    failed = true
    continue
  }
  const actual = sql.slice(from, to + end.length)
  if (actual !== expected[begin]) {
    console.error(
      `✗ The block after ${begin} in ${path.relative(root, sqlPath)} has drifted from ` +
        `${path.relative(root, casesPath)}.\n`,
    )
    console.error('Replace it with:\n')
    console.error(expected[begin])
    console.error('')
    failed = true
  }
}

if (failed) process.exit(1)

console.log(`Discount row cases are in sync (${cases.length} cases).`)
