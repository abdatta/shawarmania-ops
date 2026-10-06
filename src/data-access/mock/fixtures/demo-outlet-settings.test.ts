import { describe, expect, it } from 'vitest'

import { createDemoData } from '..'
import { OUTLET_KALYANI_ID } from './outlets'

/**
 * The demo's Kalyani counter bills the way the owner's shop does, read off
 * their own Orders and Loyalty screens [owner, 2026-10-06]
 * (the-demo-bills-like-the-shop). Pinned in one place, so a later fixture edit
 * that drifts from the shop has to say so here.
 */
describe('the demo’s Kalyani', () => {
  it('takes orders with the owner’s settings', () => {
    expect(createDemoData().store.serviceSettings.get(OUTLET_KALYANI_ID)).toEqual({
      collectCustomerDetails: true,
      dineInOffered: true,
      takeawayOffered: true,
      tableNumbers: true,
      packagingMode: 'per_order',
      packagingPricePaise: 1_000,
      packagingFreeForGold: true,
    })
  })

  it('runs points and gold with the owner’s numbers', () => {
    expect(createDemoData().store.loyaltySettings.get(OUTLET_KALYANI_ID)).toEqual({
      pointsEnabled: true,
      earnPoints: 5,
      earnBlockPaise: 20_000,
      useCapBp: 500,
      goldEnabled: true,
      goldEarnMultiplierX100: 100,
      goldUseCapBp: 3_000,
      goldDurationMonths: 6,
      goldCounterGrant: true,
      goldThresholdPaise: 200_000,
    })
  })
})
