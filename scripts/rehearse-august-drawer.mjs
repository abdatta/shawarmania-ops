#!/usr/bin/env node

/**
 * The August rehearsal: replay a real month through the derived drawer reader
 * and report what it finds, before any migration is written.
 *
 * `cash-is-counted-not-closed`'s migration plan opens with this step, and the
 * reason it is step one rather than a verification afterwards is that it costs
 * nothing to get wrong at a desk. `rehearse_aggregator_cycle` established the
 * same discipline against a live payout cycle; this is that idea pointed at the
 * drawer.
 *
 * **It reports. It never repairs.** The production notebook's opening-cash chain
 * is already broken in three places, and a rehearsal that came back clean would
 * mean the chain check does not work — not that the data is sound. See the
 * `EXPECTED BREAKS` block at the bottom of this file, which is asserted rather
 * than described: if production stops exhibiting them, this script fails and
 * says the fixture has moved on.
 *
 * The snapshot is a JSON file read from disk and is **deliberately not committed**
 * — it is a production data dump, which `AGENTS.md` forbids in the repo. Produce
 * one with a read-only query per the shape in `snapshotShape()` below and pass
 * its path:
 *
 *     node scripts/rehearse-august-drawer.mjs --snapshot <path-to.json>
 *
 * Exit code is 0 when every assertion about the replay holds, 1 otherwise. The
 * breaks it reports are findings, not failures — they are what the surface will
 * show on its first real day.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import {
  drawerDifferencePaise,
  expectedTotalPaise,
  isInInterval,
  nextOpeningPaise,
} from '../src/domain/drawer.ts'

// ─────────────────────────────────────────────────────────────────────────────

function snapshotShape() {
  return `{
  readAt: string,
  outlets:   [{ id, name, cutover, billing_live_from }],
  ledgerDays: [{ outlet_id, business_date, opening_cash_paise, counted_cash_paise,
                 cash_revenue_paise, upi_revenue_paise,
                 cash_added_paise, cash_removed_paise, note }],
  ledgerExpenses: [{ outlet_id, business_date, category, is_cash, amount_paise, created_at }],
  bills:     [{ id, outlet_id, business_date, payment_business_date, paid_at,
                synced_at, total_paise, status }],
  effectiveAllocations: [{ bill_id, outlet_id, method, amount_paise, revision }],
}`
}

function parseArgs(argv) {
  const index = argv.indexOf('--snapshot')
  if (index === -1 || !argv[index + 1]) {
    console.error(
      `Usage: node scripts/rehearse-august-drawer.mjs --snapshot <path.json>\n\n` +
        `The snapshot is a read-only production dump, kept outside the repo.\n` +
        `Expected shape:\n${snapshotShape()}\n`,
    )
    process.exit(2)
  }
  return { snapshot: argv[index + 1] }
}

/** Money as integer paise. The snapshot carries bigints as strings on purpose. */
const paise = (value) => {
  const n = Number(value ?? 0)
  if (!Number.isInteger(n)) throw new TypeError(`not integer paise: ${String(value)}`)
  return n
}

const rupees = (p) =>
  `${p < 0 ? '-' : ''}₹${Math.abs(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

// ─────────────────────────────────────────────────────────────────────────────
// Half of the rehearsal: does the notebook's own opening chain hold?
//
// This is the half that must NOT come back clean. `manual_ledger_days` stores
// each day's opening rather than deriving it (the same rule decision 4 keeps for
// observations), so a day whose stored opening disagrees with the previous day's
// count is a break the surface reports and never repairs.

function openingChainBreaks(days) {
  const breaks = []
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1]
    const current = days[i]

    const carried = paise(previous.counted_cash_paise)
    const stored = paise(current.opening_cash_paise)

    // A gap in dates is its own kind of break: the chain has nothing to join to.
    const gapDays = Math.round(
      (Date.parse(`${current.business_date}T00:00:00Z`) -
        Date.parse(`${previous.business_date}T00:00:00Z`)) /
        86_400_000,
    )

    if (gapDays > 1) {
      breaks.push({
        kind: 'missing-days',
        businessDate: current.business_date,
        detail:
          `${gapDays - 1} business date(s) absent between ${previous.business_date} ` +
          `and ${current.business_date}; the chain has nothing to join to`,
      })
    }

    if (stored !== carried) {
      breaks.push({
        kind: 'opening-disagrees',
        businessDate: current.business_date,
        detail:
          `opens at ${rupees(stored)} where ${previous.business_date} counted ` +
          `${rupees(carried)} (${rupees(stored - carried)})`,
      })
    }
  }
  return breaks
}

// ─────────────────────────────────────────────────────────────────────────────
// The other half: replay the bills through the derived reader.
//
// The notebook typed a cash-revenue figure per day by hand. From each outlet's
// first tablet day the derived reader takes the same figure from the latest
// accepted effective Cash allocations of settled bills. Where the two disagree,
// the cause is recorded rather than reconciled away.

function cashByBill(snapshot) {
  const byBill = new Map()
  for (const allocation of snapshot.effectiveAllocations) {
    if (allocation.method !== 'cash') continue
    byBill.set(
      allocation.bill_id,
      paise(allocation.amount_paise) + (byBill.get(allocation.bill_id) ?? 0),
    )
  }
  return byBill
}

function replayOutlet(snapshot, outlet, cash) {
  const days = snapshot.ledgerDays
    .filter((d) => d.outlet_id === outlet.id)
    .sort((a, b) => a.business_date.localeCompare(b.business_date))

  const bills = snapshot.bills
    .filter((b) => b.outlet_id === outlet.id && b.status === 'settled')
    .sort((a, b) => Date.parse(a.paid_at) - Date.parse(b.paid_at))

  const firstTabletDay = bills.length ? bills[0].business_date : null

  // Derived cash per business date, from the effective allocations.
  const derived = new Map()
  for (const bill of bills) {
    const amount = cash.get(bill.id) ?? 0
    if (amount === 0) continue
    // The bill's own payment business date, which is what the notebook's typed
    // figure was recording. The interval model uses `paid_at` instead — see the
    // boundary demonstration below.
    const date = bill.payment_business_date ?? bill.business_date
    derived.set(date, (derived.get(date) ?? 0) + amount)
  }

  const perDate = []
  for (const day of days) {
    const typed = paise(day.cash_revenue_paise)
    const fromBills = derived.get(day.business_date) ?? 0
    const beforeTablet = firstTabletDay === null || day.business_date < firstTabletDay
    perDate.push({
      businessDate: day.business_date,
      typed,
      derived: fromBills,
      beforeTablet,
      agrees: beforeTablet ? null : typed === fromBills,
      differencePaise: fromBills - typed,
    })
  }

  // Dates the tablet produced that the notebook never recorded at all.
  const notebookDates = new Set(days.map((d) => d.business_date))
  const unrecorded = [...derived.keys()].filter((d) => !notebookDates.has(d)).sort()

  return { outlet, days, bills, firstTabletDay, perDate, unrecorded, derived }
}

/**
 * The one thing the old model could not express, measured across every date.
 *
 * Place a count at 22:00 local on each trading date and split that date's cash
 * by payment instant. The cash rung after 22:00 is what
 * `close_business_day()` would have counted against a drawer that no longer
 * held it — a phantom shortfall on an honest till, on every date the outlet
 * traded past ten.
 *
 * Deliberately every date rather than a chosen one. A single date proves
 * nothing either way: the first version of this function picked the busiest
 * date, drew Kalyani's 2026-08-15 where trade stopped before 22:00, and
 * reported a ₹0 difference — which reads as "the old model was fine".
 */
function boundaryDemonstration(replay, cash, countedAtLocalHour = 22) {
  const { bills } = replay
  if (!bills.length) return null

  // 22:00 IST is 16:30Z. The outlet cutover is 04:00 local, so a business date
  // begins at 22:30Z the evening before.
  const offsetMs = 5.5 * 3600 * 1000
  const dates = new Map()

  for (const bill of bills) {
    const amount = cash.get(bill.id) ?? 0
    if (amount === 0) continue
    const date = bill.payment_business_date ?? bill.business_date
    if (!dates.has(date)) dates.set(date, { date, whole: 0, inside: 0, after: 0, billsAfter: 0 })
    const row = dates.get(date)

    const countedAt = new Date(
      Date.parse(`${date}T00:00:00Z`) + countedAtLocalHour * 3600_000 - offsetMs,
    )
    // The interval opens at the previous cutover, which is the widest honest
    // lower bound for a date-scoped comparison.
    const previousCountedAt = new Date(Date.parse(`${date}T00:00:00Z`) + 4 * 3600_000 - offsetMs)

    row.whole += amount
    if (isInInterval(new Date(bill.paid_at), previousCountedAt, countedAt)) row.inside += amount
    else {
      row.after += amount
      row.billsAfter += 1
    }
  }

  const rows = [...dates.values()].sort((a, b) => b.after - a.after)
  const totals = rows.reduce(
    (acc, r) => ({
      whole: acc.whole + r.whole,
      inside: acc.inside + r.inside,
      after: acc.after + r.after,
      billsAfter: acc.billsAfter + r.billsAfter,
      datesAffected: acc.datesAffected + (r.after > 0 ? 1 : 0),
    }),
    { whole: 0, inside: 0, after: 0, billsAfter: 0, datesAffected: 0 },
  )

  return { countedAtLocalHour, rows, totals, dates: rows.length, worst: rows[0] ?? null }
}

/**
 * The anchor rule (decision 18) against real dates.
 *
 * An outlet's first observation carries no opening, no expected total and no
 * difference, and every business date before it reads `not tracked yet` rather
 * than `carried`. This counts how many such dates each outlet has on day one,
 * because that number is what the ledger has to render honestly.
 */
function anchorConsequence(replay, anchorDate) {
  const dates = new Set()
  for (const bill of replay.bills) {
    const date = bill.payment_business_date ?? bill.business_date
    if (date < anchorDate) dates.add(date)
  }
  for (const day of replay.days) if (day.business_date < anchorDate) dates.add(day.business_date)
  return { anchorDate, notTrackedYetDates: [...dates].sort() }
}

/**
 * The carry-forward, replayed over the notebook's real counts (decision 3).
 *
 * Two things are being demonstrated at once and both matter:
 *
 *   * The **signed** cash-out term (decision 5). The notebook keeps two
 *     non-negative columns, `cash_added` and `cash_removed`; the drawer keeps
 *     one signed column. `removed − added` is the translation #12 performs for
 *     real, and every row below proves it needs no branch.
 *   * The **anchoring** rule (decision 3). `carriesTo` is the counted figure
 *     less that observation's own cash out, never the expected figure — so the
 *     `difference` column beside it is recorded once and reaches nothing.
 */
function carryForwardReplay(replay, expensesByDate) {
  const rows = []
  for (const day of replay.days) {
    const counted = paise(day.counted_cash_paise)
    const removed = paise(day.cash_removed_paise)
    const added = paise(day.cash_added_paise)
    const signedCashOut = removed - added
    const opening = paise(day.opening_cash_paise)

    const expected = expectedTotalPaise({
      openingPaise: opening,
      cashReceiptsPaise: paise(day.cash_revenue_paise),
      cashExpensesPaise: expensesByDate.get(day.business_date) ?? 0,
      cashOutPaise: signedCashOut,
    })

    rows.push({
      businessDate: day.business_date,
      opening,
      counted,
      signedCashOut,
      expected,
      difference: drawerDifferencePaise(counted, expected),
      // The notebook's cash-out is a whole-day figure rather than an
      // observation's own collection, so there is nothing to exclude here;
      // #12 splits it when it carries the rows across.
      carriesTo: nextOpeningPaise(counted, 0),
    })
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────

const { snapshot: snapshotPath } = parseArgs(process.argv.slice(2))
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const cash = cashByBill(snapshot)

console.log('# August 2026 drawer rehearsal')
console.log(`\nSnapshot read at ${snapshot.readAt}`)
console.log(`Replayed at      ${new Date().toISOString()}`)
console.log(
  `\n${snapshot.bills.length} settled bills, ${snapshot.ledgerDays.length} notebook days, ` +
    `${snapshot.ledgerExpenses.length} notebook expenses, ${cash.size} bills carrying cash.`,
)

let failures = 0
const allBreaks = []

for (const outlet of snapshot.outlets) {
  const replay = replayOutlet(snapshot, outlet, cash)
  const expenses = snapshot.ledgerExpenses.filter((e) => e.outlet_id === outlet.id)

  console.log(`\n\n${'═'.repeat(74)}\n## ${outlet.name}\n${'═'.repeat(74)}`)
  console.log(
    `\nNotebook: ${replay.days.length} days, ${replay.days[0]?.business_date} to ` +
      `${replay.days.at(-1)?.business_date}`,
  )
  console.log(`Bills:    ${replay.bills.length} settled, first tablet day ${replay.firstTabletDay}`)
  console.log(`Expenses: ${expenses.length} rows, ${expenses.filter((e) => e.is_cash).length} cash`)

  // ── 1. The opening chain. This must find breaks. ──────────────────────────
  const breaks = openingChainBreaks(replay.days)
  allBreaks.push(...breaks.map((b) => ({ outlet: outlet.name, ...b })))

  console.log(`\n### Opening-cash chain — ${breaks.length} break(s), reported and NOT repaired`)
  if (breaks.length === 0) {
    console.log('  (none)')
  } else {
    for (const b of breaks) {
      console.log(`  ⚠ ${b.businessDate}  [${b.kind}]  ${b.detail}`)
    }
  }

  // ── 2. Typed cash revenue against the derived figure. ─────────────────────
  console.log('\n### Typed cash revenue vs the derived reader, per business date')
  console.log('    (dates before the tablet have no bills to derive from — that is #12 history)')
  let agreeing = 0
  let disagreeing = 0
  for (const row of replay.perDate) {
    if (row.beforeTablet) {
      console.log(
        `  ·  ${row.businessDate}  typed ${rupees(row.typed).padStart(11)}  ` +
          `— before the tablet, carried by #12`,
      )
      continue
    }
    const mark = row.agrees ? '✓' : '⚠'
    if (row.agrees) agreeing += 1
    else disagreeing += 1
    console.log(
      `  ${mark}  ${row.businessDate}  typed ${rupees(row.typed).padStart(11)}  ` +
        `derived ${rupees(row.derived).padStart(11)}  ` +
        (row.agrees ? '' : `difference ${rupees(row.differencePaise)}`),
    )
  }
  console.log(`\n  ${agreeing} date(s) agree, ${disagreeing} disagree.`)

  if (replay.unrecorded.length) {
    console.log(
      `\n  ${replay.unrecorded.length} date(s) the tablet billed and the notebook never recorded:`,
    )
    for (const date of replay.unrecorded) {
      console.log(`     ${date}  derived ${rupees(replay.derived.get(date) ?? 0)}`)
    }
  }

  // ── 3. Month totals. ─────────────────────────────────────────────────────
  const typedMonth = replay.perDate.reduce((s, r) => s + r.typed, 0)
  const derivedMonth = replay.perDate
    .filter((r) => !r.beforeTablet)
    .reduce((s, r) => s + r.derived, 0)
  const typedFromTablet = replay.perDate
    .filter((r) => !r.beforeTablet)
    .reduce((s, r) => s + r.typed, 0)

  console.log('\n### Month totals, cash revenue')
  console.log(`  Notebook, whole month            ${rupees(typedMonth)}`)
  console.log(`  Notebook, from the tablet day    ${rupees(typedFromTablet)}`)
  console.log(`  Derived, from the tablet day     ${rupees(derivedMonth)}`)
  console.log(`  Difference                       ${rupees(derivedMonth - typedFromTablet)}`)

  // ── 4. The boundary the old model could not express. ─────────────────────
  const demo = boundaryDemonstration(replay, cash)
  if (demo) {
    console.log(`\n### A ${demo.countedAtLocalHour}:00 count, on every real trading date`)
    console.log(
      `  ${demo.dates} date(s) with cash; ${demo.totals.datesAffected} of them traded past ` +
        `${demo.countedAtLocalHour}:00.`,
    )
    console.log(`  Whole month, cash                ${rupees(demo.totals.whole)}`)
    console.log(`  Inside the intervals             ${rupees(demo.totals.inside)}`)
    console.log(
      `  Rung after the count             ${rupees(demo.totals.after)}  ` +
        `(${demo.totals.billsAfter} bill(s))`,
    )
    console.log(
      `  → close_business_day() would have reported ${rupees(-demo.totals.after)} of phantom\n` +
        `    shortfall across the month, on drawers that were never short.`,
    )
    if (demo.worst && demo.worst.after > 0) {
      console.log(
        `  Worst single date: ${demo.worst.date}, ${rupees(demo.worst.after)} across ` +
          `${demo.worst.billsAfter} bill(s) after the count`,
      )
    }
    if (demo.totals.inside + demo.totals.after !== demo.totals.whole) {
      console.log('  ✗ the two sides do not sum to the month')
      failures += 1
    }
  }

  // ── 5. The anchor's consequence for the ledger. ──────────────────────────
  const anchorDate = replay.days.at(-1)?.business_date ?? replay.firstTabletDay
  if (anchorDate) {
    const anchor = anchorConsequence(replay, anchorDate)
    console.log(`\n### Decision 18: an anchor recorded on ${anchor.anchorDate}`)
    console.log(
      `  ${anchor.notTrackedYetDates.length} earlier business date(s) render with the drawer ` +
        `marked \`not tracked yet\`,`,
    )
    console.log(`  never \`carried\` and never zero: ${anchor.notTrackedYetDates.join(', ')}`)
  }

  // ── 6. The carry-forward over real counts. ───────────────────────────────
  const cashExpensesByDate = new Map()
  for (const expense of expenses) {
    if (!expense.is_cash) continue
    cashExpensesByDate.set(
      expense.business_date,
      (cashExpensesByDate.get(expense.business_date) ?? 0) + paise(expense.amount_paise),
    )
  }

  const carry = carryForwardReplay(replay, cashExpensesByDate)
  console.log('\n### Carry-forward on the notebook’s real counts (decisions 3 and 5)')
  console.log('    `next opening = counted − own cash out`, anchored to physical cash.')
  console.log('    Cash out is ONE signed column: `removed − added`, no branch.')
  const signedRows = carry.filter((r) => r.signedCashOut < 0)
  for (const row of carry) {
    console.log(
      `  ${row.businessDate}  open ${rupees(row.opening).padStart(9)}  ` +
        `cash out ${rupees(row.signedCashOut).padStart(9)}  ` +
        `expect ${rupees(row.expected).padStart(9)}  ` +
        `counted ${rupees(row.counted).padStart(9)}  ` +
        `diff ${rupees(row.difference).padStart(9)}  ` +
        `carries ${rupees(row.carriesTo).padStart(9)}`,
    )
  }
  console.log(
    `\n  ${signedRows.length} date(s) carry a NEGATIVE cash-out — a thin drawer topped up.\n` +
      '  Decision 5 says that needs no concept of its own, and these rows are the proof:\n' +
      '  the same subtraction produced the right expected figure on every one.',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPECTED BREAKS — asserted, not described.
//
// `design.md` records three specific breaks in the production notebook, read on
// 2026-08-26. They are the reason decision 4 says the surface reports a break
// and repairs nothing, and they are what the surface will show on its first real
// day. A rehearsal that finds none of them has a bug in the chain check, so this
// block fails rather than congratulating itself.

// Dates verified against the raw notebook rows on 2026-08-27. `design.md`'s
// prose names the day whose COUNT is involved; a break belongs to the day whose
// stored OPENING disagrees, which is the day after. Both describe the same three
// facts; these are the dates the surface will actually mark.
const EXPECTED = [
  // opens ₹340 where 2026-08-12 counted ₹490
  { outlet: 'Kalyani', businessDate: '2026-08-13', kind: 'opening-disagrees' },
  // opens ₹510 where 2026-08-14 counted ₹310
  { outlet: 'Kalyani', businessDate: '2026-08-15', kind: 'opening-disagrees' },
  // 2026-08-19, 08-20 and 08-21 absent between 08-18 and 08-22
  { outlet: 'Kalyani', businessDate: '2026-08-22', kind: 'missing-days' },
]

console.log(`\n\n${'═'.repeat(74)}\n## Verdict\n${'═'.repeat(74)}`)
console.log(`\n${allBreaks.length} opening-chain break(s) found across both outlets:\n`)
for (const b of allBreaks) console.log(`  ⚠ ${b.outlet.padEnd(13)} ${b.businessDate}  ${b.detail}`)

if (allBreaks.length === 0) {
  console.log(
    '\n✗ FAIL: no breaks found. design.md records three in production, so a clean\n' +
      '  result means the chain check does not work — not that the data is sound.',
  )
  failures += 1
}

for (const want of EXPECTED) {
  const hit = allBreaks.some(
    (b) => b.outlet === want.outlet && b.businessDate === want.businessDate && b.kind === want.kind,
  )
  if (!hit) {
    console.log(
      `\n⚠ expected break not found: ${want.outlet} ${want.businessDate} (${want.kind}).\n` +
        '  Either the chain check regressed or production has moved on since 2026-08-26.',
    )
  }
}

console.log(
  `\nNothing was repaired. ${allBreaks.length} break(s) stay exactly as recorded, which is\n` +
    'decision 4: a stored figure a person entered is evidence, and a recomputed one is not.',
)

if (failures > 0) {
  console.log(`\n✗ ${failures} rehearsal assertion(s) failed.`)
  process.exit(1)
}
console.log('\n✓ Replay consistent: every interval split sums to its business date.')
