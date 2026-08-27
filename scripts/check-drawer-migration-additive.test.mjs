import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `cash-is-counted-not-closed` has one revert story, and this file is what
 * keeps it true.
 *
 * The change replaces the entire cash model while `daily_cash_records`,
 * `close_business_day()`, `cash_withdrawals`, `public.expenses` and both
 * manual-ledger tables stay exactly where they are, dead but intact. So a revert
 * is a one-line gate edit and a deploy, with no data to recover — which is worth
 * more than any feature flag, and is the reason the change could ship to two
 * trading counters in a single push.
 *
 * That story holds only while the migration stays additive. One `drop table`, one
 * `rename`, one `update ... set` and the revert becomes an archaeology.
 * `deploy.yml` runs `supabase db push` forward-only and a manual frontend
 * rollback deliberately keeps the forward schema, so there is no second chance:
 * a migration that passes every test and is still wrong is not undone by a
 * follow-up push.
 *
 * Nothing else catches it. Every other gate in the suite tests what the schema
 * DOES, and a migration that additionally dropped a dead table would pass all of
 * them.
 *
 * **The distinction this file draws, because a naive grep cannot.** A
 * `security definer` command function has to write at runtime —
 * `edit_drawer_observation()` updates the row it is editing, and
 * `record_drawer_observation()` inserts one. That is the application's write
 * path, not migration-time data movement, and it lives inside a `$$` body.
 * Likewise `revoke insert, update, delete` and `before update on` are the
 * opposite of a write: one removes the privilege and the other schedules a
 * guard. So the assertions below strip comments, strip function bodies, and
 * ignore those two forms — and are otherwise absolute.
 */

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260827000001_cash_is_counted_not_closed.sql',
)

const source = readFileSync(MIGRATION, 'utf8')

/**
 * The migration as executable DDL alone.
 *
 * Comments go first, because the header explains at length that this migration
 * contains no drop and no rename — and a grep that reads prose reports the
 * documentation of a rule as a violation of it.
 */
const ddl = source
  .replace(/--[^\n]*/g, '')
  .replace(/\$\$[\s\S]*?\$\$/g, ' <<function body>> ')
  // `revoke insert, update, delete on ...` withdraws the privilege to write.
  .replace(/revoke[^;]*;/gi, ' <<revoke>> ')
  // `before insert or update on ...` schedules a trigger; it writes nothing.
  .replace(
    /before\s+(insert\s+or\s+)?(update|delete)(\s+or\s+delete)?\s+on/gi,
    ' <<trigger when>> ',
  )

describe('the drawer migration is additive, which is the whole revert story', () => {
  it('drops nothing', () => {
    expect(ddl).not.toMatch(/\bdrop\b/i)
  })

  it('renames nothing', () => {
    expect(ddl).not.toMatch(/\brename\b/i)
  })

  it('changes no existing column type or default', () => {
    expect(ddl).not.toMatch(/alter\s+column/i)
    expect(ddl).not.toMatch(/alter\s+\w+\s+type/i)
  })

  it('moves no data: no migration-level update, delete or insert', () => {
    expect(ddl).not.toMatch(/\bupdate\b/i)
    expect(ddl).not.toMatch(/\bdelete\s+from\b/i)
    expect(ddl).not.toMatch(/\binsert\s+into\b/i)
  })

  it('adds only nullable columns to tables that already existed', () => {
    const added = [...source.matchAll(/alter table\s+(\S+)\s*\n\s*add column\s+(\w+)\s+([^;]+);/gi)]
    expect(added.length).toBeGreaterThan(0)
    for (const [, table, column, rest] of added) {
      expect(`${table}.${column}: ${rest}`).toMatch(/\bnull\b/i)
      expect(`${table}.${column}: ${rest}`).not.toMatch(/not null/i)
    }
  })

  it('leaves cash_withdrawals untouched, because nothing writes it and #12 drops it', () => {
    // Deliberately the whole file, comments included: the table may be
    // discussed, and must not be altered.
    expect(ddl).not.toMatch(/cash_withdrawals/i)
  })

  it('leaves daily_cash_records and close_business_day in place, dead', () => {
    expect(ddl).not.toMatch(/daily_cash_records/i)
    expect(ddl).not.toMatch(/close_business_day/i)
  })
})

describe('the four new tables each ship their own Row-Level Security', () => {
  const tables = [
    'drawer_observations',
    'drawer_cash_out',
    'drawer_observation_adjustments',
    'ledger_day_verifications',
  ]

  it.each(tables)('%s is created, RLS-enabled and has a select policy', (table) => {
    expect(source).toMatch(new RegExp(`create table public\\.${table}\\b`))
    expect(source).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`))
    expect(source).toMatch(new RegExp(`create policy ${table}_select`))
  })

  it.each(tables)('%s grants no client write, so a derived figure cannot be supplied', (table) => {
    expect(source).toMatch(
      new RegExp(`revoke insert, update, delete on public\\.${table} from authenticated, anon`),
    )
    // The absence of a write policy is the refusal. If one is ever added, this
    // fails and the change that added it has to say why.
    expect(source).not.toMatch(new RegExp(`create policy ${table}_(insert|update|delete)`))
  })
})

describe('the arithmetic the database enforces is the arithmetic the spec states', () => {
  it('constrains difference = counted − expected, guarded only by the anchor', () => {
    expect(source).toMatch(
      /check \(is_anchor or difference_paise = counted_total_paise - expected_paise\)/,
    )
  })

  it('ties all three derived figures to the anchor flag in both directions', () => {
    expect(source).toMatch(/check \(is_anchor = \(opening_paise is null\)\)/)
    expect(source).toMatch(/check \(is_anchor = \(expected_paise is null\)\)/)
    expect(source).toMatch(/check \(is_anchor = \(difference_paise is null\)\)/)
  })

  it('allows one anchor per outlet, by partial unique index', () => {
    expect(source).toMatch(
      /create unique index drawer_observations_one_anchor_per_outlet[\s\S]*?where is_anchor/,
    )
  })

  it('keeps every money column integer paise', () => {
    const money = [...source.matchAll(/^\s{2}(\w*paise\w*)\s+(\w+)/gim)]
    expect(money.length).toBeGreaterThan(0)
    for (const [, column, type] of money) {
      expect(`${column} is ${type}`).toMatch(/is bigint$/)
    }
  })

  it('reads receipts from the effective allocations, never the raw ones', () => {
    // Production holds a correction in each direction, so reading
    // `bill_payments` gets two real bills wrong today.
    expect(source).toMatch(/from public\.bills b\s*\n\s*join public\.effective_bill_payments/)
    expect(source).not.toMatch(/join public\.bill_payments/)
  })

  it('reads expenses from the live table and never from the notebook', () => {
    expect(source).toMatch(/from public\.expenses x/)
    // The `manual-ledger` delta forbids a live surface reading these rows; the
    // migration only ever ADDS a column to that table.
    const readsNotebook = /(from|join)\s+public\.manual_ledger_expenses/i.test(source)
    expect(readsNotebook).toBe(false)
  })

  it('takes an advisory lock per outlet so two concurrent counts cannot interleave', () => {
    expect(source).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_outlet_id::text, 0\)\)/)
  })
})
