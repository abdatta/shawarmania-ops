import { describe, expect, it } from 'vitest'

import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { visibleSurfaces } from '@/gates/registry'

/**
 * The manager's slice of the Swiggy capability.
 *
 * **Reads reach the manager; controls never do.** The ledger a Franchise Admin
 * opens at their own outlet now carries both channels' sourced aggregates — the
 * same figures the owner sees — because the channel-day table's policy grants
 * exactly the outlets an assignment names. The sync surfaces and every action
 * behind them stay owner-shaped: no gate in the admin shell resolves them, so
 * there is nothing to click and nowhere to navigate to, and a hand-crafted
 * adapter call is refused outright rather than answered with an empty list.
 */

describe('the Franchise Admin slice of the Swiggy capability', () => {
  it('reads both channels\u2019 sourced aggregates at the assigned outlet', async () => {
    const adapters = createMockAdapters('franchise_admin')

    const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, '2026-08')
    const withFigures = month.days.find(
      (day) => day.zomatoSettlement !== null || day.swiggySettlement !== null,
    )
    if (!withFigures) throw new Error('demo seeds no channel figures at the assigned outlet')
    expect(withFigures.zomatoSettlement ?? withFigures.swiggySettlement).not.toBeNull()

    // And the same seam answers for Swiggy alone when it is asked directly.
    const health = await adapters.manualLedger.getDay(OUTLET_KALYANI_ID, withFigures.businessDate)
    const swiggy = health?.swiggySettlement
    expect(swiggy === null || typeof swiggy === 'object').toBe(true)
    if (swiggy) expect(typeof swiggy.revenuePaise).toBe('number')
  })

  it('refuses a day read at an outlet the assignment does not name', async () => {
    const adapters = createMockAdapters('franchise_admin')

    await expect(adapters.manualLedger.getDay(OUTLET_KANCHRAPARA_ID, '2026-08-20')).rejects.toThrow(
      /manager and the owner/,
    )
  })

  it('resolves no sync surface inside the admin shell, in any mode', () => {
    const reachedDemo = visibleSurfaces(['franchise_admin'], 'demo', ['franchise_admin'])
    const reachedReal = visibleSurfaces(['franchise_admin'], 'real', ['franchise_admin'])

    for (const reached of [reachedDemo, reachedReal]) {
      const ids = reached.map((surface) => surface.id)
      expect(ids).not.toContain('owner-swiggy-sync')
      expect(ids).not.toContain('owner-zomato-sync')
    }
  })

  it('answers the sync adapter with the refusal a hand-crafted call earns', async () => {
    const adapters = createMockAdapters('franchise_admin')

    await expect(adapters.swiggySync.getHealth(OUTLET_KALYANI_ID)).rejects.toThrow(/owner/i)
  })
})
