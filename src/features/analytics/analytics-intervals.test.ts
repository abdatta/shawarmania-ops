import { describe, expect, it } from 'vitest'
import { hourTrend, HOURS, periodTrend, trendView } from './analytics-trend'
import { shiftDate } from '@/domain/sales-analytics'

function hours(
  at: string,
  values: Record<number, number | null> = {},
  cutover = '04:00:00',
  from = '2026-10-10',
  to = from,
) {
  const trend = periodTrend({
    days: [{ date: from, revenue: 0, orders: 0, units: 0, discounts: 0 }],
    from,
    to,
    periods: 2,
    grain: 'day',
    value: (d) => d.units,
    cutover,
  })
  const series = hourTrend(
    trend.periods,
    (period, hour) => (period ? 0 : values[hour] === undefined ? 0 : values[hour]!),
    cutover,
  )
  return {
    original: series,
    ...trendView(series, HOURS, from, to, 'hour', { now: Date.parse(at), cutover }),
  }
}
const point = (view: ReturnType<typeof hours>, hour: number, period = 0) =>
  view.series[period]!.points.find((p) =>
    p.label.includes(` · ${String(hour).padStart(2, '0')}:00`),
  )!

describe('clock-based analytics intervals', () => {
  it('preserves elapsed zeros and classifies after-midnight ongoing and future hours', () => {
    const view = hours('2026-10-11T02:45:00+05:30', { 23: 2 })
    expect(view.axis.slice(-5)).toEqual(['23:00', '00:00', '01:00', '02:00', '03:00'])
    expect([0, 1, 2, 3].map((h) => point(view, h).state)).toEqual([
      'completed',
      'completed',
      'ongoing',
      'future',
    ])
    expect(point(view, 23)).toMatchObject({ value: 2, state: 'completed' })
    expect(view.series[1]!.points.every((p) => p.state === 'completed')).toBe(true)
    expect(view.original[0]!.points.every((p) => !('state' in p))).toBe(true)
    expect(view.series[0]!.points.reduce((sum, p) => sum + (p.value ?? 0), 0)).toBe(2)
  })
  it('qualifies nonzero and zero ongoing hours, preserving null AOV', () => {
    for (const value of [2, 0, null]) {
      const view = hours('2026-10-10T23:30:00+05:30', { 23: value })
      expect(point(view, 23)).toMatchObject({ value, state: 'ongoing' })
      expect(point(view, 0).state).toBe('future')
    }
  })
  it('retains the ongoing hour even when only a comparison has later sales', () => {
    const view = hours('2026-10-10T12:30:00+05:30')
    expect(view.axis).toHaveLength(24)
    expect(point(view, 11).state).toBe('completed')
    expect(point(view, 12).state).toBe('ongoing')
  })
  it('becomes completed exactly at the next hour and at the outlet cutoff', () => {
    expect(point(hours('2026-10-11T03:00:00+05:30'), 2).state).toBe('completed')
    expect(point(hours('2026-10-11T03:00:00+05:30'), 3).state).toBe('ongoing')
    expect(
      hours('2026-10-11T04:00:00+05:30').series[0]!.points.every((p) => p.state === 'completed'),
    ).toBe(true)
  })
  it('honors a midnight cutoff and a fractional cutoff without splitting aggregate values', () => {
    const midnight = hours('2026-10-10T00:30:00+05:30', { 0: 2 }, '00:00:00')
    expect(midnight.axis[0]).toBe('00:00')
    expect(point(midnight, 0).state).toBe('ongoing')
    const split = hours('2026-10-11T04:15:00+05:30', { 4: 7 }, '04:30:00')
    expect(split.axis.at(-1)).toBe('04:00')
    expect(point(split, 4)).toMatchObject({ value: 7, state: 'ongoing' })
    expect(point(split, 4).label).toContain('cutoff hour (two parts)')
    expect(point(hours('2026-10-11T04:30:00+05:30', { 4: 7 }, '04:30:00'), 4).state).toBe(
      'completed',
    )
  })
  it('keeps completed historical zeros and repeated-clock-hour patterns complete or unclassified', () => {
    const historical = hours('2026-10-12T12:30:00+05:30', { 14: 2 })
    expect(historical.axis).toEqual(['13:00', '14:00', '15:00'])
    expect(historical.series[0]!.points.every((p) => p.state === 'completed')).toBe(true)
    const pattern = hours(
      '2026-10-10T12:30:00+05:30',
      { 14: 2 },
      '04:00:00',
      '2026-10-09',
      '2026-10-10',
    )
    expect(
      pattern.series[0]!.points.every((p) => p.state === undefined && p.interval === undefined),
    ).toBe(true)
  })
  it.each(['day', 'week'] as const)(
    'uses the included business-date boundaries for %s groups and comparisons',
    (grain) => {
      const from = '2026-10-04',
        to = '2026-10-10',
        cutover = '04:00:00'
      const days = Array.from({ length: 14 }, (_, i) => ({
        date: shiftDate(from, i - 7),
        revenue: 100,
        orders: 1,
        units: 1,
        discounts: 0,
      }))
      const trend = periodTrend({
        days,
        from,
        to,
        grain,
        periods: 2,
        value: (d) => d.units,
        cutover,
      })
      const view = trendView(trend.series, trend.axis, from, to, grain, {
        now: Date.parse('2026-10-11T02:45:00+05:30'),
        cutover,
      })
      expect(view.series[0]!.points.at(-1)).toMatchObject({
        state: 'ongoing',
        interval: { end: '2026-10-10T22:30:00.000Z' },
      })
      expect(view.series[0]!.points.slice(0, -1).every((p) => p.state === 'completed')).toBe(true)
      expect(view.series[1]!.points.every((p) => p.state === 'completed')).toBe(true)
      const completed = trendView(trend.series, trend.axis, from, to, grain, {
        now: Date.parse('2026-10-11T04:00:00+05:30'),
        cutover,
      })
      expect(completed.series[0]!.points.every((p) => p.state === 'completed')).toBe(true)
    },
  )
})
