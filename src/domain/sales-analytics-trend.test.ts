import { describe, expect, it } from 'vitest'
import { periodDirection, periodUnit, usualRange } from './sales-analytics'

describe('direction across compared periods', () => {
  it('reads a steady climb as rising, at its rate per period', () => {
    const trend = periodDirection([100, 110, 120, 130])
    expect(trend.direction).toBe('up')
    expect(trend.rate).toBeCloseTo(10 / 115)
  })
  it('reads a steady decline as falling', () => {
    expect(periodDirection([160, 130, 80, 60]).direction).toBe('down')
  })
  it('holds steady when the line barely moves', () => {
    expect(periodDirection([100, 102, 101, 103])).toEqual({ direction: 'flat', rate: null })
  })
  it('holds steady when one odd period is all the movement there is', () => {
    // A slope of about 7% a period, but the zig-zag around it is bigger.
    expect(periodDirection([100, 160, 90, 150]).direction).toBe('flat')
  })
  it('needs three periods and something sold', () => {
    expect(periodDirection([100, 200]).direction).toBe('flat')
    expect(periodDirection([0, 0, 0]).direction).toBe('flat')
  })
})

describe('the usual range', () => {
  it('is the earlier average give or take their spread', () => {
    const usual = usualRange(170, [150, 160, 140])!
    expect(usual.low).toBeCloseTo(140)
    expect(usual.high).toBeCloseTo(160)
    expect(usual.position).toBe('above')
    expect(usualRange(150, [150, 160, 140])!.position).toBe('about')
    expect(usualRange(120, [150, 160, 140])!.position).toBe('below')
  })
  it('leaves 5% either side when the earlier periods were identical', () => {
    expect(usualRange(104, [100, 100, 100])!.position).toBe('about')
    expect(usualRange(106, [100, 100, 100])!.position).toBe('above')
  })
  it('needs two earlier periods', () => {
    expect(usualRange(100, [90])).toBeNull()
  })
  it('names the period by the range', () => {
    expect([1, 7, 30, 31, 14].map(periodUnit)).toEqual(['day', 'wk', 'mo', 'mo', '14d'])
  })
})
