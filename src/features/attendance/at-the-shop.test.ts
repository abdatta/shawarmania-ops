import { describe, expect, it } from 'vitest'

import { shopVerdict, type ShopFence } from './at-the-shop'

// Kalyani Cafe's stored position and radius, as production has them.
const CAFE: ShopFence = {
  latitude: 22.9737628,
  longitude: 88.437085,
  geofence_radius_m: 150,
  attendance_needs_manager: false,
  attendance_blocks_away: false,
}

/** A point `metres` due north of the cafe (one degree of latitude ≈ 111,195 m). */
function north(metres: number) {
  return { latitude: CAFE.latitude! + metres / 111_194.93, longitude: CAFE.longitude! }
}

describe('shopVerdict', () => {
  it('approves a reading inside the fence', () => {
    expect(shopVerdict(north(15), CAFE, [])).toBe('approve')
  })

  it('approves a rough reading inside the fence, because accuracy is not asked', () => {
    // 25 Oct: 31 m at ±104 m. The reading carries no accuracy here at all.
    expect(shopVerdict(north(31), CAFE, [])).toBe('approve')
  })

  it('approves a reading on the radius itself', () => {
    expect(shopVerdict(north(149.9), CAFE, [])).toBe('approve')
  })

  it('waits for a reading outside the fence', () => {
    expect(shopVerdict(north(151), CAFE, [])).toBe('wait')
  })

  it('waits for no position', () => {
    expect(shopVerdict(null, CAFE, [])).toBe('wait')
  })

  it('waits at an outlet never surveyed', () => {
    expect(shopVerdict(north(5), { ...CAFE, latitude: null, longitude: null }, [])).toBe('wait')
  })

  it('waits when the reading is inside another assigned outlet too', () => {
    // Old Kalyani sits about 210 m away, so the two fences overlap.
    const kalyani = { latitude: 22.9752591, longitude: 88.4357856, geofence_radius_m: 150 }
    expect(shopVerdict(north(120), CAFE, [kalyani])).toBe('wait')
    expect(shopVerdict(north(-60), CAFE, [kalyani])).toBe('approve')
  })

  it('waits inside the fence when the outlet asks a manager for every check-in', () => {
    expect(shopVerdict(north(15), { ...CAFE, attendance_needs_manager: true }, [])).toBe('wait')
  })

  describe('with check-ins away from the shop blocked', () => {
    const blocking = { ...CAFE, attendance_blocks_away: true }

    it('refuses a reading outside the fence', () => {
      expect(shopVerdict(north(2600), blocking, [])).toBe('refuse')
    })

    it('refuses a check-in with no position', () => {
      expect(shopVerdict(null, blocking, [])).toBe('refuse')
    })

    it('refuses every check-in at an outlet never surveyed', () => {
      expect(shopVerdict(north(5), { ...blocking, latitude: null, longitude: null }, [])).toBe(
        'refuse',
      )
    })

    it('still approves a reading inside the fence', () => {
      expect(shopVerdict(north(15), blocking, [])).toBe('approve')
    })

    it('waits, not refuses, inside the fence when a manager approves every check-in', () => {
      expect(shopVerdict(north(15), { ...blocking, attendance_needs_manager: true }, [])).toBe(
        'wait',
      )
    })
  })
})
