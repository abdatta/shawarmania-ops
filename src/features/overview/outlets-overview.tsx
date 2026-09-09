import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  ChartNoAxesCombined,
  ChartPie,
  Minus,
  Store,
  TrendingUp,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters, type Tables } from '@/data-access'
import { formatPaise, resolveBusinessDate } from '@/domain'
import { outletPresence, overviewPeriod, revenueChange } from '@/domain/overview'
import { NeedsAttention } from '@/features/attention/needs-attention'
import { useOnForeground } from '@/features/attention/attention'
import { useSession } from '@/session/context'
import { ROLE_SEGMENTS } from '@/session/session'
import { useOverviewRead } from './use-overview-read'

export function OutletsOverview() {
  const { outlets } = useAdapters()
  const read = useCallback(() => outlets.listOutlets(), [outlets])
  const rows = useOverviewRead(read)
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <PageHeader
        title="Overview"
        subtitle={`${new Intl.DateTimeFormat('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Kolkata',
        }).format(new Date())} · Month through yesterday`}
      />
      {rows.error ? (
        <ReadError retry={rows.retry} />
      ) : rows.value === undefined ? (
        <LoadingRegion label="your outlets" className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="!px-3 !py-0">
              <div className="flex h-13 items-center gap-2 border-b border-border">
                <Shimmer className="h-10 w-10 !rounded-full" />
                <Shimmer className="h-4 w-36" />
              </div>
              <div className="grid grid-cols-2 [&>*:nth-child(even)]:pl-3 [&>*:nth-child(odd)]:pr-3">
                {[0, 1, 2, 3].map((j) => (
                  <MetricShimmer key={j} />
                ))}
              </div>
            </Card>
          ))}
        </LoadingRegion>
      ) : rows.value.length === 0 ? (
        <p className="text-sm text-content-muted">No outlets are available to your account.</p>
      ) : (
        rows.value.map((outlet) => <OutletCard key={outlet.id} outlet={outlet} />)
      )}
      <NeedsAttention />
    </div>
  )
}

function OutletCard({ outlet }: { outlet: Tables<'outlets'> }) {
  const { overview } = useAdapters()
  const session = useSession()
  const base = `${session.mode === 'demo' ? '/demo' : ''}/${ROLE_SEGMENTS[session.role ?? 'franchise_admin']}`
  const [now, setNow] = useState(Date.now)
  const refreshClock = useCallback(() => setNow(Date.now()), [])
  useOnForeground(refreshClock)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const today = resolveBusinessDate(new Date(now), outlet.business_day_cutover)
  const period = overviewPeriod(today)
  const salesRead = useCallback(
    () => overview.sales(outlet.id, today),
    [overview, outlet.id, today],
  )
  const drawerRead = useCallback(() => overview.drawer(outlet.id), [overview, outlet.id])
  const revenueRead = useCallback(
    () => overview.revenue(outlet.id, period.from, period.through),
    [overview, outlet.id, period.from, period.through],
  )
  const previousRead = useCallback(
    () => overview.revenue(outlet.id, period.previousFrom, period.previousThrough),
    [overview, outlet.id, period.previousFrom, period.previousThrough],
  )
  const expensesRead = useCallback(
    () => overview.expenses(outlet.id, period.from, period.through),
    [overview, outlet.id, period.from, period.through],
  )
  const tabletsRead = useCallback(() => overview.tablets(outlet.id), [overview, outlet.id])
  const sales = useOverviewRead(salesRead)
  const drawer = useOverviewRead(drawerRead)
  const revenue = useOverviewRead(revenueRead)
  const previous = useOverviewRead(previousRead)
  const expenses = useOverviewRead(expensesRead)
  const tablets = useOverviewRead(tabletsRead)
  const rereadTablets = tablets.retry
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') rereadTablets()
    }, 60_000)
    return () => clearInterval(timer)
  }, [rereadTablets])
  const status = tablets.value === undefined ? null : outletPresence(tablets.value, now)
  const monthName = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${period.month}-01T12:00:00+05:30`))
  const source = (path: string) => `${base}/${path}?outlet=${encodeURIComponent(outlet.id)}`
  const ledger = `${source('ledger')}&view=month&month=${period.month}`
  const qualifier = revenue.value?.incomplete
    ? 'Delivery data incomplete'
    : revenue.value?.provisional
      ? 'Commission pending'
      : null
  const change =
    revenue.value &&
    previous.value &&
    !qualifier &&
    !previous.value.incomplete &&
    !previous.value.provisional &&
    previous.value.hasSales
      ? revenueChange(revenue.value.revenuePaise, previous.value.revenuePaise)
      : null
  const profit =
    revenue.value?.hasSales && expenses.value !== undefined
      ? revenue.value.revenuePaise - expenses.value
      : null
  const periodLabel = period.fullMonth ? 'Full month' : 'Through yesterday'
  return (
    <Card
      className="overflow-hidden bg-gradient-to-br from-surface-raised/30 to-surface !px-3 !py-0"
      data-testid={`outlet-card-${outlet.id}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-1 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-accent-text">
            <Store size={26} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[1.0625rem] font-bold leading-6">{outlet.name}</h2>
            <p className="truncate text-sm leading-5 text-content-muted">{outlet.location_label}</p>
          </div>
        </div>
        <Link
          to={`${base}/devices/${outlet.id}`}
          data-testid={`open-outlet-${outlet.id}`}
          className="flex min-h-12 shrink-0 items-center rounded-xl text-sm font-semibold focus-visible:focus-ring"
          aria-label={
            status === 'partial' ? 'Open, some tablets unavailable. View Tablets' : undefined
          }
        >
          {tablets.error ? (
            'Status unavailable'
          ) : status === null ? (
            <Shimmer className="h-9 w-20 !rounded-xl" />
          ) : (
            <span className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-2">
              {status === 'closed' ? 'Closed' : 'Open'}
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${status === 'closed' ? 'bg-danger' : status === 'partial' ? 'bg-warning' : 'bg-success'}`}
              />
            </span>
          )}
        </Link>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <Metric
          label="Today's counter sales"
          to={source('billing-history')}
          loading={sales.value === undefined}
          error={sales.error}
          retry={sales.retry}
        >
          {sales.value && (
            <>
              <MetricValue icon={Banknote} tone="primary">
                <OverviewMoney
                  paise={sales.value.cashPaise + sales.value.upiPaise}
                  data-testid={`sales-${outlet.id}`}
                />
              </MetricValue>
              <Subtext
                title={`Cash ${formatPaise(sales.value.cashPaise)} · UPI ${formatPaise(sales.value.upiPaise)}`}
              >
                Cash <SupportingMoney paise={sales.value.cashPaise} /> · UPI{' '}
                <SupportingMoney paise={sales.value.upiPaise} />
              </Subtext>
            </>
          )}
        </Metric>
        <Metric
          label="Drawer cash · expected"
          to={source('drawer')}
          loading={drawer.value === undefined}
          error={drawer.error}
          retry={drawer.retry}
        >
          {drawer.value && (
            <>
              <MetricValue icon={Wallet} tone="primary">
                {drawer.value.expectedPaise === null ? (
                  <p className="text-sm leading-7">Not counted yet</p>
                ) : (
                  <OverviewMoney
                    paise={drawer.value.expectedPaise}
                    data-testid={`cash-${outlet.id}`}
                  />
                )}
              </MetricValue>
              <Subtext
                title={`Last left ${drawer.value.leftPaise === null ? '—' : formatPaise(drawer.value.leftPaise)} · Cash spent since the last count ${formatPaise(drawer.value.spentPaise)}`}
              >
                Left{' '}
                {drawer.value.leftPaise === null ? (
                  '—'
                ) : (
                  <SupportingMoney paise={drawer.value.leftPaise} />
                )}{' '}
                · Spent <SupportingMoney paise={drawer.value.spentPaise} />
              </Subtext>
            </>
          )}
        </Metric>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
        <Metric
          label={`${monthName} revenue`}
          title={`${monthName} revenue · ${periodLabel}`}
          to={ledger}
          loading={revenue.value === undefined}
          error={revenue.error}
          retry={revenue.retry}
        >
          {revenue.value && (
            <>
              <MetricValue
                icon={
                  change === null
                    ? ChartNoAxesCombined
                    : change > 0
                      ? TrendingUp
                      : change < 0
                        ? TrendingDown
                        : Minus
                }
                tone={
                  change === null || change === 0 ? 'primary' : change > 0 ? 'success' : 'danger'
                }
              >
                <OverviewMoney
                  paise={revenue.value.revenuePaise}
                  data-testid={`revenue-${outlet.id}`}
                />
              </MetricValue>
              <Subtext title={periodLabel}>
                {qualifier ??
                  (previous.error ? (
                    'Comparison unavailable'
                  ) : previous.value === undefined ? (
                    <Shimmer className="mt-1 h-3 w-24" />
                  ) : change === null ? (
                    'No comparable data'
                  ) : (
                    <span className="flex items-center gap-1">
                      {change < 0 ? (
                        <ArrowDownRight size={13} aria-hidden />
                      ) : change === 0 ? (
                        <Minus size={13} aria-hidden />
                      ) : (
                        <ArrowUpRight size={13} aria-hidden />
                      )}
                      <span className="font-bold">{Math.abs(change).toFixed(1)}%</span> vs{' '}
                      {new Intl.DateTimeFormat('en-IN', {
                        month: 'short',
                        timeZone: 'Asia/Kolkata',
                      }).format(new Date(`${period.previousFrom}T12:00:00+05:30`))}
                      {period.fullMonth ? '' : ` 1–${Number(period.previousThrough.slice(8))}`}
                    </span>
                  ))}
              </Subtext>
            </>
          )}
        </Metric>
        <Metric
          label={`${monthName} P&L · est.`}
          title={`${monthName} estimated operating P&L · ${periodLabel}`}
          to={ledger}
          loading={revenue.value === undefined || expenses.value === undefined}
          error={revenue.error || expenses.error}
          retry={() => {
            revenue.retry()
            expenses.retry()
          }}
        >
          {revenue.value && expenses.value !== undefined && (
            <>
              <MetricValue
                icon={
                  profit === null
                    ? ChartPie
                    : profit > 0
                      ? TrendingUp
                      : profit < 0
                        ? TrendingDown
                        : Minus
                }
                tone={
                  profit === null || profit === 0 ? 'primary' : profit > 0 ? 'success' : 'danger'
                }
              >
                {profit === null ? (
                  <p className="text-sm leading-7">No sales recorded</p>
                ) : (
                  <OverviewMoney paise={profit} data-testid={`profit-${outlet.id}`} />
                )}
              </MetricValue>
              <Subtext
                title={`Expenses ${formatPaise(expenses.value)}${qualifier ? ` · ${qualifier}` : ' · Percentage is operating margin'}`}
              >
                Expenses <SupportingMoney paise={expenses.value} />
                {!qualifier && profit !== null && revenue.value.revenuePaise > 0 ? (
                  <>
                    <span> · </span>
                    <span className="font-bold">
                      {((profit / revenue.value.revenuePaise) * 100).toFixed(1)}%
                    </span>
                  </>
                ) : (
                  ''
                )}
              </Subtext>
            </>
          )}
        </Metric>
      </div>
    </Card>
  )
}

/** Overview alone drops paise; accounting and source pages keep the exact amount. */
function OverviewMoney({ paise, ...props }: ComponentProps<typeof Money>) {
  return (
    <Money
      {...props}
      title={formatPaise(paise)}
      paise={paise - (paise % 100)}
      className={`whitespace-nowrap leading-7 ${Math.abs(paise) >= 100_000_000 ? 'text-lg font-bold' : 'text-[1.375rem] font-extrabold'}`}
    />
  )
}

/** Short display-only values; the title and linked source retain exact paise. */
function SupportingMoney({ paise }: { paise: number }) {
  return <span className="font-bold">{compactPaise(paise)}</span>
}

function compactPaise(paise: number): string {
  const exact = formatPaise(paise)
  const absolute = Math.abs(paise)
  if (absolute < 1_000_000) return exact.replace(/\.\d{2}$/, '')
  const [unit, suffix] =
    absolute >= 1_000_000_000
      ? ([1_000_000_000, 'Cr'] as const)
      : absolute >= 10_000_000
        ? ([10_000_000, 'L'] as const)
        : ([100_000, 'k'] as const)
  return `${paise < 0 ? '-' : ''}₹${(absolute / unit).toFixed(1).replace(/\.0$/, '')}${suffix}`
}

function Subtext({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      title={title}
      data-testid="metric-subtext"
      className="mt-0.5 whitespace-nowrap text-[0.8125rem] leading-[1.125rem] text-content-muted"
    >
      {children}
    </div>
  )
}
function MetricValue({
  children,
  icon: Icon,
  tone,
}: {
  children: ReactNode
  icon: LucideIcon
  tone: 'success' | 'danger' | 'primary'
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-1">
      <div className="min-w-0">{children}</div>
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === 'success' ? 'bg-success/10 text-success' : tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-accent-text'}`}
      >
        <Icon size={22} strokeWidth={1.8} />
      </span>
    </div>
  )
}
function MetricShimmer() {
  return (
    <div className="min-w-0 py-1.5">
      <Shimmer className="mb-0.5 h-[1.125rem] w-28 max-w-full" />
      <div className="flex h-9 items-center justify-between gap-1">
        <Shimmer className="h-6 w-24 max-w-full" />
        <Shimmer className="h-9 w-9 shrink-0 !rounded-lg" />
      </div>
      <Shimmer className="mt-0.5 h-[1.125rem] w-28 max-w-full" />
    </div>
  )
}
function ReadError({ retry }: { retry: () => void }) {
  return (
    <div className="text-xs text-content-muted">
      Could not load.{' '}
      <button
        className="min-h-11 font-semibold text-accent-text focus-visible:focus-ring"
        onClick={retry}
      >
        Retry
      </button>
    </div>
  )
}
function Metric({
  label,
  title,
  to,
  children,
  loading,
  error,
  retry,
}: {
  label: string
  title?: string
  to: string
  children: ReactNode
  loading: boolean
  error?: boolean
  retry: () => void
}) {
  if (error)
    return (
      <div className="min-h-[5.5rem] py-1.5 first:pr-3 last:pl-3">
        <p className="text-xs font-bold text-content-muted">{label}</p>
        <ReadError retry={retry} />
      </div>
    )
  if (loading)
    return (
      <LoadingRegion label={label} className="min-w-0 first:pr-3 last:pl-3">
        <MetricShimmer />
      </LoadingRegion>
    )
  return (
    <Link
      to={to}
      title={title}
      className="block min-w-0 py-1.5 first:pr-3 last:pl-3 hover:bg-surface-raised/50 focus-visible:focus-ring"
    >
      <p className="mb-0.5 text-[0.8125rem] font-bold leading-[1.125rem] text-content-muted">
        {label}
      </p>
      {children}
    </Link>
  )
}
