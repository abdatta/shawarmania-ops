import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `multiple-billing-devices` reshapes the invariant that protects the counter,
 * and this file is what keeps its one promise: **every tablet that exists keeps
 * trading through the migration, with no re-setup at either outlet.**
 *
 * Two things make that promise fragile in a way no other gate would catch.
 *
 * The first is that this migration drops two indexes and adds a check
 * constraint. A check constraint on a populated table is validated immediately,
 * so a backfill that misses one row does not fail a test somewhere: it fails the
 * deploy, on a shop's live schema, halfway through. The backfill therefore has to
 * run before the constraint and cover every row unconditionally, and that
 * ordering is asserted here because it is invisible at runtime once it has
 * worked.
 *
 * The second is that a tablet's identity is its Auth user, its pending local
 * work is keyed on that identity, and its historical attribution is a foreign
 * key from bills and commands. So a migration that renamed, recreated or
 * repopulated `counter_devices` would take the machine credentials and the money
 * history with it, and the tablets at both shops would need setting up again
 * during service. Nothing else in the suite would notice: every other gate tests
 * what the schema does, and a migration that additionally rewrote a table would
 * pass all of them because the rewritten table behaves identically.
 *
 * `deploy.yml` runs `supabase db push` forward-only, so there is no second
 * chance.
 */

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../supabase/migrations/20260902000000_multiple_billing_devices.sql',
  ),
  'utf8',
)

/** Statement text with comments stripped, so prose about `drop` is not a drop. */
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('the multiple-billing-devices migration keeps every existing tablet', () => {
  it('adds its two columns and drops none', () => {
    expect(statements).toContain('add column session_proven_at timestamptz')
    expect(statements).toContain('add column proof_expires_at timestamptz')
    expect(statements).not.toMatch(/alter table[\s\S]*?drop column/i)
  })

  it('never renames, recreates or empties the tablet table', () => {
    // A rename would strip the machine credentials and the money history off
    // every tablet at once, which is the failure this whole file exists for.
    expect(statements).not.toMatch(/alter table\s+public\.counter_devices\s+rename/i)
    expect(statements).not.toMatch(/drop table/i)
    expect(statements).not.toMatch(/truncate/i)
    expect(statements).not.toMatch(/delete from/i)
  })

  it('writes to existing rows exactly once, and only to fill in the new fact', () => {
    const updates = statements.match(/update public\.counter_devices/g) ?? []
    // One backfill, plus four runtime writes inside `security definer`
    // functions, none of which runs during the migration: proving a session,
    // renaming a counter, and both signatures of the heartbeat, which are
    // reproduced here only to carry the added predicate.
    expect(updates).toHaveLength(5)
    expect(statements).toContain(
      'update public.counter_devices\n   set session_proven_at = coalesce(set_up_at, now())\n where session_proven_at is null;',
    )
  })

  it('backfills before it constrains, because the constraint validates on write', () => {
    const backfill = statements.indexOf('set session_proven_at = coalesce(set_up_at, now())')
    const constraint = statements.indexOf('counter_devices_proven_or_pending')
    expect(backfill).toBeGreaterThan(-1)
    expect(constraint).toBeGreaterThan(-1)
    expect(backfill).toBeLessThan(constraint)
  })

  it('drops indexes and nothing else', () => {
    const drops = statements.match(/drop\s+(\w+)/gi) ?? []
    expect(drops.length).toBeGreaterThan(0)
    for (const drop of drops) {
      expect(drop.toLowerCase()).toBe('drop index')
    }
  })

  it('leaves the setup codes, shifts and shift requests alone', () => {
    // Their per-device uniqueness is what already made shifts per tablet rather
    // than per outlet, so this change reads them and reshapes none of them.
    for (const table of ['counter_shifts', 'counter_shift_requests']) {
      expect(statements).not.toMatch(new RegExp(`alter table\\s+public\\.${table}`, 'i'))
    }
    expect(statements).not.toMatch(/alter table\s+public\.counter_device_setup_codes/i)
  })
})
