import { describe, expect, it } from 'vitest'

import { liveAssignments } from '../adapters'
import { createDemoAccounts, createMockAccountsAdapter } from './accounts'
import {
  DEMO_HELPER_ACCOUNT_ID,
  PENDING_ACCOUNT_ID,
  RESET_PENDING_ACCOUNT_ID,
} from './fixtures/accounts'
import { OUTLET_KALYANI_ID } from './fixtures/outlets'

describe('mock accounts adapter', () => {
  it('carries truthful setup, reset, active, and deactivated lifecycle fixtures', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)
    const people = await adapter.listAccounts()

    expect(people.find((person) => person.id === PENDING_ACCOUNT_ID)?.lifecycle.kind).toBe(
      'setup_link_issued',
    )
    expect(people.find((person) => person.id === RESET_PENDING_ACCOUNT_ID)?.lifecycle.kind).toBe(
      'password_reset_issued',
    )
    expect(people.find((person) => person.id === DEMO_HELPER_ACCOUNT_ID)?.hasSignedIn).toBe(true)
    expect(people.find((person) => !person.isActive)?.lifecycle.kind).toBe('deactivated')
    expect(people.some((person) => person.lifecycle.kind === 'active')).toBe(true)
  })

  it('issues the handover purpose implied by sign-in history', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)

    const setup = await adapter.issueHandover(PENDING_ACCOUNT_ID)
    const reset = await adapter.issueHandover(DEMO_HELPER_ACCOUNT_ID)

    expect(setup.purpose).toBe('activation')
    expect(reset.purpose).toBe('password_reset')
    const people = await adapter.listAccounts()
    expect(people.find((person) => person.id === PENDING_ACCOUNT_ID)?.lifecycle.kind).toBe(
      'setup_link_issued',
    )
    expect(people.find((person) => person.id === DEMO_HELPER_ACCOUNT_ID)?.lifecycle.kind).toBe(
      'password_reset_issued',
    )
  })

  it('refuses handover issuance for an inactive account with the frozen error code', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)
    const inactive = accounts.find((person) => !person.isActive)
    if (!inactive) throw new Error('fixtures must include an inactive account')

    await expect(adapter.issueHandover(inactive.id)).rejects.toMatchObject({
      code: 'account_inactive',
    })
  })

  it('promotes atomically without deactivation and replaces only activation', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)
    const before = (await adapter.listAccounts()).find((person) => person.id === PENDING_ACCOUNT_ID)
    if (!before) throw new Error('fixture must include the pending account')
    const current = liveAssignments(before.assignments)
    const original = current[0]
    if (!original) throw new Error('fixture must include an assignment')

    const result = await adapter.editAccount({
      profileId: before.id,
      expectedStateFingerprint: before.stateFingerprint,
      fullName: 'Demo New Starter',
      phone: null,
      roleTitle: 'Prep',
      accountEmail: null,
      assignments: [
        {
          assignmentId: original.id,
          outletId: OUTLET_KALYANI_ID,
          role: 'biller',
          startedOn: original.startedOn,
        },
      ],
    })

    expect(result.replacementHandover?.purpose).toBe('activation')
    expect(result.stateFingerprint).not.toBe(before.stateFingerprint)
    const after = (await adapter.listAccounts()).find((person) => person.id === before.id)
    expect(after?.isActive).toBe(true)
    expect(liveAssignments(after?.assignments ?? [])).toEqual([
      expect.objectContaining({ role: 'biller', outletId: OUTLET_KALYANI_ID }),
    ])
    expect(
      after?.assignments.find((assignment) => assignment.id === original.id)?.endedOn,
    ).not.toBeNull()
  })

  it('preserves a reset handover through assignment editing and rejects stale writes', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)
    const before = (await adapter.listAccounts()).find(
      (person) => person.id === DEMO_HELPER_ACCOUNT_ID,
    )
    if (!before) throw new Error('fixture must include the reset account')
    const assignment = liveAssignments(before.assignments)[0]
    if (!assignment) throw new Error('fixture must include an assignment')

    const result = await adapter.editAccount({
      profileId: before.id,
      expectedStateFingerprint: before.stateFingerprint,
      fullName: before.fullName,
      phone: before.phone,
      roleTitle: before.roleTitle,
      accountEmail: before.accountEmail,
      assignments: [
        {
          assignmentId: assignment.id,
          outletId: assignment.outletId,
          role: 'biller',
          startedOn: assignment.startedOn,
        },
      ],
    })
    expect(result.replacementHandover).toBeNull()
    expect(
      (await adapter.listAccounts()).find((person) => person.id === before.id)?.lifecycle.kind,
    ).toBe('password_reset_issued')
    await expect(
      adapter.editAccount({
        profileId: before.id,
        expectedStateFingerprint: before.stateFingerprint,
        fullName: before.fullName,
        phone: before.phone,
        roleTitle: before.roleTitle,
        accountEmail: before.accountEmail,
        assignments: [],
      }),
    ).rejects.toMatchObject({ code: 'stale_edit' })
  })

  it('marks a person as left only through the explicit transition', async () => {
    const accounts = createDemoAccounts()
    const adapter = createMockAccountsAdapter(accounts)
    const before = (await adapter.listAccounts()).find(
      (person) => person.id === DEMO_HELPER_ACCOUNT_ID,
    )
    if (!before) throw new Error('fixture must include the reset account')

    const result = await adapter.markAsLeft(before.id, before.stateFingerprint)
    expect(result.assignments.every((assignment) => assignment.endedOn !== null)).toBe(true)
    const after = (await adapter.listAccounts()).find((person) => person.id === before.id)
    expect(after?.isActive).toBe(false)
    expect(after?.lifecycle.kind).toBe('deactivated')
  })
})
