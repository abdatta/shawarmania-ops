import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { AnalyticsSnapshot } from '@/data-access/analytics'
import { ItemsPanel } from './items-panel'
import { SalesPanel } from './sales-panel'

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

function Address() {
  return <output data-testid="address">{useLocation().search}</output>
}
const inRouter = (ui: ReactElement, entry = '/') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      {ui}
      <Address />
    </MemoryRouter>,
  )
const day = (date: string, revenue: number, orders: number) => ({
  date,
  revenue,
  orders,
  units: orders,
  discounts: 0,
})
const snapshot = (days: AnalyticsSnapshot['days']): AnalyticsSnapshot => ({
  days,
  items: [],
  categories: [],
  delivery: [],
  hours: [],
})
const inspect = (id: string, key: string) => {
  const plot = within(screen.getByTestId(id))
  fireEvent.keyDown(plot.getByRole('group'), { key })
  return plot.getByRole('status')
}

describe('a trend read as a running total', () => {
  // 8–10 Oct against 5–7 Oct.
  const twoWeeks = snapshot([
    day('2026-10-05', 5000, 1),
    day('2026-10-06', 5000, 1),
    day('2026-10-07', 5000, 1),
    day('2026-10-08', 10000, 1),
    day('2026-10-09', 0, 0),
    day('2026-10-10', 20000, 2),
  ])
  const sales = (metric: 'revenue' | 'aov', data = twoWeeks, periods = 2) => (
    <SalesPanel
      data={data}
      from="2026-10-08"
      to="2026-10-10"
      grain="day"
      metric={metric}
      periods={periods}
    />
  )

  it('draws every period as running revenue and keeps the choice in the address', () => {
    inRouter(sales('revenue'))
    const cumulative = screen.getByRole('button', { name: 'Cumulative' })
    expect(screen.getAllByRole('button', { name: /^(Chart|Cumulative|Table)$/ })).toHaveLength(3)
    fireEvent.click(cumulative)
    expect(cumulative).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('address')).toHaveTextContent('?show=cumulative')
    expect(
      within(screen.getByTestId('sales-trend')).getByRole('group', {
        name: /^Revenue, running total chart/,
      }),
    ).toBeVisible()
    expect(inspect('sales-trend', 'Home')).toHaveTextContent('8 Oct₹1005 Oct₹50')
    // Nothing on 9 Oct: the line runs flat.
    expect(inspect('sales-trend', 'ArrowRight')).toHaveTextContent('9 Oct₹1006 Oct₹100')
    expect(inspect('sales-trend', 'End')).toHaveTextContent('10 Oct₹3007 Oct₹150')
    // The headline and the table stay per period and per day.
    expect(screen.getByTestId('sales-trend-value')).toHaveTextContent('₹300')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('row', { name: /^9 Oct ₹0 ₹50/ })).toBeVisible()
    expect(screen.getByRole('row', { name: /^10 Oct ₹200 ₹50/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }))
    expect(screen.getByTestId('address')).toHaveTextContent(/^$/)
    expect(inspect('sales-trend', 'End')).toHaveTextContent('10 Oct₹2007 Oct₹50')
  })

  it('opens on Cumulative from the address', () => {
    inRouter(sales('revenue'), '/?show=cumulative')
    expect(screen.getByRole('button', { name: 'Cumulative' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(inspect('sales-trend', 'End')).toHaveTextContent('10 Oct₹300')
  })

  it('reads AOV as a running average of the bills, not a sum of averages', () => {
    inRouter(
      sales(
        'aov',
        snapshot([
          day('2026-10-08', 30000, 2),
          day('2026-10-09', 0, 0),
          day('2026-10-10', 10000, 2),
        ]),
        1,
      ),
      '/?show=cumulative',
    )
    expect(
      within(screen.getByTestId('sales-trend')).getByRole('group', {
        name: /^AOV, running average chart/,
      }),
    ).toBeVisible()
    expect(inspect('sales-trend', 'Home')).toHaveTextContent('8 Oct₹150')
    expect(inspect('sales-trend', 'ArrowRight')).toHaveTextContent('9 Oct₹150')
    expect(inspect('sales-trend', 'End')).toHaveTextContent('10 Oct₹100')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('row', { name: /^9 Oct —/ })).toBeVisible()
    expect(screen.getByRole('row', { name: /^10 Oct ₹50/ })).toBeVisible()
  })

  it('draws items sold as a running total on the Items page', async () => {
    inRouter(
      <ItemsPanel
        data={{ ...snapshot([day('2026-10-09', 8000, 2), day('2026-10-10', 10000, 2)]) }}
        outletId="outlet"
        from="2026-10-09"
        to="2026-10-10"
        grain="day"
        metric="units"
        periods={1}
        subject={{ kind: 'all' }}
        onSubject={() => {}}
      />,
      '/?show=cumulative',
    )
    await act(async () => {})
    expect(inspect('items-trend', 'Home')).toHaveTextContent('9 Oct20')
    expect(inspect('items-trend', 'End')).toHaveTextContent('10 Oct60')
    expect(screen.getByTestId('items-trend-value')).toHaveTextContent('60')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('row', { name: /^10 Oct 40/ })).toBeVisible()
  })
})
