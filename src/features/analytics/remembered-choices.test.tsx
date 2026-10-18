import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeGatesForTest } from '@/test/change-gates'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { AnalyticsSurface } from './analytics-surface'
import { TrendCard } from './analytics-trend-card'
import {
  readRememberedRange,
  readRememberedView,
  rememberRange,
  shortcutOf,
  shortcutRange,
} from './remembered-choices'

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
vi.mock('./items-panel', () => ({
  ItemsPanel: ({ grain }: { grain: string }) => <div>Items by {grain}</div>,
}))
vi.mock('./sales-panel', () => ({
  SalesPanel: ({ grain }: { grain: string }) => <div>Sales by {grain}</div>,
}))

const owner = { mode: 'real', userId: 'owner' } as Session
const manager = { mode: 'real', userId: 'manager' } as Session
const demoOwner = { mode: 'demo', userId: 'owner' } as Session

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('a remembered date shortcut', () => {
  it('is kept per person, per mode and per page', () => {
    rememberRange(owner, 'items', '1d')
    rememberRange(owner, 'sales', '30d')
    expect(readRememberedRange(owner, 'items')).toBe('1d')
    expect(readRememberedRange(owner, 'sales')).toBe('30d')
    expect(readRememberedRange(manager, 'items')).toBeNull()
    expect(readRememberedRange(demoOwner, 'items')).toBeNull()
    expect(readRememberedRange(undefined, 'items')).toBeNull()
    localStorage.setItem('shawarmania.analytics-range.real.owner.items', 'fortnight')
    expect(readRememberedRange(owner, 'items')).toBeNull()
  })

  it('degrades to nothing remembered when storage refuses', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(() => rememberRange(owner, 'items', '1d')).not.toThrow()
    expect(readRememberedRange(owner, 'items')).toBeNull()
    get.mockRestore()
    set.mockRestore()
  })

  it('names only ranges a shortcut produces', () => {
    expect(shortcutOf('2026-10-10', '2026-10-10', '2026-10-10', false)).toBe('1d')
    expect(shortcutOf('2026-10-04', '2026-10-10', '2026-10-10', false)).toBe('7d')
    expect(shortcutOf('2026-09-11', '2026-10-10', '2026-10-10', false)).toBe('30d')
    expect(shortcutOf('2026-10-01', '2026-10-10', '2026-10-10', true)).toBe('month')
    // A stepped-back week, a hand-picked span and a stepped-back month are one-offs.
    expect(shortcutOf('2026-09-27', '2026-10-03', '2026-10-10', false)).toBeNull()
    expect(shortcutOf('2026-10-06', '2026-10-10', '2026-10-10', false)).toBeNull()
    expect(shortcutOf('2026-09-01', '2026-09-30', '2026-10-10', true)).toBeNull()
  })

  it('opens Month and 30d as each other where only the other is offered', () => {
    expect(shortcutRange('1d', '2026-10-10', false)).toEqual({
      from: '2026-10-10',
      to: '2026-10-10',
      grain: 'hour',
      month: false,
    })
    expect(shortcutRange('month', '2026-10-10', false)).toEqual({
      from: '2026-09-11',
      to: '2026-10-10',
      grain: 'day',
      month: false,
    })
    expect(shortcutRange('30d', '2026-10-10', true)).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
      grain: 'day',
      month: true,
    })
  })
})

describe('each Analytics page', () => {
  function open(kind: 'items' | 'trends', entry = '/', oneRevenue = false, session = owner) {
    return render(
      <SessionContext.Provider value={session}>
        <ChangeGatesForTest on={{ 'one-revenue': oneRevenue }}>
          <MemoryRouter initialEntries={[entry]}>
            <AnalyticsSurface kind={kind} />
          </MemoryRouter>
        </ChangeGatesForTest>
      </SessionContext.Provider>,
    )
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T12:00:00+05:30'))
  })

  it('opens on its own last shortcut, with that shortcut grouping', async () => {
    rememberRange(owner, 'items', '1d')
    rememberRange(owner, 'sales', '30d')
    const items = open('items')
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-10', '2026-10-10', expect.any(Object))
    expect(screen.getByText('Items by hour')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Last 1 day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    items.unmount()
    open('trends')
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-09-11', '2026-10-10', expect.any(Object))
    expect(screen.getByText('Sales by day')).toBeVisible()
  })

  it('opens on 7d for another person, and on the dates an address names', async () => {
    rememberRange(owner, 'items', '1d')
    const other = open('items', '/', false, manager)
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-04', '2026-10-10', expect.any(Object))
    other.unmount()
    open('items', '/?from=2026-10-01&to=2026-10-03')
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-01', '2026-10-03', expect.any(Object))
    expect(screen.getByText('Items by day')).toBeVisible()
  })

  it('remembers a tapped shortcut, and not a stepped-back period', async () => {
    open('trends')
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Last 1 day' }))
    await act(async () => {})
    expect(readRememberedRange(owner, 'sales')).toBe('1d')
    expect(readRememberedRange(owner, 'items')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-08-12', '2026-09-10', expect.any(Object))
    expect(readRememberedRange(owner, 'sales')).toBe('30d')
  })

  it('opens Sales on Month with One revenue on, from a remembered Month or 30d', async () => {
    rememberRange(owner, 'sales', '30d')
    open('trends', '/', true)
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith(
      'outlet',
      '2026-10-01',
      '2026-10-10',
      expect.objectContaining({ align: 'month' }),
    )
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await act(async () => {})
    expect(readRememberedRange(owner, 'sales')).toBe('7d')
    fireEvent.click(screen.getByRole('button', { name: 'This month' }))
    await act(async () => {})
    expect(readRememberedRange(owner, 'sales')).toBe('month')
  })
})

describe('the trend view', () => {
  function card(page: 'items' | 'sales', entry = '/', session: Session = owner) {
    return render(
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={[entry]}>
          <TrendCard
            id={`${page}-trend`}
            page={page}
            title="Revenue"
            metric="revenue"
            totals={[300]}
            days={2}
            caption="Counter + delivery"
            series={[
              {
                label: '9–10 Oct',
                points: [
                  { label: '9 Oct', value: 100 },
                  { label: '10 Oct', value: 200 },
                ],
              },
            ]}
            axis={['9 Oct', '10 Oct']}
            rowHeader="Day"
            newestFirst
            exportName="trend"
            exportUnit="paise"
          />
        </MemoryRouter>
      </SessionContext.Provider>,
    )
  }
  const pressed = (name: string) =>
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')

  it('reopens each page as it was last read, for that person only', () => {
    const sales = card('sales')
    pressed('Chart')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(readRememberedView(owner, 'sales')).toBe('table')
    sales.unmount()
    const items = card('items')
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }))
    items.unmount()
    const again = card('sales')
    pressed('Table')
    again.unmount()
    const itemsAgain = card('items')
    pressed('Cumulative')
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }))
    itemsAgain.unmount()
    const chart = card('items')
    pressed('Chart')
    chart.unmount()
    card('sales', '/', manager)
    pressed('Chart')
  })

  it('opens on the view an address names', () => {
    const view = card('sales')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    view.unmount()
    card('sales', '/?show=cumulative')
    pressed('Cumulative')
  })
})
