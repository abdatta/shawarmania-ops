import { describe, expect, it } from 'vitest'

import { buildMapping, validateMapping } from './migrate-usernames.mjs'

const users = [
  { id: 'owner', email: 'Owner.Real@example.com' },
  { id: 'staff', email: 'staff.person@placeholder.invalid' },
]
const profiles = [
  { id: 'owner', full_name: 'Owner Real', is_active: true },
  { id: 'staff', full_name: 'Staff Person', is_active: true },
]
const assignments = [
  { person_id: 'owner', role: 'super_admin', outlet_id: null, ended_on: null },
  { person_id: 'staff', role: 'employee', outlet_id: 'outlet', ended_on: null },
]

describe('reviewed username migration mapping', () => {
  it('keeps recovery email only for an explicitly approved owner', () => {
    const mapping = buildMapping({
      users,
      profiles,
      assignments,
      contacts: [],
      approvedOwners: new Set(['owner']),
    })
    expect(mapping.users).toEqual([
      expect.objectContaining({
        userId: 'owner',
        username: 'owner.real',
        newAlias: 'owner.real@login.shawarmania.invalid',
        recoveryEmail: 'owner.real@example.com',
        ownerApproved: true,
      }),
      expect.objectContaining({
        userId: 'staff',
        username: 'staff.person',
        recoveryEmail: null,
        flags: ['placeholder_address'],
      }),
    ])
    expect(validateMapping(mapping)).toEqual([])
  })

  it('refuses apply while an owner is unapproved', () => {
    const mapping = buildMapping({
      users,
      profiles,
      assignments,
      contacts: [],
      approvedOwners: new Set(),
    })
    expect(validateMapping(mapping)).toContain(
      'owner: owner recovery email is missing or not approved',
    )
  })

  it('flags collisions for operator review instead of inventing a suffix', () => {
    const mapping = buildMapping({
      users: [
        { id: 'one', email: 'Same.Name@example.com' },
        { id: 'two', email: 'same.name@placeholder.invalid' },
      ],
      profiles: [
        { id: 'one', full_name: 'One', is_active: true },
        { id: 'two', full_name: 'Two', is_active: true },
      ],
      assignments: [],
      contacts: [],
      approvedOwners: new Set(),
    })
    expect(mapping.users.every((row) => row.username === null)).toBe(true)
    expect(mapping.users.every((row) => row.flags.includes('username_collision'))).toBe(true)
  })
})
