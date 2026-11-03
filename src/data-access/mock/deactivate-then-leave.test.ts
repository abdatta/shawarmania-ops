import { describe, expect, it } from 'vitest'

import type { ChangeGateKey } from '@/change-gates/gates'
import { shiftBusinessDate } from '@/domain'
import { describeChangeGate } from '@/test/change-gates'

import { deactivationDay, liveAssignments, wasActiveOn } from '../adapters'
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
  // Kalyani's clock: the day turns at 04:00, check-in closes at 13:00.
  const kalyani = { arrival_deadline: '13:00:00', business_day_cutover: '04:00:00' }
  const offAt = (instant: string) => ({ isActive: false, deactivatedAt: instant })

  it('is true every day for an active person', () => {
    expect(wasActiveOn({ isActive: true, deactivatedAt: null }, '2030-01-01', kalyani)).toBe(true)
  })

  it('leaves out the day of somebody switched off before its deadline', () => {
    const morning = offAt('2026-10-27T10:00:00+05:30')
    expect(wasActiveOn(morning, '2026-10-26', kalyani)).toBe(true)
    expect(wasActiveOn(morning, '2026-10-27', kalyani)).toBe(false)
  })

  it('keeps the day of somebody switched off after its deadline, and no later day', () => {
    const afternoon = offAt('2026-10-27T15:00:00+05:30')
    expect(wasActiveOn(afternoon, '2026-10-27', kalyani)).toBe(true)
    expect(wasActiveOn(afternoon, '2026-10-28', kalyani)).toBe(false)
  })

  it('reads 02:00 as the end of the business day before, not the start of the next', () => {
    const night = offAt('2026-10-28T02:00:00+05:30')
    expect(wasActiveOn(night, '2026-10-27', kalyani)).toBe(true)
    expect(wasActiveOn(night, '2026-10-28', kalyani)).toBe(false)
  })

  it('is true for an inactive account whose moment was never recorded', () => {
    expect(wasActiveOn({ isActive: false, deactivatedAt: null }, '2030-01-01', kalyani)).toBe(true)
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
    expect(deactivationDay(find(DEMO_HELPER_ACCOUNT_ID).deactivatedAt!)).toBe(kolkataToday())
    // Their outlet stays: deactivating is about sign-in, not placement.
    expect(liveAssignments(find(DEMO_HELPER_ACCOUNT_ID).assignments)).toHaveLength(1)

    await adapter.setActive(DEMO_HELPER_ACCOUNT_ID, true)
    expect(find(DEMO_HELPER_ACCOUNT_ID).deactivatedAt).toBeNull()
  })

  it('carries the deactivated Biller’s day, ten days back', () => {
    const accounts = createDemoAccounts()
    const biller = accounts.find((account) => account.id === DEMO_DEACTIVATED_BILLER_ACCOUNT_ID)!
    expect(biller.isActive).toBe(false)
    expect(deactivationDay(biller.deactivatedAt!)).toBe(shiftBusinessDate(kolkataToday(), -10))
    const prepCook = accounts.find((a) => a.id === DEMO_PREP_COOK_ACCOUNT_ID)!
    expect(deactivationDay(prepCook.deactivatedAt!)).toBe(kolkataToday())
    expect(Date.parse(prepCook.deactivatedAt!)).toBeLessThanOrEqual(Date.now())
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
    const day = deactivationDay(biller.deactivatedAt!)

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
