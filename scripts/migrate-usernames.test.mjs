import { describe, expect, it } from 'vitest'

import {
  auditMigrationState,
  buildMapping,
  mappingFingerprint,
  validateCurrentAuthUsers,
  validateMapping,
} from './migrate-usernames.mjs'

const users = [
  { id: 'owner', email: 'Owner.Real@approved.test' },
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

function seal(mapping) {
  mapping.approval = {
    approvedAt: '2026-07-30T00:00:00.000Z',
    approvedBy: 'test-owner',
    fingerprint: mappingFingerprint(mapping),
  }
  return mapping
}

describe('reviewed username migration mapping', () => {
  it('keeps account email only when explicitly approved and requires it for an owner', () => {
    const mapping = buildMapping({
      users,
      profiles,
      assignments,
      accountEmails: [],
      approvedEmails: new Set(['owner']),
    })
    expect(mapping.users).toEqual([
      expect.objectContaining({
        userId: 'owner',
        username: 'owner.real',
        newAlias: 'owner.real@login.shawarmania.invalid',
        accountEmail: 'owner.real@approved.test',
        emailApproved: true,
      }),
      expect.objectContaining({
        userId: 'staff',
        username: 'staff.person',
        accountEmail: null,
        flags: ['placeholder_address'],
      }),
    ])
    expect(validateMapping(seal(mapping))).toEqual([])
  })

  it('refuses apply while an owner is unapproved', () => {
    const mapping = buildMapping({
      users,
      profiles,
      assignments,
      accountEmails: [],
      approvedEmails: new Set(),
    })
    expect(validateMapping(mapping, { requireApproval: false })).toContain(
      'owner: Super Admin account email is missing or not approved',
    )
  })

  it('flags collisions for operator review instead of inventing a suffix', () => {
    const mapping = buildMapping({
      users: [
        { id: 'one', email: 'Same.Name@example.com' },
        { id: 'two', email: 'same.name@placeholder.invalid' },
      ],
      profiles: [
        { id: 'one', full_name: 'Same Name', is_active: true },
        { id: 'two', full_name: 'Same Name', is_active: true },
      ],
      assignments: [],
      accountEmails: [],
      approvedEmails: new Set(),
    })
    expect(mapping.users.every((row) => row.username === null)).toBe(true)
    expect(mapping.users.every((row) => row.flags.includes('username_collision'))).toBe(true)
  })

  it('refuses an unapproved mapping and any edit made after approval', () => {
    const mapping = buildMapping({
      users,
      profiles,
      assignments,
      accountEmails: [],
      approvedEmails: new Set(['owner']),
    })
    expect(validateMapping(mapping)).toContain(
      'the complete mapping has not been owner-approved, or changed after approval',
    )

    seal(mapping)
    mapping.users[1].username = 'changed.after.approval'
    expect(validateMapping(mapping)).toContain(
      'the complete mapping has not been owner-approved, or changed after approval',
    )
  })

  it('refuses a stale mapping before applying any Auth update', () => {
    const mapping = seal(
      buildMapping({
        users,
        profiles,
        assignments,
        accountEmails: [],
        approvedEmails: new Set(['owner']),
      }),
    )

    expect(
      validateCurrentAuthUsers(mapping, [...users, { id: 'late-user', email: 'late@x.test' }]),
    ).toContain('late-user: current Auth user is absent from the approved mapping')
    expect(
      validateCurrentAuthUsers(mapping, [{ ...users[0], email: 'drifted@example.net' }, users[1]]),
    ).toContain('owner: Auth identifier drifted after the mapping was generated')
  })

  it('postflight proves aliases, approved account emails, and live pending invites together', () => {
    const mapping = seal(
      buildMapping({
        users,
        profiles,
        assignments,
        accountEmails: [],
        approvedEmails: new Set(['owner']),
      }),
    )
    const migratedUsers = mapping.users.map((row) => ({
      id: row.userId,
      email: row.newAlias,
    }))
    const report = auditMigrationState({
      mapping,
      users: migratedUsers,
      assignments,
      accountEmails: [{ profile_id: 'owner', email: 'owner.real@approved.test' }],
      invites: [
        {
          profile_id: 'staff',
          consumed_at: null,
          superseded_at: null,
          expires_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      now: '2026-07-30T00:00:00.000Z',
    })

    expect(report).toMatchObject({
      users: 2,
      liveOwners: 1,
      accountEmails: 1,
      livePendingInvites: 1,
      findings: [],
    })
  })
})
