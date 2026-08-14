import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STAFF_ROLES, isStaffRole, type AppRole } from './adapters'
import { Constants } from './database.types'

/**
 * The app and the database each decide who is staff, and they must decide it
 * the same way (a-biller-is-staff).
 *
 * `STAFF_ROLES` collapsed the app's four spellings into one. It could not
 * collapse the database's, because the rule also lives inside
 * `attendance_elsewhere`, and a migration file is history: you do not edit it,
 * you write a new one on top. So there are two statements of the rule and there
 * is no language that can hold both.
 *
 * That is the exact drift this file exists to catch, and it is not theoretical:
 * the bug this change corrects was the two sides disagreeing, in production, for
 * two days. Two tests each proving their own side is not enough — both were
 * green while the sides disagreed, because neither one could see the other.
 */
describe('the app and the database agree on who is staff', () => {
  const MANAGEMENT_ROLES: AppRole[] = ['super_admin', 'franchise_admin']

  /**
   * A role added to the enum is a decision, and this is where it gets made.
   *
   * `STAFF_ROLES` names the roles it admits rather than the roles it excludes
   * (design D1), which means a fifth role joins nothing by default. Good, and
   * silent: nobody would learn they had a decision to take. This partition is
   * the alarm. `Constants` is generated from the live schema by `npm run
   * db:types`, so the enum here is the database's own answer, not a copy.
   */
  it('accounts for every role the schema has, as staff or as management', () => {
    const enumRoles = [...Constants.public.Enums.app_role].sort()
    const accountedFor = [...STAFF_ROLES, ...MANAGEMENT_ROLES].sort()

    expect(accountedFor).toEqual(enumRoles)
  })

  it('holds the two roles that describe working a shift, and neither that does not', () => {
    expect([...STAFF_ROLES].sort()).toEqual(['biller', 'employee'])
    for (const role of MANAGEMENT_ROLES) expect(isStaffRole(role)).toBe(false)
  })

  /**
   * The other half of the rule, read out of the migration that states it.
   *
   * A textual read of SQL is a blunt instrument, so it is pointed at one clause
   * and it **fails when it cannot find that clause**. A predicate rewritten in
   * some other shape stops this test dead rather than quietly passing, which is
   * the only failure direction worth having: a guard that goes silent when the
   * thing it guards moves is worse than no guard, because it reads as coverage.
   */
  it('is spelled the same way inside attendance_elsewhere', () => {
    // Vitest runs from the repo root, which is where `supabase/` lives.
    const dir = resolve(process.cwd(), 'supabase/migrations')
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) =>
        readFileSync(`${dir}/${f}`, 'utf8').includes('function public.attendance_elsewhere'),
      )

    expect(defining.length).toBeGreaterThan(0)

    // The last one wins: later migrations replace the bodies of earlier ones.
    const source = readFileSync(`${dir}/${defining[defining.length - 1]}`, 'utf8')
    const predicate = source.match(/s\.role\s+in\s+\(([^)]*)\)/)

    const listed = predicate?.[1]
    if (listed === undefined) {
      throw new Error(
        'No `s.role in (...)` staff check in the migration that last defined ' +
          'attendance_elsewhere. If the predicate was deliberately rewritten, ' +
          'rewrite this assertion with it. Do not delete it: the two statements ' +
          'of who is staff have nothing else holding them together.',
      )
    }

    const roles = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(roles).toEqual([...STAFF_ROLES].sort())
  })
})
