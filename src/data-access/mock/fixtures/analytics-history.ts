import { shiftBusinessDate } from '@/domain'
import { menuItemFixtures, menuItemId, menuItemKeys } from './menu'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import type { BillSeed } from './billing'

/** Generated once per walkthrough; no giant JSON fixture or analytics-only totals. */
export function analyticsHistorySeeds(today: string): BillSeed[] {
  const seeds: BillSeed[] = []
  for (let age = 185; age >= 4; age--) {
    const date = shiftBusinessDate(today, -age)
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    // Weekly quiet dates preserve meaningful zero-day analytics and Ledger coverage.
    if (weekday === 1) continue
    for (const [outletIndex, outletId] of [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID].entries()) {
      let randomState = age * 901 + outletIndex * 1789 + 71
      const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        return randomState / 4294967296
      }
      const candidates = menuItemKeys.flatMap((key) => {
        const item = menuItemFixtures.find((i) => i.id === menuItemId(outletId, key))!
        if (
          !item.is_available ||
          /Black Coffee|Avocado Mushroom|Chicken & Cheese Sandwich/.test(item.name)
        )
          return []
        let weight = 3
        if (key === 'classic') weight = 35
        if (key === 'mayo') weight = age > 45 ? 40 : 4
        if (key === 'cheese') weight = age > 60 ? 4 : 35
        if (key === 'burger') weight = age > 60 ? 6 : 24
        if (key === 'taco-chicken-shawarma') weight = age > 35 ? 0 : 16
        return weight ? [{ key, weight }] : []
      })
      const weightTotal = candidates.reduce((sum, i) => sum + i.weight, 0)
      const pick = () => {
        let position = random() * weightTotal
        return candidates.find((i) => (position -= i.weight) < 0)!.key
      }
      const weekend = weekday === 0 || weekday === 5 || weekday === 6
      const orders = Math.round(
        (19 + (weekend ? 10 : 0) + Math.floor((185 - age) / 18) + random() * 6) *
          (outletIndex ? 0.75 : 1),
      )
      for (let order = 0; order < orders; order++) {
        const quantities = new Map<ReturnType<typeof pick>, number>()
        const count = random() < 0.25 ? 3 : 2
        for (let line = 0; line < count; line++) {
          const key = pick()
          quantities.set(key, (quantities.get(key) ?? 0) + (random() < 0.18 ? 2 : 1))
        }
        const hour = random() < 0.7 ? 17 + Math.floor(random() * 6) : 12 + Math.floor(random() * 5)
        seeds.push({
          outletId,
          daysAgo: age,
          time: `${hour}:${String(Math.floor(random() * 60)).padStart(2, '0')}`,
          // Archived non-cash payments preserve the rehearsed four-day drawer scenario.
          paymentMethod: 'upi',
          lines: [...quantities].map(([item, quantity]) => ({ item, quantity })),
          ...(order % 11 === 0 ? { discountBp: 500 } : {}),
        })
      }
    }
  }
  return seeds.sort((a, b) => b.daysAgo - a.daysAgo || a.time.localeCompare(b.time))
}
