import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyticsChart, metricText, rangeLabel } from './analytics-chart'
import { AnalyticsControls } from './analytics-controls'
import { SALES_GRAINS, SALES_METRICS } from './analytics-trend'
import { SalesPanel } from './sales-panel'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'

/** The trend card keeps Chart/Table in the address, so panels render under a router. */
const inRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)
import type { AnalyticsSnapshot } from '@/data-access/analytics'

describe('interactive sales figures', () => {
  it.each(['units', 'revenue', 'orders', 'aov'] as const)(
    'never draws an ongoing zero or null %s point and retains completed zero connections',
    (metric) => {
      render(
        <AnalyticsChart
          id="zero"
          title="Zero interval"
          metric={metric}
          axis={['12', '13', '14', '15']}
          series={[
            {
              label: 'Today',
              points: [
                { label: '12', value: 10, state: 'completed' },
                { label: '13', value: 0, state: 'completed' },
                { label: '14', value: metric === 'aov' ? null : 0, state: 'ongoing' },
                { label: '15', value: 0, state: 'future' },
              ],
            },
          ]}
        />,
      )
      const plot = screen.getByTestId('zero')
      expect(within(plot).getAllByTestId('chart-point')).toHaveLength(2)
      const group = within(plot).getByTestId('chart-series')
      expect(group.querySelectorAll('line')).toHaveLength(1)
      expect(group.querySelectorAll('circle')[1]).toHaveAttribute('cy', '146')
      fireEvent.keyDown(within(plot).getByRole('group'), { key: 'End' })
      expect(within(plot).getAllByTestId('chart-point')).toHaveLength(2)
      expect(within(plot).getByRole('status')).toHaveTextContent('not started')
    },
  )
  it('renders clock-based markers without hovering and leaves ongoing zero intervals empty', () => {
    render(
      <AnalyticsChart
        id="intervals"
        title="Items"
        metric="units"
        axis={Array.from({ length: 9 }, (_, i) => `${i}`)}
        series={[
          {
            label: 'Today',
            points: Array.from({ length: 9 }, (_, i) => ({
              label: `${i}`,
              value: i === 6 ? 2 : 0,
              state: (i < 6 ? 'completed' : i === 6 ? 'ongoing' : 'future') as
                'completed' | 'ongoing' | 'future',
            })),
          },
        ]}
      />,
    )
    const plot = screen.getByTestId('intervals')
    const dots = within(plot).getAllByTestId('chart-point')
    expect(dots).toHaveLength(7)
    expect(dots[0]).toHaveAttribute('r', '3.5')
    expect(dots[0]).toHaveAttribute('fill', 'var(--primary)')
    expect(dots[6]).toHaveAttribute('r', '3')
    expect(dots[6]).toHaveAttribute('fill', 'var(--surface)')
    expect(dots[6]).toHaveAttribute('stroke-width', '1')
    expect(within(plot).queryByRole('status')).toBeNull()
    fireEvent.keyDown(within(plot).getByRole('group'), { key: 'End' })
    expect(within(plot).getAllByTestId('chart-point')).toHaveLength(7)
    expect(dots[6]).toHaveAttribute('r', '3')
    expect(within(plot).getByRole('status')).toHaveTextContent('not started')
  })
  it('leaves today zero open in a daily range but still plots completed and comparison zeros', () => {
    inRouter(
      <SalesPanel
        data={{
          days: [
            { date: '2026-10-07', revenue: 10000, orders: 1, units: 1, discounts: 0 },
            { date: '2026-10-08', revenue: 0, orders: 0, units: 0, discounts: 0 },
            { date: '2026-10-09', revenue: 20000, orders: 2, units: 2, discounts: 0 },
            { date: '2026-10-10', revenue: 0, orders: 0, units: 0, discounts: 0 },
          ],
          items: [],
          categories: [],
          delivery: [],
          hours: [],
        }}
        from="2026-10-09"
        to="2026-10-10"
        clock={{ now: Date.parse('2026-10-10T15:30:00+05:30'), cutover: '04:00:00' }}
        grain="day"
        metric="revenue"
        periods={2}
      />,
    )
    const plot = screen.getByTestId('sales-trend')
    const groups = plot.querySelectorAll('[data-testid="chart-series"]')
    expect(groups[0]!.querySelectorAll('circle')).toHaveLength(1)
    expect(groups[0]!.querySelectorAll('line')).toHaveLength(0)
    expect(groups[1]!.querySelectorAll('circle')).toHaveLength(2)
    expect(groups[1]!.querySelectorAll('line')).toHaveLength(1)
    fireEvent.keyDown(within(plot).getByRole('group'), { key: 'End' })
    expect(within(plot).getByRole('status')).toHaveTextContent('10 Oct₹0 · so far')
  })
  it('leaves only unfinished zero hours empty while retaining completed zeros and exact values', () => {
    inRouter(
      <SalesPanel
        data={{
          days: [{ date: '2026-10-10', revenue: 30000, orders: 3, units: 3, discounts: 0 }],
          items: [],
          categories: [],
          delivery: [],
          hours: [
            { period: 0, hour: 12, revenue: 10000, orders: 1 },
            { period: 0, hour: 14, revenue: 20000, orders: 2 },
            { period: 1, hour: 16, revenue: 50000, orders: 5 },
          ],
        }}
        from="2026-10-10"
        to="2026-10-10"
        clock={{ now: Date.parse('2026-10-10T15:30:00+05:30'), cutover: '04:00:00' }}
        grain="hour"
        metric="revenue"
        periods={2}
      />,
    )
    const plot = screen.getByTestId('sales-trend')
    const groups = plot.querySelectorAll('[data-testid="chart-series"]')
    // 11h through next-calendar 03h remain; completed current points stop at 14h.
    expect(groups[0]!.querySelectorAll('circle')).toHaveLength(4)
    expect(groups[0]!.querySelectorAll('line')).toHaveLength(3)
    expect(groups[1]!.querySelectorAll('circle')).toHaveLength(17)
    const dots = groups[0]!.querySelectorAll('circle')
    expect(dots[2]!.querySelector('title')).toHaveTextContent('13:00, ₹0')
    expect(dots[3]!.getAttribute('fill')).toBe('var(--primary)')
    fireEvent.keyDown(within(plot).getByRole('group'), { key: 'End' })
    expect(within(plot).getByRole('status')).toHaveTextContent('03:00₹0 · not started')
    expect(screen.getByTestId('sales-trend-value')).toHaveTextContent('₹300')
    fireEvent.click(screen.getByRole('button', { name: /^Table$/ }))
    expect(screen.getByRole('row', { name: /15:00/ })).toHaveTextContent('₹0 · so far')
    expect(screen.getByRole('row', { name: /03:00/ })).toHaveTextContent('₹0 · not started')
  })
  it('a single-day trend has one date tick and remains inspectable', () => {
    render(
      <AnalyticsChart
        id="one-day"
        title="Revenue"
        metric="revenue"
        axis={['8 Oct']}
        series={[{ label: '8 Oct', points: [{ label: '8 Oct', value: 12345 }] }]}
      />,
    )
    const plot = screen.getByTestId('one-day')
    const ticks = [...plot.querySelectorAll('svg text')].filter(
      (tick) => tick.textContent === '8 Oct',
    )
    expect(ticks).toHaveLength(1)
    expect(ticks[0]).toHaveAttribute('x', '195')
    expect(ticks[0]).toHaveAttribute('text-anchor', 'middle')
    fireEvent.keyDown(within(plot).getByRole('group'), { key: 'Home' })
    expect(within(plot).getByRole('status')).toHaveTextContent('8 Oct₹123')
  })
  it('keyboard inspection identifies actual dates and missing AOV for every period', () => {
    render(
      <AnalyticsChart
        id="chart"
        title="AOV"
        metric="aov"
        axis={['1 Oct', '2 Oct']}
        series={[
          {
            label: '1–2 Oct',
            points: [
              { label: '1 Oct', value: 10050 },
              { label: '2 Oct', value: null },
            ],
          },
          {
            label: '29–30 Sept',
            points: [
              { label: '29 Sept', value: 23400 },
              { label: '30 Sept', value: 12300 },
            ],
          },
        ]}
      />,
    )
    const chart = screen.getByRole('group', { name: /AOV chart/ })
    fireEvent.keyDown(chart, { key: 'Home' })
    let detail = screen.getByRole('status')
    expect(within(detail).getByText('1 Oct')).toBeVisible()
    expect(within(detail).getByText('₹101')).toBeVisible()
    expect(within(detail).getByText('29 Sept')).toBeVisible()
    expect(within(detail).getByText('₹234')).toBeVisible()
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    detail = screen.getByRole('status')
    expect(within(detail).getByText('2 Oct')).toBeVisible()
    expect(within(detail).getByText('—')).toBeVisible()
    expect(within(detail).getByText('₹123')).toBeVisible()
    expect(metricText(0, 'orders')).toBe('0')
    // Whole rupees from ₹100, two paise digits below it, exact in the table.
    expect(metricText(3_011_089, 'revenue')).toBe('₹30,111')
    expect(metricText(1_050, 'aov')).toBe('₹10.50')
    expect(metricText(700, 'revenue')).toBe('₹7')
    expect(metricText(3_011_089, 'revenue', false, true)).toBe('₹30,110.89')
    expect(rangeLabel('2026-12-30', '2027-01-02')).toBe("30 Dec '26–2 Jan '27")
  })
  it('page-wide AOV remains weighted and counter-only in trend and hour charts', () => {
    const data: AnalyticsSnapshot = {
      items: [],
      categories: [],
      days: [
        { date: '2026-10-01', revenue: 1000, orders: 1, units: 1, discounts: 0 },
        { date: '2026-10-02', revenue: 9500, orders: 9, units: 9, discounts: 0 },
      ],
      delivery: [{ date: '2026-10-01', channel: 'swiggy', revenue: 990000, provisional: false }],
      hours: [{ period: 0, hour: 12, revenue: 10500, orders: 10 }],
    }
    inRouter(
      <SalesPanel
        data={data}
        from="2026-10-01"
        to="2026-10-02"
        grain="week"
        metric="aov"
        periods={1}
      />,
    )
    expect(screen.getByTestId('sales-trend-value')).toHaveTextContent('₹10.50')
    const trend = within(screen.getByTestId('sales-trend'))
    fireEvent.keyDown(trend.getByRole('group'), { key: 'Home' })
    expect(trend.getByRole('status')).toHaveTextContent('1–2 Oct₹10.5')
    const hours = within(screen.getByTestId('sales-hours'))
    fireEvent.keyDown(hours.getByRole('group'), { key: 'Home' })
    fireEvent.keyDown(hours.getByRole('group'), { key: 'ArrowRight' })
    expect(hours.getByRole('status')).toHaveTextContent('12:00₹10.5')
    expect(screen.queryByText('Counter + delivery')).toBeNull()
  })
  it('hour grouping reconciles counter totals while keeping delivery in the revenue headline', () => {
    inRouter(
      <SalesPanel
        from="2026-10-01"
        to="2026-10-02"
        grain="hour"
        metric="revenue"
        periods={2}
        data={{
          items: [],
          categories: [],
          days: [{ date: '2026-10-01', revenue: 10500, orders: 10, units: 10, discounts: 0 }],
          delivery: [
            { date: '2026-10-01', channel: 'swiggy', revenue: 990000, provisional: false },
          ],
          hours: [
            { period: 0, hour: 12, revenue: 10500, orders: 10 },
            { period: 1, hour: 12, revenue: 7777, orders: 2 },
          ],
        }}
      />,
    )
    expect(screen.getByTestId('sales-trend-value')).toHaveTextContent('₹10,005')
    expect(
      screen.getByText('Counter bills by Kolkata clock hour, totals across the range'),
    ).toBeVisible()
    for (const id of ['sales-trend', 'sales-hours']) {
      const chart = within(screen.getByTestId(id))
      fireEvent.keyDown(chart.getByRole('group'), { key: 'Home' })
      // Both hour charts start an hour before the first sale: 11:00, then 12:00.
      fireEvent.keyDown(chart.getByRole('group'), { key: 'ArrowRight' })
      expect(chart.getByRole('status')).toHaveTextContent(
        `1–2 Oct · 12:00${id === 'sales-trend' ? '₹105' : '₹52.5'}`,
      )
      expect(chart.getByRole('status')).toHaveTextContent(
        `29–30 Sept · 12:00${id === 'sales-trend' ? '₹77.77' : '₹38.89'}`,
      )
    }
    const hours = screen.getByTestId('sales-hours')
    expect(within(hours).getAllByTestId('chart-column')).toHaveLength(3)
    expect(hours.querySelectorAll('[data-testid="chart-series"] line')).toHaveLength(0)
    // The same card as a table: every hour, every period, exact paise, the change.
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('sales-trend')).toBeNull()
    const row = screen.getByRole('row', { name: /^12:00 ₹105 ₹77\.77 \+35%/ })
    expect(row).toBeVisible()
    // Only the trading hours, 11:00 to 13:00, under the header: the rest are
    // zero in every period, so nothing is lost.
    expect(within(screen.getByTestId('sales-trend-table')).getAllByRole('row')).toHaveLength(4)
  })
  it.each([
    ['revenue', 'Hourly average revenue', '₹7'],
    ['orders', 'Hourly average orders', '0.7'],
    ['aov', 'Average bill by hour', '₹10.50'],
  ] as const)(
    '%s hourly pattern includes zero-sale dates and preserves weighted AOV',
    (metric, hourlyTitle, hourlyValue) => {
      const days = Array.from({ length: 15 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        revenue: index === 0 ? 1000 : index === 7 ? 9500 : 0,
        orders: index === 0 ? 1 : index === 7 ? 9 : 0,
        units: 0,
        discounts: 0,
      }))
      inRouter(
        <SalesPanel
          data={{
            days,
            items: [],
            categories: [],
            delivery: [],
            hours: [{ period: 0, hour: 12, revenue: 10500, orders: 10 }],
          }}
          from="2026-10-01"
          to="2026-10-15"
          grain="day"
          metric={metric}
          periods={1}
        />,
      )
      expect(screen.getByRole('heading', { name: hourlyTitle })).toBeVisible()
      // The weekday card is gone: on a week it only re-ordered the daily chart.
      expect(screen.queryByTestId('sales-weekdays')).toBeNull()
      const hours = within(screen.getByTestId('sales-hours'))
      fireEvent.keyDown(hours.getByRole('group'), { key: 'Home' })
      fireEvent.keyDown(hours.getByRole('group'), { key: 'ArrowRight' })
      expect(hours.getByRole('status')).toHaveTextContent(`12:00${hourlyValue}`)
    },
  )
  it('four periods read as a direction and against the usual, not against the last one', () => {
    const days = [100_000, 110_000, 120_000, 130_000].map((revenue, index) => ({
      date: `2026-10-0${index + 1}`,
      revenue,
      orders: 1,
      units: 1,
      discounts: 0,
    }))
    inRouter(
      <SalesPanel
        data={{ days, items: [], categories: [], delivery: [], hours: [] }}
        from="2026-10-04"
        to="2026-10-04"
        grain="day"
        metric="revenue"
        periods={4}
      />,
    )
    const card = within(screen.getByTestId('sales-trend-card'))
    // A steady climb of ₹100 a day on an average of ₹1,150 is about 9% a day.
    expect(card.getByText('9%').closest('span')).toHaveTextContent('9%/ day')
    expect(card.getByText('▲ usual')).toBeVisible()
    expect(screen.getByTestId('sales-trend-usual')).toHaveTextContent('Usually ₹1K–₹1.2K a day')
    expect(card.queryByText('+8%')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('columnheader', { name: 'vs usual' })).toBeVisible()
    // ₹1,300 against an earlier average of ₹1,100.
    expect(screen.getByRole('row', { name: /^4 Oct .*▲ 18%$/ })).toBeVisible()
  })
  it('a day with no sales keeps every hour', () => {
    inRouter(
      <SalesPanel
        data={{ days: [], items: [], categories: [], delivery: [], hours: [] }}
        from="2026-10-08"
        to="2026-10-08"
        grain="hour"
        metric="revenue"
        periods={1}
      />,
    )
    expect(within(screen.getByTestId('sales-trend')).getAllByTestId('chart-point')).toHaveLength(24)
  })
  it('solid four-period columns include earlier trading hours and preserve zero-sale gaps', () => {
    inRouter(
      <SalesPanel
        data={{
          items: [],
          categories: [],
          days: [{ date: '2026-10-08', revenue: 70000, orders: 7, units: 7, discounts: 0 }],
          delivery: [],
          hours: [
            { period: 0, hour: 12, revenue: 70000, orders: 7 },
            { period: 3, hour: 22, revenue: 140000, orders: 14 },
          ],
        }}
        from="2026-10-02"
        to="2026-10-08"
        grain="hour"
        metric="revenue"
        periods={4}
      />,
    )
    const plot = screen.getByTestId('sales-hours')
    const chart = within(plot).getByRole('group')
    expect(within(plot).getAllByTestId('chart-column')).toHaveLength(13)
    expect(plot.querySelectorAll('pattern')).toHaveLength(0)
    const series = [...plot.querySelectorAll('[data-testid="chart-series"]')]
    const colors = series.map((group) => group.querySelector('rect')!.getAttribute('fill'))
    expect(new Set(colors).size).toBe(4)
    expect(colors.every((color) => color && !color.startsWith('url('))).toBe(true)
    expect(
      series.every((group) => Number(group.querySelector('rect')!.getAttribute('rx')) > 0),
    ).toBe(true)
    fireEvent.keyDown(chart, { key: 'Home' })
    expect(within(plot).getByRole('status')).toHaveTextContent('11:00')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(within(plot).getByRole('status')).toHaveTextContent('12:00₹100')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(within(plot).getByRole('status')).toHaveTextContent('13:00₹0')
    fireEvent.keyDown(chart, { key: 'End' })
    expect(within(plot).getByRole('status')).toHaveTextContent('23:00')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(within(plot).getByRole('status')).toHaveTextContent('11–17 Sept · 22:00₹200')
    expect(within(plot).getByLabelText('4: 11–17 Sept')).toBeVisible()
    // The trend's hours are trimmed the same way: 11:00 to 23:00.
    expect(within(screen.getByTestId('sales-trend')).getAllByTestId('chart-point')).toHaveLength(13)
  })
  it('comparison has its own compact trigger and names the chosen ranges', () => {
    const changes: Record<string, string>[] = []
    render(
      <AnalyticsControls
        from="2026-10-02"
        to="2026-10-08"
        grain="day"
        grains={SALES_GRAINS}
        metric="revenue"
        metrics={SALES_METRICS}
        periods={2}
        onChange={(value) => changes.push(value)}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Compare periods: 2 periods' })
    expect(trigger).toHaveTextContent('Compare2')
    fireEvent.click(trigger)
    const picker = within(screen.getByRole('dialog', { name: 'Compare periods' }))
    expect(picker.getByRole('button', { name: '2 periods' })).toHaveTextContent(
      '2–8 Oct · 25 Sept–1 Oct',
    )
    fireEvent.click(picker.getByRole('button', { name: '4 periods' }))
    expect(changes).toEqual([{ periods: '4' }])
    fireEvent.click(screen.getByRole('button', { name: 'Group by: Day' }))
    const grouping = within(screen.getByRole('dialog', { name: 'Group by' }))
    expect(grouping.queryByRole('button', { name: 'Month' })).toBeNull()
    expect(grouping.getByRole('button', { name: 'Hour' })).toBeVisible()
  })
})
