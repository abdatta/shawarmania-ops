import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createMockAdapters,
  OUTLET_KALYANI_ID as KAL,
  OUTLET_KANCHRAPARA_ID as KPA,
  personaFixtures,
} from '@/data-access/mock'
import type { DataAdapters } from '@/data-access/adapters'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { OutletsOverview } from './outlets-overview'
import { formatPaise, resolveBusinessDate } from '@/domain'
import { overviewPeriod } from '@/domain/overview'
import { attentionChanged } from '@/features/attention/attention'
import { NavAttentionBadge } from '@/features/attention/nav-badge'

function setup(
  adapters = createMockAdapters('super_admin'),
  role: 'super_admin' | 'franchise_admin' = 'super_admin',
  mode: 'demo' | 'real' = 'demo',
) {
  const persona = personaFixtures[role]
  const session: Session = {
    mode,
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={session}>
        <AdaptersContext.Provider value={adapters}>
          <OutletsOverview />
          <NavAttentionBadge source="attendance-waiting" surface="Attendance" />
          {role === 'super_admin' && (
            <NavAttentionBadge source="delivery-needs-you" surface="Delivery" />
          )}
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('progressive Overview', () => {
  it('defaults to one outlet shimmer while the first list is pending', () => {
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      outlets: { ...base.outlets, listOutlets: () => new Promise(() => {}) },
    })
    expect(screen.getAllByTestId('overview-outlet-shimmer')).toHaveLength(1)
  })

  it('reuses and refreshes the last successful browser-wide outlet count', async () => {
    localStorage.setItem('shawarmania.overview-outlet-count', '3')
    const base = createMockAdapters('super_admin')
    const first = setup(base)
    expect(screen.getAllByTestId('overview-outlet-shimmer')).toHaveLength(3)
    await screen.findByTestId(`outlet-card-${KAL}`)
    expect(localStorage.getItem('shawarmania.overview-outlet-count')).toBe('2')

    first.unmount()
    setup({
      ...base,
      outlets: { ...base.outlets, listOutlets: () => new Promise(() => {}) },
    })
    expect(screen.getAllByTestId('overview-outlet-shimmer')).toHaveLength(2)
  })

  it('does not overwrite the remembered count when the outlet list fails', async () => {
    localStorage.setItem('shawarmania.overview-outlet-count', '3')
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      outlets: {
        ...base.outlets,
        listOutlets: async () => {
          throw new Error('network')
        },
      },
    })
    expect(screen.getAllByTestId('overview-outlet-shimmer')).toHaveLength(3)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(localStorage.getItem('shawarmania.overview-outlet-count')).toBe('3')
  })

  it('rolls an already-open page over at 4am and polls tablets once a minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T03:59:00+05:30'))
    const base = createMockAdapters('super_admin')
    const sales = vi.fn(async () => ({ cashPaise: 100, upiPaise: 0 }))
    const revenue = vi.fn(async () => ({
      revenuePaise: 100,
      hasSales: true,
      provisional: false,
      incomplete: false,
    }))
    const tablets = vi.fn(async () => [new Date(Date.now() - 1000).toISOString()])
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    setup({ ...base, overview: { ...base.overview, sales, revenue, tablets } })
    await act(async () => {})
    expect(sales).toHaveBeenCalledWith(KAL, '2026-09-30')
    expect(tablets).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(59_999))
    expect(tablets).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(tablets).toHaveBeenCalledTimes(4)
    expect(sales).toHaveBeenCalledWith(KAL, '2026-10-01')
    expect(revenue).toHaveBeenCalledWith(KAL, '2026-09-01', '2026-09-30')
    expect(
      within(screen.getByTestId(`outlet-card-${KAL}`)).getByRole('link', { name: /revenue/ }),
    ).toHaveAttribute('href', `/demo/owner/ledger?outlet=${KAL}&view=month&month=2026-09`)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(tablets).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['2026-10-01T00:00:00+05:30', '2026-09-30', '2026-09-01', '2026-09-29'],
    ['2026-10-01T03:59:59+05:30', '2026-09-30', '2026-09-01', '2026-09-29'],
    ['2026-10-01T04:00:00+05:30', '2026-10-01', '2026-09-01', '2026-09-30'],
  ])(
    'reads the business day at %s, independently of midnight',
    async (now, today, from, through) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(now))
      const base = createMockAdapters('super_admin')
      const sales = vi.fn(base.overview.sales)
      const revenue = vi.fn(base.overview.revenue)
      setup({ ...base, overview: { ...base.overview, sales, revenue } })
      await screen.findByTestId(`sales-${KAL}`)
      expect(sales).toHaveBeenCalledWith(KAL, today)
      expect(revenue).toHaveBeenCalledWith(KAL, from, through)
    },
  )

  it('uses each outlet cutover rather than hard-coding four o’clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T04:30:00+05:30'))
    const base = createMockAdapters('super_admin')
    const outlets = await base.outlets.listOutlets()
    const sales = vi.fn(base.overview.sales)
    setup({
      ...base,
      outlets: {
        ...base.outlets,
        listOutlets: async () =>
          outlets.map((o) => ({
            ...o,
            business_day_cutover: o.id === KPA ? '05:00:00' : '04:00:00',
          })),
      },
      overview: { ...base.overview, sales },
    })
    await screen.findByTestId(`sales-${KPA}`)
    expect(sales).toHaveBeenCalledWith(KAL, '2026-10-01')
    expect(sales).toHaveBeenCalledWith(KPA, '2026-09-30')
  })

  it.each([
    'zero baseline',
    'previous incomplete',
    'previous provisional',
    'current incomplete',
    'current provisional',
    'comparison failed',
  ] as const)('withholds a directional revenue claim for %s', async (scenario) => {
    const base = createMockAdapters('super_admin')
    const from = overviewPeriod(resolveBusinessDate(new Date(), '04:00')).from
    setup({
      ...base,
      overview: {
        ...base.overview,
        revenue: async (_id, start) => {
          const previous = start !== from
          if (previous && scenario === 'comparison failed')
            throw new Error('comparison unavailable')
          return {
            revenuePaise: previous && scenario === 'zero baseline' ? 0 : previous ? 10000 : 20000,
            hasSales: true,
            incomplete: scenario === (previous ? 'previous incomplete' : 'current incomplete'),
            provisional: scenario === (previous ? 'previous provisional' : 'current provisional'),
          }
        },
      },
    })
    await screen.findByTestId(`revenue-${KAL}`)
    const link = within(screen.getByTestId(`outlet-card-${KAL}`)).getByRole('link', {
      name: /revenue/,
    })
    expect(link).not.toHaveTextContent('%')
    expect(link.querySelector('.text-success, .text-danger')).toBeNull()
    expect(link).toHaveTextContent(
      scenario === 'current incomplete'
        ? 'Delivery data incomplete'
        : scenario === 'current provisional'
          ? 'Commission pending'
          : scenario === 'comparison failed'
            ? 'Comparison unavailable'
            : 'No comparable data',
    )
  })

  it('keeps zero change and break-even neutral, and names uncounted drawers', async () => {
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      overview: {
        ...base.overview,
        revenue: async () => ({
          revenuePaise: 10000,
          hasSales: true,
          provisional: false,
          incomplete: false,
        }),
        expenses: async () => 10000,
        drawer: async () => ({ expectedPaise: null, leftPaise: null, spentPaise: 0 }),
      },
    })
    expect(await screen.findByTestId(`profit-${KAL}`)).toHaveTextContent(/^₹0$/)
    const card = screen.getByTestId(`outlet-card-${KAL}`)
    for (const name of [/revenue/, /P&L/])
      expect(
        within(card).getByRole('link', { name }).querySelector('.text-accent-text .lucide-minus'),
      ).not.toBeNull()
    expect(card).toHaveTextContent('Not counted yet')
    expect(screen.queryByTestId(`cash-${KAL}`)).toBeNull()
  })

  it('withholds profit when no sales were recorded instead of inventing a trading result', async () => {
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      overview: {
        ...base.overview,
        revenue: async () => ({
          revenuePaise: 0,
          hasSales: false,
          provisional: false,
          incomplete: false,
        }),
        expenses: async () => 12300,
      },
    })
    await screen.findByTestId(`revenue-${KAL}`)
    expect(screen.getByTestId(`outlet-card-${KAL}`)).toHaveTextContent('No sales recorded')
    expect(screen.queryByTestId(`profit-${KAL}`)).toBeNull()
  })

  it.each([
    ['all', 'Open', 'bg-success'],
    ['some', 'Open', 'bg-warning'],
    ['none', 'Closed', 'bg-danger'],
  ] as const)(
    'renders %s tablets online with the matching dot and destination',
    async (kind, label, color) => {
      const base = createMockAdapters('super_admin')
      setup({
        ...base,
        overview: {
          ...base.overview,
          tablets: async () =>
            kind === 'all'
              ? [new Date(Date.now() - 1000).toISOString()]
              : kind === 'some'
                ? [new Date(Date.now() - 1000).toISOString(), null]
                : [null],
        },
      })
      const status = await screen.findByTestId(`open-outlet-${KAL}`)
      await within(screen.getByTestId(`outlet-card-${KAL}`)).findByRole('link', {
        name: kind === 'some' ? /Open, some/ : label,
      })
      expect(status).toHaveTextContent(label)
      expect(status.querySelector(`.${color}`)).not.toBeNull()
      expect(status).toHaveAttribute('href', `/demo/owner/devices/${KAL}`)
      expect(screen.queryByText(/tablet offline/i)).toBeNull()
    },
  )

  it('does not label pending or failed tablet reads Closed', async () => {
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      overview: {
        ...base.overview,
        tablets: (id) =>
          id === KAL ? new Promise(() => {}) : Promise.reject(new Error('unavailable')),
      },
    })
    await screen.findByTestId(`sales-${KAL}`)
    expect(screen.getByTestId(`open-outlet-${KAL}`)).not.toHaveTextContent('Closed')
    expect(screen.getByTestId(`open-outlet-${KPA}`)).toHaveTextContent('Status unavailable')
  })

  it.each([0, 1, 2, 3])(
    'shows %i blocked integrations as one shared page count and clears resolved work',
    async (count) => {
      const base = createMockAdapters('super_admin')
      let resolved = false
      const counts = (enabled: boolean) => async () => [
        {
          outletId: KAL,
          needing: !resolved && enabled ? 1 : 0,
          integrationIssue: !resolved && enabled,
        },
      ]
      setup({
        ...base,
        attendance: { ...base.attendance, countWaitingByOutlet: async () => [] },
        aggregatorSync: {
          ...base.aggregatorSync,
          countNeedsOwner: counts(count >= 1),
          getHyperpureHealth: async () => ({
            running: false,
            hasSession: true,
            lastOutcome: !resolved && count === 3 ? 'session_lapsed' : 'ok',
            lastRunAt: new Date().toISOString(),
            sessionExpiresAt: null,
            readsPerDay: null,
          }),
        },
        swiggySync: { ...base.swiggySync, countNeedsOwner: counts(count >= 2) },
      })
      await screen.findByTestId(`sales-${KAL}`)
      if (count) {
        expect(
          await screen.findByTestId('overview-attention-delivery-needs-you'),
        ).toHaveTextContent(`${count} delivery ${count === 1 ? 'issue' : 'issues'}`)
        expect(screen.getByTestId('nav-badge-delivery-needs-you')).toHaveTextContent(String(count))
        resolved = true
        await act(async () => attentionChanged())
      }
      expect(screen.queryByTestId('overview-attention-delivery-needs-you')).toBeNull()
      expect(screen.queryByTestId('nav-badge-delivery-needs-you')).toBeNull()
      expect(screen.queryByTestId('overview-attention-attendance-waiting')).toBeNull()
    },
  )

  it('omits paise on all headlines and keeps neutral tenders with directional financial icons', async () => {
    const base = createMockAdapters('super_admin')
    const from = overviewPeriod(resolveBusinessDate(new Date(), '04:00')).from
    setup({
      ...base,
      overview: {
        ...base.overview,
        sales: async () => ({ cashPaise: 55555555, upiPaise: 44444444 }),
        drawer: async () => ({
          expectedPaise: 99999999,
          leftPaise: 88888888,
          spentPaise: 77777777,
        }),
        revenue: async (id, start) => ({
          revenuePaise: start === from ? 99999999 : id === KAL ? 50000000 : 199999999,
          hasSales: true,
          provisional: false,
          incomplete: false,
        }),
        expenses: async (id) => (id === KAL ? 199999998 : 0),
      },
    })
    for (const id of [KAL, KPA]) {
      for (const metric of ['sales', 'cash', 'revenue']) {
        expect(await screen.findByTestId(`${metric}-${id}`)).toHaveTextContent(/^₹9,99,999$/)
        expect(screen.getByTestId(`${metric}-${id}`)).toHaveAttribute('title', '₹9,99,999.99')
      }
      const card = screen.getByTestId(`outlet-card-${id}`)
      for (const name of [/Today's counter sales/, /Drawer cash/]) {
        expect(
          within(card).getByRole('link', { name }).querySelector('.text-accent-text'),
        ).not.toBeNull()
      }
      const revenue = within(card).getByRole('link', { name: /revenue/ })
      const profit = within(card).getByRole('link', { name: /P&L/ })
      expect(
        revenue.querySelector(
          id === KAL ? '.text-success .lucide-trending-up' : '.text-danger .lucide-trending-down',
        ),
      ).not.toBeNull()
      expect(
        profit.querySelector(
          id === KAL ? '.text-danger .lucide-trending-down' : '.text-success .lucide-trending-up',
        ),
      ).not.toBeNull()
    }
    expect(screen.getByTestId(`profit-${KAL}`)).toHaveTextContent(/^-₹9,99,999$/)
    expect(screen.getByTestId(`profit-${KPA}`)).toHaveTextContent(/^₹9,99,999$/)
  })

  it('groups three blocked integrations into one Delivery row and badge', async () => {
    const base = createMockAdapters('super_admin')
    const countNeedsOwner = async () => [
      { outletId: KAL, needing: 1, integrationIssue: true },
      { outletId: KPA, needing: 1, integrationIssue: true },
    ]
    setup({
      ...base,
      aggregatorSync: {
        ...base.aggregatorSync,
        countNeedsOwner,
        getHyperpureHealth: async () => ({
          running: false,
          hasSession: false,
          lastOutcome: 'session_lapsed',
          lastRunAt: new Date().toISOString(),
          sessionExpiresAt: null,
          readsPerDay: null,
        }),
      },
      swiggySync: { ...base.swiggySync, countNeedsOwner },
    })
    expect(await screen.findByTestId('overview-attention-delivery-needs-you')).toHaveTextContent(
      '3 delivery issues',
    )
    expect(await screen.findByTestId('nav-badge-delivery-needs-you')).toHaveTextContent('3')
    expect(screen.getAllByTestId('overview-attention-delivery-needs-you')).toHaveLength(1)
  })

  it('does not invent a Delivery issue from an advisory Hyperpure expiry', async () => {
    const base = createMockAdapters('super_admin')
    setup({
      ...base,
      attendance: { ...base.attendance, countWaitingByOutlet: async () => [] },
      aggregatorSync: {
        ...base.aggregatorSync,
        countNeedsOwner: async () => [{ outletId: KAL, needing: 0 }],
        getHyperpureHealth: async () => ({
          running: false,
          hasSession: true,
          lastOutcome: 'ok',
          lastRunAt: new Date().toISOString(),
          sessionExpiresAt: new Date(Date.now() - 60_000).toISOString(),
          readsPerDay: 4,
        }),
      },
      swiggySync: {
        ...base.swiggySync,
        countNeedsOwner: async () => [{ outletId: KAL, needing: 0 }],
      },
    })

    await screen.findByTestId(`sales-${KAL}`)
    expect(screen.queryByTestId('overview-attention-delivery-needs-you')).toBeNull()
    expect(screen.queryByTestId('nav-badge-delivery-needs-you')).toBeNull()
  })

  it('shows every accessible outlet without a selector and links all metrics to their source', async () => {
    setup()
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    await screen.findByTestId(`sales-${KAL}`)
    await screen.findByTestId(`revenue-${KAL}`)
    expect(screen.getByTestId(`outlet-card-${KPA}`)).toBeInTheDocument()
    expect(screen.queryByTestId('outlet-scope')).toBeNull()
    expect(within(card).getByRole('link', { name: /Today's counter sales/ })).toHaveAttribute(
      'href',
      `/demo/owner/billing-history?outlet=${KAL}`,
    )
    expect(within(card).getByRole('link', { name: /Drawer cash/ })).toHaveAttribute(
      'href',
      `/demo/owner/drawer?outlet=${KAL}`,
    )
    expect(screen.getByTestId(`open-outlet-${KAL}`)).toHaveAttribute(
      'href',
      `/demo/owner/devices/${KAL}`,
    )
    const month = overviewPeriod(resolveBusinessDate(new Date(), '04:00')).month
    expect(within(card).getByRole('link', { name: /revenue/ })).toHaveAttribute(
      'href',
      `/demo/owner/ledger?outlet=${KAL}&view=month&month=${month}`,
    )
    expect(within(card).getByRole('link', { name: /P&L/ })).toHaveAttribute(
      'href',
      `/demo/owner/ledger?outlet=${KAL}&view=month&month=${month}`,
    )
    expect(card).toHaveTextContent('Left')
    expect(card).toHaveTextContent('Spent')
    expect(card).not.toHaveTextContent('Collected')
  })

  it('renders sales while drawer and monthly reads remain pending, then reveals revenue before comparison', async () => {
    const base = createMockAdapters('super_admin')
    let finish!: (value: Awaited<ReturnType<DataAdapters['overview']['revenue']>>) => void
    const pending = new Promise<Awaited<ReturnType<DataAdapters['overview']['revenue']>>>(
      (resolve) => {
        finish = resolve
      },
    )
    const from = overviewPeriod(resolveBusinessDate(new Date(), '04:00')).from
    setup({
      ...base,
      overview: {
        ...base.overview,
        drawer: () => new Promise(() => {}),
        expenses: () => new Promise(() => {}),
        revenue: (_id, start) => (start === from ? pending : new Promise(() => {})),
      },
    })
    expect(await screen.findByTestId(`sales-${KAL}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`cash-${KAL}`)).toBeNull()
    expect(screen.queryByTestId(`revenue-${KAL}`)).toBeNull()
    await act(async () =>
      finish({ revenuePaise: 12300, hasSales: true, incomplete: false, provisional: false }),
    )
    expect(await screen.findByTestId(`revenue-${KAL}`)).toHaveTextContent(formatPaise(12300))
    expect(screen.queryByTestId(`profit-${KAL}`)).toBeNull()
  })

  it('retries one failed metric without replacing successful values', async () => {
    const base = createMockAdapters('super_admin')
    const drawer = vi.fn(base.overview.drawer).mockRejectedValueOnce(new Error('network'))
    setup({ ...base, overview: { ...base.overview, drawer } })
    await screen.findByTestId(`sales-${KAL}`)
    const card = screen.getByTestId(`outlet-card-${KAL}`)
    await userEvent.click(await within(card).findByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId(`cash-${KAL}`)).toBeInTheDocument()
    expect(screen.getByTestId(`sales-${KAL}`)).toBeInTheDocument()
  })

  it('shows one attendance row with exactly the navigation badge count', async () => {
    setup()
    const row = await screen.findByTestId('overview-attention-attendance-waiting')
    const badge = await screen.findByTestId('nav-badge-attendance-waiting')
    const expected = Number(badge.textContent?.match(/^\d+/)?.[0])
    expect(expected).toBeGreaterThan(0)
    expect(row.textContent).toBe(`${expected} attendance approvals`)
    expect(row).toHaveAttribute('href', '/demo/owner/attendance')
    expect(screen.getAllByTestId('overview-attention-attendance-waiting')).toHaveLength(1)
  })

  it('offers assigned managers the same cards and valid source links in real mode', async () => {
    setup(createMockAdapters('franchise_admin'), 'franchise_admin', 'real')
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    await screen.findByTestId(`sales-${KAL}`)
    expect(screen.queryByTestId(`outlet-card-${KPA}`)).toBeNull()
    expect(within(card).getByRole('link', { name: /Today's counter sales/ })).toHaveAttribute(
      'href',
      `/admin/billing-history?outlet=${KAL}`,
    )
    expect(screen.getByTestId(`open-outlet-${KAL}`)).toHaveAttribute(
      'href',
      `/admin/devices/${KAL}`,
    )
    expect(screen.queryByTestId('overview-attention-delivery-needs-you')).toBeNull()
  })
})
