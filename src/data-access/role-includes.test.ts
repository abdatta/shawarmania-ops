import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Assignment } from '@/data-access/adapters'
import { highestRole, isStaffRole, STAFF_ROLES } from '@/data-access/adapters'
import { Constants } from '@/data-access/database.types'
import { personalHeldRoles, reachableRoles, type Role, type Session } from '@/session/session'

import {
  FIRST_STAFF_ROLE,
  includes,
  includesIn,
  rolesIncludedBy,
  rolesIncludedByIn,
  STAFF_ROLE_INCLUDES,
  STAFF_ROLES_BY_SENIORITY,
} from './role-includes'

/**
 * staff-roles-include-other-roles changes where the app's answers come from,
 * not what they are (design D7). The functions below are **frozen copies** of
 * the ones it replaced, as they read on 2026-10-21, and every derived answer is
 * checked against them for every set of live assignments a person can hold at
 * one and two outlets. They are deliberately not imported: the point is that
 * they cannot move.
 */
const FROZEN = {
  STAFF_ROLES: ['biller', 'employee'] as Role[],
  isStaffRole: (role: Role) => (['biller', 'employee'] as Role[]).includes(role),
  SENIORITY: { super_admin: 4, franchise_admin: 3, biller: 2, employee: 1 } as Record<
    string,
    number
  >,
  ROLE_ORDER: ['super_admin', 'franchise_admin', 'biller', 'employee'] as Role[],
  reachable(held: Set<Role>): Role[] {
    const reachable = new Set(held)
    if (reachable.has('super_admin')) reachable.add('franchise_admin')
    if (reachable.has('biller')) reachable.add('employee')
    return FROZEN.ROLE_ORDER.filter((role) => reachable.has(role))
  },
  personalHeld(held: Set<Role>): Role[] {
    const assigned = FROZEN.ROLE_ORDER.filter((role) => held.has(role))
    return FROZEN.reachable(held)
      .filter((role) => role !== 'biller')
      .filter(
        (role) => assigned.includes(role) || (role === 'employee' && assigned.includes('biller')),
      )
  },
  highest(assignments: readonly Assignment[]): Role | null {
    return assignments
      .filter((a) => a.endedOn === null)
      .reduce<Role | null>(
        (best, a) =>
          best === null || FROZEN.SENIORITY[a.role]! > FROZEN.SENIORITY[best]! ? a.role : best,
        null,
      )
  },
}

const ROLES = [...Constants.public.Enums.app_role] as Role[]
const OUTLETS = ['kal', 'kpa'] as const

/** Every set of live assignments one person can hold: one role per outlet, or none. */
function everyHolding(): Assignment[][] {
  const options: (Role | null)[] = [null, ...ROLES.filter((r) => r !== 'super_admin')]
  const holdings: Assignment[][] = []
  for (const owner of [false, true]) {
    for (const atKal of options) {
      for (const atKpa of options) {
        const set: Assignment[] = []
        if (owner) set.push(assignment('super_admin', null))
        if (atKal) set.push(assignment(atKal, OUTLETS[0]))
        if (atKpa) set.push(assignment(atKpa, OUTLETS[1]))
        holdings.push(set)
      }
    }
  }
  return holdings
}

let n = 0
function assignment(role: Role, outletId: string | null): Assignment {
  n += 1
  return { id: `a${n}`, role, outletId, startedOn: '2026-10-01', endedOn: null }
}

function sessionOf(assignments: Assignment[]): Session {
  return {
    mode: 'real',
    userId: 'u',
    displayName: 'Person',
    assignments,
    role: highestRole(assignments),
  } as unknown as Session
}

describe('which staff role includes which', () => {
  it('says a Biller includes an Employee, and nothing more', () => {
    expect(STAFF_ROLE_INCLUDES).toEqual({ biller: ['employee'], employee: [] })
    expect(FIRST_STAFF_ROLE).toBe('employee')
  })

  it('answers for every pair of roles as the role lists did', () => {
    for (const held of ROLES) {
      expect(includes(held, 'employee')).toBe(FROZEN.isStaffRole(held))
      expect(includes(held, 'biller')).toBe(held === 'biller')
      expect(includes(held, 'franchise_admin')).toBe(false)
    }
  })

  it('ignores a role it does not know rather than failing', () => {
    expect(includes('head_chef', 'employee')).toBe(false)
    expect(rolesIncludedBy('head_chef')).toEqual([])
    expect(rolesIncludedBy('franchise_admin')).toEqual([])
  })

  it('lists every role a role includes, itself first', () => {
    expect(rolesIncludedBy('biller')).toEqual(['biller', 'employee'])
    expect(rolesIncludedBy('employee')).toEqual(['employee'])
  })

  it('lists a role before every role it includes', () => {
    for (const [at, role] of STAFF_ROLES_BY_SENIORITY.entries()) {
      for (const below of rolesIncludedBy(role).slice(1)) {
        expect(
          STAFF_ROLES_BY_SENIORITY.indexOf(below as never),
          `${role} > ${below}`,
        ).toBeGreaterThan(at)
      }
    }
  })

  /**
   * The shape the owner asked for on 2026-10-21: roles that branch. A Cook and
   * a Biller both include a Waiter, and neither includes the other; a Head cook
   * includes both. None of these roles exists yet, so the walk is proved over a
   * map of them rather than the app's own.
   */
  it('walks a tree that branches, and several roles may include one', () => {
    const tree = {
      head_cook: ['cook', 'biller'],
      biller: ['waiter'],
      cook: ['waiter'],
      waiter: ['employee'],
      employee: [],
    }
    expect(includesIn(tree, 'cook', 'waiter')).toBe(true)
    expect(includesIn(tree, 'cook', 'employee')).toBe(true)
    expect(includesIn(tree, 'biller', 'cook')).toBe(false)
    expect(includesIn(tree, 'cook', 'biller')).toBe(false)
    expect(includesIn(tree, 'head_cook', 'biller')).toBe(true)
    expect(includesIn(tree, 'head_cook', 'employee')).toBe(true)
    expect(includesIn(tree, 'waiter', 'cook')).toBe(false)
    expect(rolesIncludedByIn(tree, 'head_cook').sort()).toEqual([
      'biller',
      'cook',
      'employee',
      'head_cook',
      'waiter',
    ])
  })
})

describe('every answer derived from the includes is the answer before it', () => {
  it('names the same staff roles, in the same order', () => {
    expect([...STAFF_ROLES]).toEqual(FROZEN.STAFF_ROLES)
    for (const role of ROLES) expect(isStaffRole(role)).toBe(FROZEN.isStaffRole(role))
  })

  it('lands every holding on the same shell, reaches the same surfaces, and owns the same homes', () => {
    const holdings = everyHolding()
    expect(holdings.length).toBeGreaterThan(30)
    for (const assignments of holdings) {
      const held = new Set(assignments.map((a) => a.role))
      const label = assignments.map((a) => `${a.role}@${a.outletId ?? '*'}`).join(',') || 'nothing'
      expect(highestRole(assignments), label).toBe(FROZEN.highest(assignments))
      const session = sessionOf(assignments)
      expect(reachableRoles(session), label).toEqual(FROZEN.reachable(held))
      expect(personalHeldRoles(session), label).toEqual(FROZEN.personalHeld(held))
    }
  })
})

describe('the app and the database say the same thing', () => {
  /**
   * `staff_roles` and `staff_role_includes` are written by migrations, the
   * first and every one that adds a role. Read from every migration's inserts,
   * so a role or an includes row added on one side only fails here, before it
   * fails at a counter.
   */
  it('holds the staff roles and includes rows STAFF_ROLE_INCLUDES lists', () => {
    const dir = resolve(process.cwd(), 'supabase/migrations')
    const roles = new Set<string>()
    const rows = new Set<string>()
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(`${dir}/${file}`, 'utf8')
      for (const insert of sql.matchAll(
        /insert into public\.staff_roles\s*\(role\)\s*values\s*([^;]+);/gi,
      )) {
        for (const row of insert[1]!.matchAll(/\('([a-z_]+)'\)/g)) roles.add(row[1]!)
      }
      for (const insert of sql.matchAll(
        /insert into public\.staff_role_includes\s*\(role, includes\)\s*values\s*([^;]+);/gi,
      )) {
        for (const row of insert[1]!.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)) {
          rows.add(`${row[1]} includes ${row[2]}`)
        }
      }
    }
    expect([...roles].sort()).toEqual(Object.keys(STAFF_ROLE_INCLUDES).sort())
    const listed = Object.entries(STAFF_ROLE_INCLUDES).flatMap(([role, below]) =>
      below.map((b) => `${role} includes ${b}`),
    )
    expect([...rows].sort()).toEqual(listed.sort())
  })
})
