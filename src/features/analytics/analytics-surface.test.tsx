import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalyticsSurface } from './analytics-surface'

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

it.each(['items', 'trends'] as const)(
  'defaults %s to the inclusive outlet business week either side of cutover',
  async (kind) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T22:29:00Z')) // Oct 10, 03:59 Kolkata: still Oct 9.
    const result = render(
      <MemoryRouter>
        <AnalyticsSurface kind={kind} />
      </MemoryRouter>,
    )
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-03', '2026-10-09', expect.any(Object))
    expect(screen.getByText('Incomplete period')).toBeVisible()
    result.unmount()
    vi.setSystemTime(new Date('2026-10-09T22:30:00Z'))
    render(
      <MemoryRouter>
        <AnalyticsSurface kind={kind} />
      </MemoryRouter>,
    )
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-04', '2026-10-10', expect.any(Object))
  },
)

it('preserves explicit dates in a deep link', async () => {
  render(
    <MemoryRouter initialEntries={['/?from=2024-02-28&to=2024-03-01']}>
      <AnalyticsSurface kind="items" />
    </MemoryRouter>,
  )
  await act(async () => {})
  expect(read).toHaveBeenLastCalledWith('outlet', '2024-02-28', '2024-03-01', expect.any(Object))
})

it('uses the selected outlet cutover rather than a global four-hour assumption', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T23:30:00Z')) // Oct 10, 05:00 Kolkata.
  outlets.getOutlet.mockResolvedValueOnce({ business_day_cutover: '06:00:00' })
  render(
    <MemoryRouter>
      <AnalyticsSurface kind="items" />
    </MemoryRouter>,
  )
  await act(async () => {})
  expect(read).toHaveBeenLastCalledWith('outlet', '2026-10-03', '2026-10-09', expect.any(Object))
})

it('updates the presentation clock without rereading an explicitly selected snapshot', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T18:59:30+05:30'))
  const view = render(
    <MemoryRouter initialEntries={['/?from=2026-10-10&to=2026-10-10']}>
      <AnalyticsSurface kind="items" />
    </MemoryRouter>,
  )
  await act(async () => {})
  expect(read).toHaveBeenCalledTimes(1)
  expect(outlets.getOutlet).toHaveBeenCalledTimes(1)
  await act(async () => {
    vi.advanceTimersByTime(30_000)
  })
  expect(read).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date('2026-10-11T04:00:00+05:30'))
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(screen.queryByText('Incomplete period')).toBeNull()
  expect(read).toHaveBeenCalledTimes(1)
  expect(outlets.getOutlet).toHaveBeenCalledTimes(1)
  view.unmount()
})
