import type { LucideIcon } from 'lucide-react'
import { Hourglass, Store, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { LoadingList } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import type { OutletDaySummary } from '@/data-access/adapters'
import {
  describeDifference,
  formatBusinessDate,
  formatPaise,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { useSession } from '@/session/context'

/**
 * The owner console: every outlet side by side, read in ten seconds while doing
 * something else.
 *
 * **This screen never asks what mode it is in.** It lists outlets from the
 * outlets adapter — real in both modes — and asks the insights adapter for each
 * one's figures. In demo mode that adapter returns the scenario; in real mode it
 * returns `null`, because there are no real bills yet, and the card says so
 * rather than rendering a zero that would read as *you took nothing today*.
 * The seam is still exactly one adapter wide, which is what makes the screen
 * mode-blind — but no roadmap change is coming to swap it: #13 would have, and
 * was withdrawn (`openspec/todos/owner-console-was-withdrawn.md`). The absence
 * is the honest state, stated on the card, for as long as it lasts (design D3).
 */

const ALL_OUTLETS = 'all'

interface OutletFigures {
  outlet: Tables<'outlets'>
  businessDate: string
  summary: OutletDaySummary | null
  /**
   * Yesterday, for one reason: **a drawer that came up short is only known
   * about once the day is closed**, so today's figures can never carry it. An
   * owner who has to open each outlet in turn to find out whether last night
   * balanced is being made to do the console's job.
   */
  previous: OutletDaySummary | null
}

export function OwnerHome() {
  const session = useSession()
  const { outlets, insights } = useAdapters()
  const [rows, setRows] = useState<OutletFigures[]>()
  const [scope, setScope] = useState<string>(ALL_OUTLETS)

  useEffect(() => {
    let active = true

    void (async () => {
      const list = await outlets.listOutlets()
      const figures = await Promise.all(
        list.map(async (outlet) => {
          // Each outlet's own cutover decides its own today. Two outlets could
          // legitimately be on different business dates at 03:30.
          const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
          const [summary, previous] = await Promise.all([
            insights.outletDay(outlet.id, businessDate),
            insights.outletDay(outlet.id, shiftBusinessDate(businessDate, -1)),
          ])
          return { outlet, businessDate, summary, previous }
        }),
      )
      if (active) setRows(figures)
    })()

    return () => {
      active = false
    }
  }, [outlets, insights])

  const base = session.mode === 'demo' ? '/demo/owner' : '/owner'
  const shown = rows?.filter((row) => scope === ALL_OUTLETS || row.outlet.id === scope) ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="All outlets"
        subtitle={
          rows?.[0] ? `Today — ${formatBusinessDate(rows[0].businessDate)}` : 'Today at a glance'
        }
      />

      {rows && rows.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="outlet-scope" className="text-xs font-semibold text-content-muted">
            Showing
          </label>
          <Select
            id="outlet-scope"
            data-testid="outlet-scope"
            className="h-11 w-auto"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            {/* Only what the adapter returned. Nothing here can name an outlet
                the caller was not given (spec: the switcher never widens). */}
            <option value={ALL_OUTLETS}>All outlets</option>
            {rows.map((row) => (
              <option key={row.outlet.id} value={row.outlet.id}>
                {row.outlet.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {rows === undefined ? (
        // The same `space-y-3` stack the outlet cards land in, at one card's
        // height, so the figures fill the space rather than push it open.
        <LoadingList label="your outlets" rows={2} blockHeight="h-52" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No outlets yet — create the first one from Outlets. Nothing else in the app works until an outlet exists."
          action={
            <Link to={`${base}/outlets`} className={buttonVariants({ size: 'phone' })}>
              Go to Outlets
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((row) => (
            <OutletCard key={row.outlet.id} figures={row} base={base} />
          ))}
        </div>
      )}
    </div>
  )
}

function OutletCard({ figures, base }: { figures: OutletFigures; base: string }) {
  const { outlet, summary } = figures

  return (
    <Card className="space-y-3" data-testid={`outlet-card-${outlet.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-content">{outlet.name}</h2>
          <p className="truncate text-xs text-content-muted">{outlet.location_label}</p>
        </div>
        <Link
          to={`${base}/outlet/${outlet.id}`}
          className={buttonVariants({ variant: 'secondary', size: 'phone' })}
          data-testid={`open-outlet-${outlet.id}`}
        >
          Open
        </Link>
      </div>

      {summary === null ? (
        /* A real answer, not an error. See the module note. */
        <p className="text-sm text-content-muted" data-testid={`no-figures-${outlet.id}`}>
          Today’s figures are not available yet — this console is not connected to live trading
          data. The outlet is here; the numbers arrive when billing does.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <Money
                paise={summary.salesPaise}
                display
                data-testid={`sales-${outlet.id}`}
                className="text-content"
              />
              <p className="text-xs text-content-muted">
                {summary.billCount === 1 ? '1 bill today' : `${summary.billCount} bills today`}
              </p>
            </div>
            <div className="text-right">
              <Money paise={summary.expectedCashPaise} data-testid={`cash-${outlet.id}`} />
              <p className="text-xs text-content-muted">
                {summary.dayClosed ? 'counted and closed' : 'should be in the drawer'}
              </p>
            </div>
          </div>

          {summary.salesByMethod.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-content-muted">
              {summary.salesByMethod.map((total) => (
                <li key={total.method}>
                  <span className="font-semibold text-content">{total.method}</span>{' '}
                  <Money paise={total.amountPaise} />
                </li>
              ))}
            </ul>
          )}

          <AttentionRow
            summary={summary}
            previous={figures.previous}
            outletId={outlet.id}
            base={base}
          />
        </>
      )}
    </Card>
  )
}

/**
 * What needs looking at, in words. Each item is a count of rows somebody can go
 * and read — an alert about a problem that exists nowhere else in the data is a
 * sentence somebody typed.
 */
function AttentionRow({
  summary,
  previous,
  outletId,
  base,
}: {
  summary: OutletDaySummary
  previous: OutletDaySummary | null
  outletId: string
  base: string
}) {
  // Today's difference is null by construction until somebody counts the
  // drawer, so the figure worth surfacing is the last closed day's.
  const difference = previous?.dayClosed ? previous.cashDifferencePaise : null
  const items: { key: string; icon: LucideIcon; label: string; to?: string }[] = []

  if (summary.waitingApprovalCount > 0) {
    items.push({
      key: 'attendance',
      icon: Hourglass,
      // A stranded day is invisible until somebody queries their pay, which is
      // exactly the kind of thing this list exists to surface.
      label:
        summary.waitingApprovalCount === 1
          ? '1 arrival waiting for approval'
          : `${summary.waitingApprovalCount} arrivals waiting for approval`,
      to: `${base}/attendance`,
    })
  }
  if (difference !== null && difference !== 0) {
    items.push({
      key: 'cash',
      icon: TriangleAlert,
      // Direction in words as well as by sign — a minus is the first thing a
      // small screen loses, and "₹240 short" is not a sentence anyone misreads.
      label: `Drawer ${formatPaise(Math.abs(difference))} ${describeDifference(difference)} on ${formatBusinessDate(previous?.businessDate ?? '')}`,
      to: `${base}/outlet/${outletId}`,
    })
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-content-muted" data-testid={`attention-${outletId}`}>
        {summary.checkedInCount === 1 ? '1 arrival' : `${summary.checkedInCount} arrivals`} recorded
        and approved · nothing needs attention
      </p>
    )
  }

  return (
    <ul
      className="flex flex-wrap gap-2 text-xs font-semibold"
      data-testid={`attention-${outletId}`}
    >
      {items.map((item) => {
        const Icon = item.icon
        const content = (
          <>
            <Icon aria-hidden size={14} />
            {item.label}
          </>
        )
        return (
          <li key={item.key}>
            {item.to ? (
              <Link
                to={item.to}
                className="flex items-center gap-1 rounded-lg border border-warning px-2 py-1 text-content hover:bg-surface-raised focus-visible:focus-ring"
              >
                {content}
              </Link>
            ) : (
              <span className="flex items-center gap-1 rounded-lg border border-warning px-2 py-1 text-content">
                {content}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
