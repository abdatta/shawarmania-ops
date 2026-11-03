import { describe, expect, it } from 'vitest'

import type { ChangeGateKey } from '@/change-gates/gates'
import { shiftBusinessDate } from '@/domain'
import { describeChangeGate } from '@/test/change-gates'

import { liveAssignments, wasActiveOn } from '../adapters'
import { createDemoAccounts, createMockAccountsAdapter } from './accounts'
import {
  DEMO_DEACTIVATED_BILLER_ACCOUNT_ID,
  DEMO_HELPER_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
} from './fixtures/accounts'
import { OUTLET_KALYANI_ID } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

/**
 * A deactivated person leaves in two steps (a-deactivated-person-leaves-in-two-steps):
 * `wasActiveOn`, and the demo's copy of what the account function does with
 * `deactivate-then-leave` and `owner-access-in-the-database` (design D2, D3, D5).
 */

const kolkataToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

describe('wasActiveOn', () => {
  const deactivated = { isActive: false, deactivatedOn: '2026-10-12' }

  it('is true every day for an active person', () => {
    expect(wasActiveOn({ isActive: true, deactivatedOn: null }, '2030-01-01')).toBe(true)
  })

  it('is true before and on the deactivation day, and false after it', () => {
    expect(wasActiveOn(deactivated, '2026-10-11')).toBe(true)
    expect(wasActiveOn(deactivated, '2026-10-12')).toBe(true)
    expect(wasActiveOn(deactivated, '2026-10-13')).toBe(false)
  })

  it('is true for an inactive account whose day was never recorded', () => {
    expect(wasActiveOn({ isActive: false, deactivatedOn: null }, '2030-01-01')).toBe(true)
  })
})

function adapterWith(
  on: Partial<Record<ChangeGateKey, boolean>>,
  role: 'super_admin' | 'franchise_admin' = 'super_admin',
) {
  const accounts = createDemoAccounts()
  const adapter = createMockAccountsAdapter(
    accounts,
    role,
    personaFixtures[role].profile.id,
    (key) => on[key] === true,
  )
  const find = (id: string) => accounts.find((account) => account.id === id)!
  return { adapter, find }
}

describe('a deactivation in the demo', () => {
  it('records the day, and reactivating clears it', async () => {
    const { adapter, find } = adapterWith({})
    await adapter.setActive(DEMO_HELPER_ACCOUNT_ID, false)
    expect(find(DEMO_HELPER_ACCOUNT_ID).deactivatedOn).toBe(kolkataToday())
    // Their outlet stays: deactivating is about sign-in, not placement.
    expect(liveAssignments(find(DEMO_HELPER_ACCOUNT_ID).assignments)).toHaveLength(1)

    await adapter.setActive(DEMO_HELPER_ACCOUNT_ID, true)
    expect(find(DEMO_HELPER_ACCOUNT_ID).deactivatedOn).toBeNull()
  })

  it('carries the deactivated Biller’s day, ten days back', () => {
    const accounts = createDemoAccounts()
    const biller = accounts.find((account) => account.id === DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)!
    expect(biller.isActive).toBe(false)
    expect(biller.deactivatedOn).toBe(shiftBusinessDate(kolkataToday(), -10))
    expect(accounts.find((a) => a.id === DEMO_PREP_COOK_ACCOUNT_ID)?.deactivatedOn).toBe(
      kolkataToday(),
    )
  })
})

describeChangeGate('deactivate-then-leave', (on) => {
  if (!on) {
    it('refuses the new Mark as left', async () => {
      const { adapter, find } = adapterWith({})
      const biller = find(DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)
      await expect(adapter.markAsLeftV2(biller.id, biller.stateFingerprint)).rejects.toMatchObject({
        code: 'not_available',
      })
      expect(liveAssignments(biller.assignments)).toHaveLength(1)
    })
    return
  }

  it('refuses somebody still active: deactivate first', async () => {
    const { adapter, find } = adapterWith({ 'deactivate-then-leave': true })
    const helper = find(DEMO_HELPER_ACCOUNT_ID)
    await expect(adapter.markAsLeftV2(helper.id, helper.stateFingerprint)).rejects.toMatchObject({
      code: 'account_active',
    })
  })

  it('ends their outlets on the day they were deactivated and frees username and phone', async () => {
    const { adapter, find } = adapterWith({ 'deactivate-then-leave': true }, 'franchise_admin')
    const biller = find(DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)
    const day = biller.deactivatedOn!

    await expect(adapter.markAsLeftV2(biller.id, biller.stateFingerprint)).resolves.toEqual({
      leftOn: day,
    })
    expect(biller.assignments.every((assignment) => assignment.endedOn === day)).toBe(true)
    expect(biller.phone).toBeNull()
    expect(biller.username).toBeNull()
  })

  it('lets a new person take the username a leaver held', async () => {
    const { adapter, find } = adapterWith({ 'deactivate-then-leave': true })
    const biller = find(DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)
    const username = biller.username!
    await adapter.markAsLeftV2(biller.id, biller.stateFingerprint)

    await expect(
      adapter.provision({
        fullName: 'Rehired Biller',
        username,
        role: 'biller',
        outletIds: [OUTLET_KALYANI_ID],
      }),
    ).resolves.toMatchObject({ username })
  })
})

describeChangeGate('owner-access-in-the-database', (on) => {
  it(on ? 'refuses an owner provisioned from the app' : 'provisions an owner', async () => {
    const { adapter } = adapterWith({ 'owner-access-in-the-database': on })
    const provisioning = adapter.provision({
      fullName: 'Second Owner',
      username: 'second.owner',
      accountEmail: 'second.owner@example.com',
      role: 'super_admin',
      outletIds: [],
    })
    if (on) await expect(provisioning).rejects.toMatchObject({ code: 'owner_access_in_database' })
    else await expect(provisioning).resolves.toMatchObject({ username: 'second.owner' })
  })

  it(
    on ? 'refuses owner access granted by an edit' : 'grants owner access by an edit',
    async () => {
      const { adapter, find } = adapterWith({ 'owner-access-in-the-database': on })
      const helper = find(DEMO_HELPER_ACCOUNT_ID)
      const [kalyani] = liveAssignments(helper.assignments)
      const editing = adapter.editAccount({
        profileId: helper.id,
        expectedStateFingerprint: helper.stateFingerprint,
        fullName: helper.fullName,
        phone: helper.phone,
        roleTitle: helper.roleTitle,
        accountEmail: 'helper.owner@example.com',
        assignments: [
          {
            assignmentId: kalyani!.id,
            outletId: kalyani!.outletId,
            role: kalyani!.role,
            startedOn: kalyani!.startedOn,
          },
          { assignmentId: null, outletId: null, role: 'super_admin', startedOn: kolkataToday() },
        ],
      })
      if (on) await expect(editing).rejects.toMatchObject({ code: 'owner_access_in_database' })
      else await expect(editing).resolves.toMatchObject({ profileId: helper.id })
    },
  )
})
