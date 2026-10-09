import { describe, expect, it } from 'vitest'
import { periodTrend, seriesDays } from './analytics-trend'

describe('a period trend', () => {
  const series = seriesDays({
    from: '2026-09-26',
    // 26 Sept–2 Oct, then 3–9 Oct: one dish's units, one value per day.
    units: [1, 2, 0, 4, 5, 6, 7, 10, 0, 0, 3, 0, 0, 1],
    revenue: [100, 200, 0, 400, 500, 600, 700, 1000, 0, 0, 300, 0, 0, 100],
  })

  it('aligns the earlier window by elapsed day and labels its actual dates', () => {
    const trend = periodTrend({
      days: series,
      from: '2026-10-03',
      to: '2026-10-09',
      periods: 2,
      grain: 'day',
      value: (d) => d.units,
    })
    expect(trend.axis).toEqual(['3 Oct', '4 Oct', '5 Oct', '6 Oct', '7 Oct', '8 Oct', '9 Oct'])
    expect(trend.series[0]!.points.map((p) => p.value)).toEqual([10, 0, 0, 3, 0, 0, 1])
    expect(trend.series[1]!.points.map((p) => p.value)).toEqual([1, 2, 0, 4, 5, 6, 7])
    expect(trend.series[1]!.points[0]!.label).toBe('26 Sept')
    expect(trend.periods.map((p) => [p.label, p.total.units])).toEqual([
      ['3–9 Oct', 14],
      ['26 Sept–2 Oct', 25],
    ])
  })

  it('groups Monday weeks with partial boundary weeks of selected dates only', () => {
    const trend = periodTrend({
      days: series,
      from: '2026-10-03',
      to: '2026-10-09',
      periods: 2,
      grain: 'week',
      value: (d) => d.revenue,
    })
    // Sat 3–Sun 4 Oct, then Mon 5–Fri 9 Oct.
    expect(trend.axis).toEqual(['3–4 Oct', '5–9 Oct'])
    expect(trend.series[0]!.points.map((p) => p.value)).toEqual([1000, 400])
    expect(trend.series[1]!.points.map((p) => [p.label, p.value])).toEqual([
      ['26–27 Sept', 300],
      ['28 Sept–2 Oct', 2200],
    ])
  })
})
