import { describe, expect, it } from 'vitest'
import {
  alignedTrend,
  cumulativeSeries,
  hourTrend,
  periodTrend,
  seriesDays,
} from './analytics-trend'

describe('a period trend', () => {
  const series = seriesDays({
    from: '2026-09-26',
    // 26 Sept–2 Oct, then 3–9 Oct: one dish's units, one value per day.
    units: [1, 2, 0, 4, 5, 6, 7, 10, 0, 0, 3, 0, 0, 1],
    revenue: [100, 200, 0, 400, 500, 600, 700, 1000, 0, 0, 300, 0, 0, 100],
    hourUnits: Array(48).fill(0),
    hourRevenue: Array(48).fill(0),
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

  it('draws 24 Kolkata clock hours per window, labelled with that window', () => {
    const { periods } = periodTrend({
      days: series,
      from: '2026-10-03',
      to: '2026-10-09',
      periods: 2,
      grain: 'day',
      value: (d) => d.units,
    })
    const hours = hourTrend(periods, (period, hour) => period * 100 + hour)
    expect(hours.map((s) => s.points.length)).toEqual([24, 24])
    expect(hours[1]!.points[13]).toEqual({ label: '26 Sept–2 Oct · 13:00', value: 113 })
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

describe('a running total', () => {
  const day = (date: string, revenue: number, orders: number) => ({
    date,
    revenue,
    orders,
    units: orders,
    discounts: 0,
  })

  it('adds each point, runs flat across a zero, and keeps labels, intervals and states', () => {
    // Not started is no figure yet, as `— · not started`, not the total so far.
    const [running] = cumulativeSeries([
      {
        label: 'This week',
        points: [
          { label: '1', value: 10, state: 'completed', interval: { start: 'a', end: 'b' } },
          { label: '2', value: 0, state: 'completed' },
          { label: '3', value: 5, state: 'ongoing' },
          { label: '4', value: 0, state: 'future' },
        ],
      },
    ])
    expect(running!.label).toBe('This week')
    expect(running!.points).toEqual([
      { label: '1', value: 10, state: 'completed', interval: { start: 'a', end: 'b' } },
      { label: '2', value: 10, state: 'completed' },
      { label: '3', value: 15, state: 'ongoing' },
      { label: '4', value: null, state: 'future' },
    ])
  })

  it('leaves a point an earlier window does not reach as a gap', () => {
    const trend = alignedTrend({
      days: [day('2026-10-01', 100, 1), day('2026-10-02', 200, 1), day('2026-09-01', 50, 1)],
      windows: [
        { first: '2026-10-01', last: '2026-10-02' },
        { first: '2026-09-01', last: '2026-09-01' },
      ],
      grain: 'day',
      value: (b) => b.revenue,
    })
    expect(cumulativeSeries(trend.series).map((s) => s.points.map((p) => p.value))).toEqual([
      [100, 300],
      [50, null],
    ])
  })

  it('reads AOV as revenue so far over bills so far, held across a day without bills', () => {
    const trend = periodTrend({
      days: [
        day('2026-10-07', 0, 0),
        day('2026-10-08', 30000, 2),
        day('2026-10-09', 0, 0),
        day('2026-10-10', 10000, 2),
      ],
      from: '2026-10-07',
      to: '2026-10-10',
      periods: 1,
      grain: 'day',
      value: (b) => (b.orders ? Math.round(b.revenue / b.orders) : null),
      bills: true,
    })
    expect(trend.series[0]!.points.map((p) => p.value)).toEqual([null, 15000, null, 5000])
    // Not (15000 + 5000) / 2: four bills came to ₹400.
    expect(cumulativeSeries(trend.series)[0]!.points.map((p) => p.value)).toEqual([
      null,
      15000,
      15000,
      10000,
    ])
  })

  it('carries bills only where asked, and not past the end of an earlier window', () => {
    const days = [day('2026-10-01', 900, 3), day('2026-10-02', 0, 0), day('2026-09-01', 400, 2)]
    const windows = [
      { first: '2026-10-01', last: '2026-10-02' },
      { first: '2026-09-01', last: '2026-09-01' },
    ]
    const aov = (b: { revenue: number; orders: number }) =>
      b.orders ? Math.round(b.revenue / b.orders) : null
    expect(
      alignedTrend({ days, windows, grain: 'day', value: aov }).series[0]!.points[0]!.bills,
    ).toBeUndefined()
    const trend = alignedTrend({ days, windows, grain: 'day', value: aov, bills: true })
    expect(trend.series[1]!.points.map((p) => p.bills)).toEqual([
      { revenue: 400, orders: 2 },
      undefined,
    ])
    expect(cumulativeSeries(trend.series).map((s) => s.points.map((p) => p.value))).toEqual([
      [300, 300],
      [200, null],
    ])
    const hours = hourTrend(
      trend.periods,
      () => null,
      undefined,
      (period, hour) => ({ revenue: period * 100 + hour, orders: 1 }),
    )
    expect(hours[1]!.points[13]!.bills).toEqual({ revenue: 113, orders: 1 })
  })
})
