import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ItemsPanel } from './items-panel'
import type { AnalyticsSnapshot } from '@/data-access/analytics'
import { download } from './analytics-utils'

const { series } = vi.hoisted(() => ({
  series: vi.fn(async () => ({
    from: '2026-10-09',
    units: [20, 40],
    revenue: [8000, 10000],
    hourUnits: [] as number[],
    hourRevenue: [] as number[],
  })),
}))
vi.mock('@/data-access', () => ({ useAdapters: () => ({ analytics: { series } }) }))
vi.mock('./analytics-utils', async (original) => ({
  ...(await original<typeof import('./analytics-utils')>()),
  download: vi.fn(),
}))

const data: AnalyticsSnapshot = {
  days: [{ date: '2026-10-10', revenue: 12000, orders: 2, units: 40, discounts: 0 }],
  delivery: [{ date: '2026-10-10', channel: 'swiggy', revenue: 99000, provisional: false }],
  hours: [],
  items: [
    {
      key: 'a',
      name: 'Chicken wrap',
      category: 'Wraps',
      units: 10,
      revenue: 9000,
      orders: 1,
      discounts: 0,
      previousUnits: 5,
      previousRevenue: 8000,
      periodUnits: [10, 5],
      periodRevenue: [9000, 8000],
      active: true,
      available: true,
      highlighted: false,
    },
    {
      key: 'b',
      name: 'Old drink',
      category: 'Drinks',
      units: 30,
      revenue: 1000,
      orders: 1,
      discounts: 0,
      previousUnits: 40,
      previousRevenue: 2000,
      periodUnits: [30, 40],
      periodRevenue: [1000, 2000],
      active: false,
      available: false,
      highlighted: false,
    },
  ],
  categories: [
    {
      name: 'Wraps',
      units: 10,
      revenue: 9000,
      previousUnits: 5,
      previousRevenue: 8000,
      periodUnits: [10, 5],
      periodRevenue: [9000, 8000],
    },
    {
      name: 'Drinks',
      units: 30,
      revenue: 1000,
      previousUnits: 40,
      previousRevenue: 2000,
      periodUnits: [30, 40],
      periodRevenue: [1000, 2000],
    },
  ],
}

async function setup(metric: 'units' | 'revenue', snapshot = data) {
  const onSubject = vi.fn()
  const props = {
    data: snapshot,
    outletId: 'outlet',
    from: '2026-10-10',
    to: '2026-10-10',
    grain: 'day' as const,
    metric,
    periods: 2,
    subject: { kind: 'all' as const },
    onSubject,
  }
  const result = render(
    <MemoryRouter>
      <ItemsPanel {...props} />
    </MemoryRouter>,
  )
  await act(async () => {})
  return { ...result, props, onSubject }
}

describe('Items quantities and shares', () => {
  it("hangs today's hourly item line without changing totals or export numbers", async () => {
    const hourUnits = Array<number>(48).fill(0)
    const hourRevenue = Array<number>(48).fill(0)
    hourUnits[12] = 10
    hourUnits[14] = 30
    hourUnits[40] = 20
    hourRevenue[12] = 2500
    hourRevenue[14] = 7500
    hourRevenue[40] = 8000
    series.mockResolvedValueOnce({
      from: '2026-10-09',
      units: [20, 40],
      revenue: [8000, 10000],
      hourUnits,
      hourRevenue,
    })
    const { rerender, props } = await setup('units')
    rerender(
      <MemoryRouter>
        <ItemsPanel
          {...props}
          grain="hour"
          clock={{ now: Date.parse('2026-10-10T15:30:00+05:30'), cutover: '04:00:00' }}
        />
      </MemoryRouter>,
    )
    await act(async () => {})
    const plot = screen.getByTestId('items-trend')
    const groups = plot.querySelectorAll('[data-testid="chart-series"]')
    expect(groups[0]!.querySelectorAll('circle')).toHaveLength(4)
    expect(groups[1]!.querySelectorAll('circle')).toHaveLength(17)
    expect(screen.getByTestId('items-trend-value')).toHaveTextContent('40')
    fireEvent.keyDown(within(plot).getByRole('group'), { key: 'End' })
    expect(within(plot).getByRole('status')).toHaveTextContent('03:000 · not started')
    fireEvent.click(screen.getByRole('button', { name: /^Table$/ }))
    expect(screen.getByRole('row', { name: /15:00/ })).toHaveTextContent('0 · so far')
    fireEvent.click(
      within(screen.getByTestId('items-trend-card')).getByRole('button', {
        name: /^Export CSV$/,
      }),
    )
    const rows = vi.mocked(download).mock.calls.at(-1)![1]
    expect(rows.at(-1)).toEqual(['03:00', 0, 0])
    expect(series).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['units', '25% of items', '40 items sold'],
    ['revenue', '90% of revenue', '₹100 dish revenue'],
  ] as const)(
    '%s shares use the full captured metric rather than order counts or bill revenue',
    async (metric, share, total) => {
      const { rerender, props } = await setup(metric)
      const dish = screen.getByRole('button', { name: 'Chart Chicken wrap' })
      expect(within(dish).getByTestId('dish-share')).toHaveTextContent(share)
      expect(
        within(screen.getByRole('button', { name: 'Chart Wraps' })).getByTestId('category-share'),
      ).toHaveTextContent(share)
      expect(screen.getByText(total)).toBeVisible()
      expect(screen.queryByText(/% of orders|counter orders|Units/)).toBeNull()
      fireEvent.change(screen.getByRole('textbox', { name: 'Search dishes' }), {
        target: { value: 'Chicken' },
      })
      expect(screen.getAllByTestId('dish-row')).toHaveLength(1)
      expect(within(dish).getByTestId('dish-share')).toHaveTextContent(share)
      fireEvent.click(screen.getByRole('button', { name: 'Rising' }))
      expect(
        within(screen.getByRole('button', { name: 'Chart Chicken wrap' })).getByTestId(
          'dish-share',
        ),
      ).toHaveTextContent(share)
      rerender(
        <MemoryRouter>
          <ItemsPanel {...props} subject={{ kind: 'item', key: 'a' }} />
        </MemoryRouter>,
      )
      await act(async () => {})
      expect(
        within(screen.getByRole('button', { name: 'Chart Chicken wrap' })).getByTestId(
          'dish-share',
        ),
      ).toHaveTextContent(share)
      fireEvent.click(screen.getByText('Detailed figures & export'))
      expect(screen.getByRole('columnheader', { name: 'Items' })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      const rows = vi.mocked(download).mock.calls.at(-1)![1]
      expect(rows[0]).not.toContain('Orders')
      expect(rows[0]).toContain('Items')
      expect(rows[1]).toContain(share)
    },
  )
  it.each(['units', 'revenue'] as const)(
    'zero %s totals show dashes; zero sellers against positive totals show 0%',
    async (metric) => {
      const zero = {
        ...data,
        items: data.items.map((i) => ({ ...i, units: 0, revenue: 0 })),
        categories: data.categories.map((c) => ({ ...c, units: 0, revenue: 0 })),
      }
      const { rerender, props } = await setup(metric, zero)
      expect(screen.getAllByTestId('dish-share').every((el) => el.textContent === '—')).toBe(true)
      expect(screen.getAllByTestId('category-share').every((el) => el.textContent === '—')).toBe(
        true,
      )
      rerender(
        <MemoryRouter>
          <ItemsPanel
            {...props}
            data={{
              ...data,
              items: [zero.items[0]!, data.items[1]!],
              categories: [zero.categories[0]!, data.categories[1]!],
            }}
          />
        </MemoryRouter>,
      )
      expect(
        within(screen.getByRole('button', { name: 'Chart Chicken wrap' })).getByTestId(
          'dish-share',
        ),
      ).toHaveTextContent(`0% of ${metric === 'units' ? 'items' : 'revenue'}`)
      expect(
        within(screen.getByRole('button', { name: 'Chart Wraps' })).getByTestId('category-share'),
      ).toHaveTextContent('0%')
    },
  )
})
