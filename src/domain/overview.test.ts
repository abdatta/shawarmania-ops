import { describe, it, expect } from 'vitest'
import { outletPresence, overviewPeriod, revenueChange } from './overview'

describe('Overview periods', () => {
  it('excludes today from both periods', () => {
    expect(overviewPeriod('2026-09-08')).toEqual({
      month: '2026-09',
      from: '2026-09-01',
      through: '2026-09-07',
      previousFrom: '2026-08-01',
      previousThrough: '2026-08-07',
      fullMonth: false,
    })
  })
  it('compares full months on day one, including a year boundary', () => {
    expect(overviewPeriod('2026-01-01')).toMatchObject({
      month: '2025-12',
      through: '2025-12-31',
      previousThrough: '2025-11-30',
      fullMonth: true,
    })
    expect(overviewPeriod('2026-10-01').previousThrough).toBe('2026-08-31')
  })
  it('clamps shorter months and leap years', () => {
    expect(overviewPeriod('2026-03-31').previousThrough).toBe('2026-02-28')
    expect(overviewPeriod('2028-03-31').previousThrough).toBe('2028-02-29')
  })
  it('does not divide by an absent or zero baseline', () => {
    expect(revenueChange(100, 0)).toBeNull()
    expect(revenueChange(120, 100)).toBe(20)
    expect(revenueChange(80, 100)).toBe(-20)
  })
})

it('distinguishes all, some, none and stale tablets at the three-minute boundary', () => {
  const now = Date.parse('2026-09-08T10:00:00Z')
  const fresh = new Date(now - 180_000).toISOString()
  const stale = new Date(now - 180_001).toISOString()
  expect(outletPresence([fresh], now)).toBe('open')
  expect(outletPresence([fresh, stale], now)).toBe('partial')
  expect(outletPresence([stale, null], now)).toBe('closed')
  expect(outletPresence([], now)).toBe('closed')
})
