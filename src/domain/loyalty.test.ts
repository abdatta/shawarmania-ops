import { describe, expect, it } from 'vitest'

import {
  ALL_OFF_LOYALTY_SETTINGS,
  earnBasisPaise,
  earnRate,
  goldEligible,
  goldEndsAt,
  goldInForce,
  loyaltySettingsProblem,
  multiplierLabel,
  pointsEarned,
  pointsUsableMax,
  withCounterGoldSwitched,
  withGoldSwitched,
  withPointsSwitched,
  type OutletLoyaltySettings,
} from './loyalty'

const on: OutletLoyaltySettings = withCounterGoldSwitched(
  withGoldSwitched(withPointsSwitched(ALL_OFF_LOYALTY_SETTINGS, true), true),
  true,
)

describe('the rules an outlet chooses', () => {
  it('starts with everything off, and that is a valid outlet', () => {
    expect(loyaltySettingsProblem(ALL_OFF_LOYALTY_SETTINGS)).toBeNull()
  })

  it('switches on at the owner’s numbers', () => {
    expect(on).toMatchObject({
      earnPoints: 5,
      earnBlockPaise: 20_000,
      useCapBp: 1_000,
      goldEnabled: true,
      goldEarnMultiplierX100: 100,
      goldUseCapBp: 5_000,
      goldDurationMonths: 6,
      goldCounterGrant: true,
      goldThresholdPaise: 200_000,
    })
    expect(loyaltySettingsProblem(on)).toBeNull()
  })

  it('clears every points rule when points go off, the gold cap included', () => {
    const off = withPointsSwitched(on, false)
    expect(off).toMatchObject({ earnPoints: null, useCapBp: null, goldUseCapBp: null })
    expect(loyaltySettingsProblem(off)).toBeNull()
  })

  it('takes billers’ grants with it when gold goes off, and keeps points', () => {
    const off = withGoldSwitched(on, false)
    expect(off).toMatchObject({
      goldEnabled: false,
      goldUseCapBp: null,
      goldCounterGrant: false,
      goldThresholdPaise: null,
      earnPoints: 5,
    })
    expect(loyaltySettingsProblem(off)).toBeNull()
  })

  it('refuses a fractional rupee, a gold cap under everybody’s, and a multiplier under 1×', () => {
    expect(loyaltySettingsProblem({ ...on, earnBlockPaise: 20_050 })).toBe('earn_rate_invalid')
    expect(loyaltySettingsProblem({ ...on, goldUseCapBp: 10_001 })).toBe('cap_out_of_range')
    expect(loyaltySettingsProblem({ ...on, goldUseCapBp: 900 })).toBe('gold_cap_below_cap')
    expect(loyaltySettingsProblem({ ...on, goldEarnMultiplierX100: 99 })).toBe(
      'multiplier_out_of_range',
    )
    expect(loyaltySettingsProblem({ ...on, goldThresholdPaise: 199_950 })).toBe('threshold_invalid')
    expect(loyaltySettingsProblem({ ...on, goldDurationMonths: 0 })).toBe('duration_out_of_range')
    expect(loyaltySettingsProblem({ ...on, goldEnabled: false })).toBe('gold_cap_while_off')
  })
})

describe('earning', () => {
  const rate = earnRate(on, false)

  it('is proportional and rounds down per bill', () => {
    expect(pointsEarned(39_900, rate)).toBe(9)
    expect(pointsEarned(20_000, rate)).toBe(5)
    expect(pointsEarned(3_900, rate)).toBe(0)
  })

  it('is on the bill before points, after other discounts', () => {
    // ₹200 paid as ₹180 and 20 points earns on the ₹200.
    expect(
      earnBasisPaise({ subtotalPaise: 20_000, discountPaise: 2_000, pointsDiscountPaise: 2_000 }),
    ).toBe(20_000)
    // ₹300 with ₹100 off by hand earns on ₹200.
    expect(
      earnBasisPaise({ subtotalPaise: 30_000, discountPaise: 10_000, pointsDiscountPaise: 0 }),
    ).toBe(20_000)
  })

  it('multiplies a gold bill’s points where gold is on, and nowhere else', () => {
    const faster = { ...on, goldEarnMultiplierX100: 150 }
    expect(pointsEarned(39_900, earnRate(faster, true))).toBe(14)
    expect(pointsEarned(39_900, earnRate(faster, false))).toBe(9)
    expect(pointsEarned(39_900, earnRate(withGoldSwitched(faster, false), true))).toBe(9)
    expect(earnRate(ALL_OFF_LOYALTY_SETTINGS, false)).toBeNull()
  })

  it('words a multiplier as the owner types it', () => {
    expect(multiplierLabel(100)).toBe('1×')
    expect(multiplierLabel(120)).toBe('1.2×')
    expect(multiplierLabel(125)).toBe('1.25×')
  })
})

describe('using', () => {
  it('caps a regular at 10% and a gold member at 50% of the order after other discounts', () => {
    expect(pointsUsableMax({ settings: on, balance: 80, gold: false, netPaise: 30_000 })).toBe(30)
    expect(pointsUsableMax({ settings: on, balance: 80, gold: true, netPaise: 30_000 })).toBe(80)
  })

  it('gives a gold member everybody’s cap at an outlet with gold off', () => {
    const off = withGoldSwitched(on, false)
    expect(pointsUsableMax({ settings: off, balance: 80, gold: true, netPaise: 30_000 })).toBe(30)
  })

  it('never offers more than the balance, nor the last rupee', () => {
    expect(pointsUsableMax({ settings: on, balance: 7, gold: true, netPaise: 30_000 })).toBe(7)
    const all = { ...on, goldUseCapBp: 10_000 }
    expect(pointsUsableMax({ settings: all, balance: 999, gold: true, netPaise: 30_000 })).toBe(299)
  })

  it('offers nothing from a balance that is not positive, or at an outlet with points off', () => {
    expect(pointsUsableMax({ settings: on, balance: -4, gold: false, netPaise: 30_000 })).toBe(0)
    expect(
      pointsUsableMax({
        settings: ALL_OFF_LOYALTY_SETTINGS,
        balance: 80,
        gold: false,
        netPaise: 30_000,
      }),
    ).toBe(0)
  })
})

describe('gold', () => {
  it('ends on the date its grant stored, falling back to the month’s last day', () => {
    expect(goldEndsAt('2026-10-01T06:00:00.000Z', 6)).toBe('2027-04-01T06:00:00.000Z')
    expect(goldEndsAt('2026-08-31T06:00:00.000Z', 6)).toBe('2027-02-28T06:00:00.000Z')
  })

  it('is in force between its grant and the earlier of its end and its revocation', () => {
    const spell = {
      grantedAt: '2026-10-01T00:00:00.000Z',
      revokedAt: null,
      expiresAt: '2027-04-01T00:00:00.000Z',
    }
    expect(goldInForce(spell, '2026-12-01T00:00:00.000Z')).toBe(true)
    expect(goldInForce(spell, '2027-04-01T00:00:00.000Z')).toBe(false)
    expect(
      goldInForce({ ...spell, revokedAt: '2026-11-01T00:00:00.000Z' }, '2026-12-01T00:00:00.000Z'),
    ).toBe(false)
  })

  it('is offered at the monthly spend exactly, and not a paisa under', () => {
    expect(goldEligible({ settings: on, isGold: false, spendInWindowPaise: 200_000 })).toBe(true)
    expect(goldEligible({ settings: on, isGold: false, spendInWindowPaise: 199_999 })).toBe(false)
    expect(goldEligible({ settings: on, isGold: true, spendInWindowPaise: 500_000 })).toBe(false)
  })

  it('is never offered where billers may not grant it, or the outlet has no gold', () => {
    for (const settings of [withCounterGoldSwitched(on, false), withGoldSwitched(on, false)]) {
      expect(goldEligible({ settings, isGold: false, spendInWindowPaise: 500_000 })).toBe(false)
    }
  })
})
