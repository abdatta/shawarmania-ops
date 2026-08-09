import { describe, expect, it } from 'vitest'

import type { Assignment } from '@/data-access/adapters'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'

import type { Role, Session } from './session'
import { deriveSessionScope, heldRoles, reachableRoles } from './session'

/**
 * Held roles and reachable roles are two questions, and the difference is the
 * whole of design D1: what somebody holds is a fact about their assignments,
 * what they can reach decides which shells and navigation entries exist.
 */

let nextId = 0

function live(role: Role, outletId: string | null): Assignment {
  nextId += 1
  return { id: `a${nextId}`, role, outletId, startedOn: '2026-01-01', endedOn: null }
}

function ended(role: Role, outletId: string | null): Assignment {
  return { ...live(role, outletId), endedOn: '2026-06-30' }
}

function sessionWith(assignments: Assignment[]): Session {
  return {
    mode: 'real',
    userId: 'person-1',
    assignments,
    ...deriveSessionScope(assignments),
    displayName: 'A Person',
  }
}

describe('reachableRoles', () => {
  it('lets the owner reach the outlet-level surfaces holding no assignment', () => {
    const owner = sessionWith([live('super_admin', null)])

    expect(heldRoles(owner)).toEqual(['super_admin'])
    expect(reachableRoles(owner)).toEqual(['super_admin', 'franchise_admin'])
  })

  it('reaches the same set, without duplicating it, for an owner who also manages an outlet', () => {
    const ownerManager = sessionWith([
      live('super_admin', null),
      live('franchise_admin', OUTLET_KALYANI_ID),
    ])

    expect(reachableRoles(ownerManager)).toEqual(['super_admin', 'franchise_admin'])
  })

  it('lets a Biller reach the Employee surfaces, holding no Employee assignment', () => {
    // A Biller works at the shop and therefore turns up to it. The database
    // already reads their assignment that way: the attendance command accepts
    // `employee` or `biller` at the outlet. Without this they would need a second
    // assignment saying they also work where they already work.
    const biller = sessionWith([live('biller', OUTLET_KALYANI_ID)])

    expect(heldRoles(biller)).toEqual(['biller'])
    expect(reachableRoles(biller)).toEqual(['biller', 'employee'])
  })

  it('gives the manager exactly what it holds, and no attendance surface', () => {
    // Deliberately NOT extended to a manager or the owner: their attendance is
    // not kept here, and reaching the Employee shell would offer them a check-in
    // for a shift nobody rosters them onto.
    const manager = sessionWith([live('franchise_admin', OUTLET_KALYANI_ID)])
    const staff = sessionWith([live('employee', OUTLET_KALYANI_ID)])

    expect(reachableRoles(manager)).toEqual(['franchise_admin'])
    expect(reachableRoles(staff)).toEqual(['employee'])
  })

  it('gives the owner no Employee surfaces either, despite reaching every outlet', () => {
    const owner = sessionWith([live('super_admin', null)])

    expect(reachableRoles(owner)).not.toContain('employee')
  })

  it('reaches the union for a person holding several, in seniority order', () => {
    const both = sessionWith([
      live('franchise_admin', OUTLET_KALYANI_ID),
      live('employee', OUTLET_KANCHRAPARA_ID),
    ])

    expect(reachableRoles(both)).toEqual(['franchise_admin', 'employee'])
  })

  it('never reaches the counter or a staff surface by reaching alone', () => {
    // The owner cannot ring up a sale and has no attendance of their own. Both
    // are deliberate, and reaching must not quietly grant either.
    const owner = sessionWith([live('super_admin', null)])

    expect(reachableRoles(owner)).not.toContain('biller')
    expect(reachableRoles(owner)).not.toContain('employee')
  })

  it('reaches nothing once every assignment has ended', () => {
    const departed = sessionWith([
      ended('super_admin', null),
      ended('franchise_admin', OUTLET_KALYANI_ID),
    ])

    expect(heldRoles(departed)).toEqual([])
    expect(reachableRoles(departed)).toEqual([])
  })
})
