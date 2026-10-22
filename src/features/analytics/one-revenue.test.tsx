import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalyticsSurface } from './analytics-surface'
import { comparedLine } from './analytics-trend'

/**
 * One Revenue on Analytics (revenue-reads-the-same-everywhere, design D7): Month
 * in place of 30d on Sales, month-aligned windows, and comparisons cut at the
 * server's now.
 */
const { read, analytics, outlets } = vi.hoisted(() => {
  const read = vi.fn(async () => ({ days: [], items: [], categories: [], delivery: [], hours: [] }))
  return {
    read,
    analytics: { read },
    outlets: { getOutlet: vi.fn(async () => ({ business_day_cutover: '04:00:00' })) },
  }
})
vi.mock('@/data-access', () => ({ useAdapters: () => ({ analytics, outlets }) }))
vi.mock('@/features/outlet-scope', () => ({
  useOutletScope: () => ({ outletId: 'outlet', selector: null }),
}))
vi.mock('./items-panel', () => ({ ItemsPanel: () => <div>Items loaded</div> }))
vi.mock('./sales-panel', () => ({ SalesPanel: () => <div>Sales loaded</div> }))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function renderSales(kind: 'trends' | 'items' = 'trends') {
  return render(
    <MemoryRouter>
      <AnalyticsSurface kind={kind} />
    </MemoryRouter>,
  )
}

it('Sales offers Month in place of 30 days, and reads it month-aligned and cut', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:10:00Z')) // 15:40 Kolkata, 15 October.
  renderSales()
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'Last 30 days' })).toBeNull()
  // The default week ends today, so its comparison is cut.
  expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-09', '2026-10-15', {
    view: 'sales',
    periods: 2,
    align: 'equal',
    cut: true,
  })
  vi.useRealTimers()
  await userEvent.click(screen.getByRole('button', { name: 'This month' }))
  await act(async () => {})
  expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-01', '2026-10-15', {
    view: 'sales',
    periods: 2,
    align: 'month',
    cut: true,
  })
})

it('Items keeps its range and asks for its dish figures cut', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:10:00Z'))
  renderSales('items')
  await act(async () => {})
  expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument()
  expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-09', '2026-10-15', {
    view: 'items',
    periods: 2,
    align: 'equal',
    cut: true,
  })
})

it('the vs line names the earlier dates, and the time they run to', () => {
  const periods = [{ label: '9–15 Oct' }, { label: '2–8 Oct' }, { label: '25 Sept–1 Oct' }]
  expect(
    comparedLine({
      periods: periods.slice(0, 2),
      totals: [13_641_600, 14_246_900],
      metric: 'revenue',
      cut: [false, true],
      cutAt: '2026-10-08T03:28:00.000Z',
    }),
  ).toBe('vs ₹1,42,469 (2–8 Oct, until 8:58 am)')
  // Whole rupees are dropped, not rounded, as Overview drops them.
  expect(
    comparedLine({
      periods: periods.slice(0, 2),
      totals: [1, 39_810_860],
      metric: 'revenue',
      cut: [false, false],
      cutAt: null,
    }),
  ).toBe('vs ₹3,98,108 (2–8 Oct)')
  expect(
    comparedLine({
      periods,
      totals: [491, 448, 435],
      metric: 'orders',
      cut: [false, true, true],
      cutAt: '2026-10-08T03:28:00.000Z',
    }),
  ).toBe('vs 448 (2–8 Oct) · 435 (25 Sept–1 Oct), each until 8:58 am')
  expect(
    comparedLine({
      periods: periods.slice(0, 2),
      totals: [100, 90],
      metric: 'orders',
      cut: [false, false],
      cutAt: null,
    }),
  ).toBe('vs 90 (2–8 Oct)')
  expect(
    comparedLine({
      periods: periods.slice(0, 1),
      totals: [100],
      metric: 'orders',
      cut: [false],
      cutAt: null,
    }),
  ).toBe('9–15 Oct')
})
