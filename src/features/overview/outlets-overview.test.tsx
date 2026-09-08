import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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

describe('progressive Overview', () => {
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
