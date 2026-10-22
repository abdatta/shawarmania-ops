import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bike,
  QrCode,
  ChartNoAxesCombined,
  ChartPie,
  Minus,
  Store,
  TrendingUp,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useChangeGate } from '@/change-gates/context'
import { useAdapters, type Tables } from '@/data-access'
import { formatPaise, resolveBusinessDate } from '@/domain'
import { outletPresence, overviewPeriod, revenueChange } from '@/domain/overview'
import { aheadOfCoveringPaise, proRataPnl } from '@/domain/fixed-costs'
import { NeedsAttention } from '@/features/attention/needs-attention'
import { useOnForeground } from '@/features/attention/attention'
import { useSession } from '@/session/context'
import { ROLE_SEGMENTS } from '@/session/session'
import {
  readOverviewOutletCountHint,
  rememberOverviewOutletCount,
} from './overview-outlet-count-hint'
import { useOverviewRead } from './use-overview-read'

export function OutletsOverview() {
  const { outlets } = useAdapters()
  const read = useCallback(() => outlets.listOutlets(), [outlets])
  const rows = useOverviewRead(read)
  const [loadingOutletCount] = useState(readOverviewOutletCountHint)
  const oneRevenue = useChangeGate('one-revenue')
  useEffect(() => {
    if (rows.value !== undefined) rememberOverviewOutletCount(rows.value.length)
  }, [rows.value])
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <PageHeader
        title="Overview"
        subtitle={`${new Intl.DateTimeFormat('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Kolkata',
        }).format(new Date())} · ${oneRevenue ? 'Month to date' : 'Month through yesterday'}`}
      />
      {rows.error ? (
        <ReadError retry={rows.retry} />
      ) : rows.value === undefined ? (
        <LoadingRegion label="your outlets" className="space-y-3">
          {Array.from({ length: loadingOutletCount }, (_, i) => (
            <Card key={i} className="!px-3 !py-0" data-testid="overview-outlet-shimmer">
              <div className="flex h-13 items-center gap-2 border-b border-border">
                <Shimmer className="h-10 w-10 !rounded-full" />
                <Shimmer className="h-4 w-36" />
              </div>
              <div className="grid grid-cols-2 [&>*:nth-child(even)]:pl-3 [&>*:nth-child(odd)]:pr-3">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="@container min-w-0">
                    <MetricShimmer />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </LoadingRegion>
      ) : rows.value.length === 0 ? (
        <p className="text-sm text-content-muted">No outlets are available to your account.</p>
      ) : (
        rows.value.map((outlet) =>
          oneRevenue ? (
            <OneRevenueCard key={outlet.id} outlet={outlet} />
          ) : (
            <OutletCard key={outlet.id} outlet={outlet} />
          ),
        )
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
          to={`${base}/outlets/${outlet.id}`}
          data-testid={`open-outlet-${outlet.id}`}
          className="flex min-h-12 shrink-0 items-center rounded-xl text-sm font-semibold focus-visible:focus-ring"
          aria-label={
            status === 'partial' ? 'Online, some tablets offline. View outlet' : undefined
          }
        >
          {tablets.error ? (
            'Status unavailable'
          ) : status === null ? (
            <Shimmer className="h-9 w-20 !rounded-xl" />
          ) : (
            <span className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-2">
              {status === 'offline' ? 'Offline' : 'Online'}
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${status === 'offline' ? 'bg-danger' : status === 'partial' ? 'bg-warning' : 'bg-success'}`}
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

/**
 * The outlet card on One Revenue's definition (revenue-reads-the-same-everywhere,
 * design D5). Today's revenue adds delivery imported for today; the month runs
 * through today and always compares with the same dates last month, cut at the
 * same time of day; expenses carry delivery commission. Nothing here qualifies
 * a figure for missing delivery or an unstated commission. The month, today and
 * the cut are the server's, so this card sends no date.
 */
function OneRevenueCard({ outlet }: { outlet: Tables<'outlets'> }) {
  const { overview } = useAdapters()
  // P&L (Pro-rata) (fixed-costs-are-spread-over-the-month, design D9): where the
  // outlet has fixed costs this month, the tile charges the unpaid share of them
  // to date, and its Expenses line includes that share so the two still add up.
  const proRataGate = useChangeGate('pro-rata-pnl')
  const session = useSession()
  const base = `${session.mode === 'demo' ? '/demo' : ''}/${ROLE_SEGMENTS[session.role ?? 'franchise_admin']}`
  const [now, setNow] = useState(Date.now)
  const refreshClock = useCallback(() => setNow(Date.now()), [])
  useOnForeground(refreshClock)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  // Read again when the business date changes; the server decides what it is.
  const today = resolveBusinessDate(new Date(now), outlet.business_day_cutover)
  const todayRead = useCallback(
    () => overview.today(outlet.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` re-reads at the day's change
    [overview, outlet.id, today],
  )
  const monthRead = useCallback(
    () => overview.month(outlet.id, { fixedCosts: proRataGate }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` re-reads at the day's change
    [overview, outlet.id, today, proRataGate],
  )
  const drawerRead = useCallback(() => overview.drawer(outlet.id), [overview, outlet.id])
  const tabletsRead = useCallback(() => overview.tablets(outlet.id), [overview, outlet.id])
  const sales = useOverviewRead(todayRead)
  const month = useOverviewRead(monthRead)
  const drawer = useOverviewRead(drawerRead)
  const tablets = useOverviewRead(tabletsRead)
  const rereadTablets = tablets.retry
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') rereadTablets()
    }, 60_000)
    return () => clearInterval(timer)
  }, [rereadTablets])
  const status = tablets.value === undefined ? null : outletPresence(tablets.value, now)
  const source = (path: string) => `${base}/${path}?outlet=${encodeURIComponent(outlet.id)}`
  const m = month.value
  const monthName = m
    ? new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(
        new Date(`${m.month}-01T12:00:00+05:30`),
      )
    : ''
  const ledger = m ? `${source('ledger')}&view=month&month=${m.month}` : source('ledger')
  const change =
    m && m.previous.hasSales ? revenueChange(m.revenuePaise, m.previous.revenuePaise) : null
  const compared = m ? comparedRange(m.previous.from, m.previous.through) : ''
  const cutWords = m?.previous.cutAt
    ? `, to ${new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(m.previous.cutAt))}`
    : ''
  const todayTotal = sales.value
    ? sales.value.cashPaise + sales.value.upiPaise + sales.value.deliveryPaise
    : 0
  const fixedCosts = proRataGate ? (m?.fixedCosts ?? null) : null
  const proRata =
    fixedCosts && m && m.profitPaise !== null ? proRataPnl(m.profitPaise, fixedCosts) : null
  const shownProfit = proRata ?? m?.profitPaise ?? null
  const covering =
    fixedCosts && m && m.profitPaise !== null ? aheadOfCoveringPaise(m.profitPaise, fixedCosts) : 0
  const profitIcon =
    shownProfit === null
      ? ChartPie
      : shownProfit > 0
        ? TrendingUp
        : shownProfit < 0
          ? TrendingDown
          : Minus
  const profitTone: Tone =
    shownProfit === null || shownProfit === 0 ? 'primary' : shownProfit > 0 ? 'success' : 'danger'
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
          to={`${base}/outlets/${outlet.id}`}
          data-testid={`open-outlet-${outlet.id}`}
          className="flex min-h-12 shrink-0 items-center rounded-xl text-sm font-semibold focus-visible:focus-ring"
          aria-label={
            status === 'partial' ? 'Online, some tablets offline. View outlet' : undefined
          }
        >
          {tablets.error ? (
            'Status unavailable'
          ) : status === null ? (
            <Shimmer className="h-9 w-20 !rounded-xl" />
          ) : (
            <span className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-2">
              {status === 'offline' ? 'Offline' : 'Online'}
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${status === 'offline' ? 'bg-danger' : status === 'partial' ? 'bg-warning' : 'bg-success'}`}
              />
            </span>
          )}
        </Link>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <Metric
          label="Today's revenue"
          to={source('billing-history')}
          loading={sales.value === undefined}
          error={sales.error}
          retry={sales.retry}
        >
          {sales.value && (
            <>
              {sales.value.openPaise > 0 ? (
                <ValueBeside
                  paise={todayTotal}
                  testId={`sales-${outlet.id}`}
                  beside={formatPaise(
                    sales.value.openPaise - (sales.value.openPaise % 100),
                  ).replace(/\.\d{2}$/, '')}
                  besideTitle={`Open orders not yet paid ${formatPaise(sales.value.openPaise)}`}
                  besideTestId={`open-${outlet.id}`}
                  icon={Banknote}
                  tone="primary"
                />
              ) : (
                <MetricValue icon={Banknote} tone="primary">
                  <OverviewMoney paise={todayTotal} data-testid={`sales-${outlet.id}`} />
                </MetricValue>
              )}
              <TenderLine
                outletId={outlet.id}
                cashPaise={sales.value.cashPaise}
                upiPaise={sales.value.upiPaise}
                deliveryPaise={sales.value.deliveryPaise}
              />
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
          label={m ? `${monthName} revenue` : 'Month revenue'}
          title={`${monthName} revenue · month to date`}
          to={ledger}
          loading={m === undefined}
          error={month.error}
          retry={month.retry}
        >
          {m && (
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
                <OverviewMoney paise={m.revenuePaise} data-testid={`revenue-${outlet.id}`} />
              </MetricValue>
              <Subtext title={`Compared with ${compared}${cutWords}`}>
                {change === null ? (
                  <span data-testid={`comparison-${outlet.id}`}>No sales {compared}</span>
                ) : (
                  <span
                    className="flex items-center gap-1"
                    data-testid={`comparison-${outlet.id}`}
                    aria-label={`${change < 0 ? 'Down' : change > 0 ? 'Up' : 'Level'} ${Math.abs(change).toFixed(1)}% against ${compared}${cutWords}`}
                  >
                    {change < 0 ? (
                      <ArrowDownRight size={13} aria-hidden />
                    ) : change === 0 ? (
                      <Minus size={13} aria-hidden />
                    ) : (
                      <ArrowUpRight size={13} aria-hidden />
                    )}
                    <span className="font-bold">{Math.abs(change).toFixed(1)}%</span> vs {compared}
                  </span>
                )}
              </Subtext>
            </>
          )}
        </Metric>
        <Metric
          label={
            m
              ? proRata !== null
                ? `${monthName} P&L (Pro-rata)`
                : `${monthName} P&L · est.`
              : 'P&L · est.'
          }
          title={
            proRata !== null && fixedCosts
              ? `${monthName} P&L (Pro-rata) · this month's fixed costs charged to today`
              : `${monthName} estimated operating P&L · month to date · delivery commission included`
          }
          to={ledger}
          loading={m === undefined}
          error={month.error}
          retry={month.retry}
        >
          {m && (
            <>
              {proRata !== null && m.revenuePaise > 0 ? (
                /*
                  The margin beside the figure it is the margin of, as today's
                  open orders sit beside its revenue (owner, 2026-10-21).
                */
                <ValueBeside
                  paise={proRata}
                  testId={`profit-${outlet.id}`}
                  beside={`${((proRata / m.revenuePaise) * 100).toFixed(1)}%`}
                  besideTitle="Operating margin"
                  besideTestId={`margin-${outlet.id}`}
                  icon={profitIcon}
                  tone={profitTone}
                />
              ) : (
                <MetricValue icon={profitIcon} tone={profitTone}>
                  {shownProfit === null ? (
                    <p className="text-sm leading-7">No sales recorded</p>
                  ) : (
                    <OverviewMoney paise={shownProfit} data-testid={`profit-${outlet.id}`} />
                  )}
                </MetricValue>
              )}
              {proRata !== null && fixedCosts && m.profitPaise !== null ? (
                /*
                  Expenses, with the unpaid share so they add up to the figure,
                  then how far the month is Short of covering all of its fixed
                  costs, or Ahead (owner, 2026-10-21). Gone once every fixed cost
                  of the month is paid, when it equals the figure.
                */
                <Subtext
                  fit
                  title={`Expenses ${formatPaise(m.expensesPaise + fixedCosts.unpaidPaise)}, of which fixed costs owed to date and unpaid ${formatPaise(fixedCosts.unpaidPaise)}${fixedCosts.stillToPayPaise > 0 ? ` · ${covering < 0 ? 'Short' : 'Ahead'} of covering ${monthName}'s fixed costs ${formatPaise(Math.abs(covering))}` : ''}`}
                >
                  Expenses{' '}
                  <span data-testid={`pro-rata-expenses-${outlet.id}`}>
                    <SupportingMoney paise={m.expensesPaise + fixedCosts.unpaidPaise} />
                  </span>
                  {fixedCosts.stillToPayPaise > 0 && (
                    <>
                      <span> · </span>
                      {covering < 0 ? 'Short' : 'Ahead'}{' '}
                      <span data-testid={`covering-${outlet.id}`}>
                        <SupportingMoney paise={Math.abs(covering)} />
                      </span>
                    </>
                  )}
                </Subtext>
              ) : (
                <Subtext
                  title={`Expenses ${formatPaise(m.expensesPaise)}, of which delivery commission ${formatPaise(m.commissionPaise)} · Percentage is operating margin`}
                >
                  Expenses <SupportingMoney paise={m.expensesPaise} />
                  {m.profitPaise !== null && m.revenuePaise > 0 && (
                    <>
                      <span> · </span>
                      <span className="font-bold">
                        {((m.profitPaise / m.revenuePaise) * 100).toFixed(1)}%
                      </span>
                    </>
                  )}
                </Subtext>
              )}
            </>
          )}
        </Metric>
      </div>
    </Card>
  )
}

/**
 * A tile's figure with a second, smaller one beside it, unlabelled, in the tender
 * figures' weight and colour: today's revenue with the sale still in progress,
 * `₹35,630 · ₹1,240` (billing-day-at-a-glance, design D1; owner, 2026-10-16),
 * and the month's P&L with its margin, `₹2,431 · 0.4%` (owner, 2026-10-21).
 *
 * A phone's cell is about 110px beside its icon, which a five-digit day and a
 * four-digit open amount overrun. So, as the tender line does, every form is
 * measured against the cell and the first that fits is drawn: the icon with
 * the figure at the tenders' size, then at half the headline's, then the same
 * two without the icon. The icon is the decoration; both figures are the point.
 */
function ValueBeside({
  paise,
  testId,
  beside,
  besideTitle,
  besideTestId,
  icon: Icon,
  tone,
}: {
  paise: number
  testId: string
  beside: string
  besideTitle: string
  besideTestId: string
  icon: LucideIcon
  tone: Tone
}) {
  const box = useRef<HTMLDivElement>(null)
  const measures = useRef<(HTMLSpanElement | null)[]>([])
  const [form, setForm] = useState(0)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const choose = () => {
      const width = element.clientWidth
      // No layout to measure (jsdom under test): the first form stands.
      if (!width) return
      const [regular = 0, small = 0] = measures.current.map((m) => m?.scrollWidth ?? 0)
      // The icon is h-9 w-9 beside a gap-1.
      const icon = 40
      setForm(regular + icon <= width ? 0 : small + icon <= width ? 1 : regular <= width ? 2 : 3)
    }
    choose()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(choose)
    observer.observe(element)
    return () => observer.disconnect()
  }, [paise, beside])
  const figures = (small: boolean, shown = true) => (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <OverviewMoney paise={paise} {...(shown ? { 'data-testid': testId } : {})} />
      <span
        className={`${small ? 'text-[0.6875rem]' : 'text-[0.8125rem]'} font-bold text-content-muted`}
        {...(shown ? { title: besideTitle, 'data-testid': besideTestId } : {})}
      >
        <span aria-hidden>· </span>
        {beside}
      </span>
    </span>
  )
  const withIcon = form < 2
  return (
    <div ref={box} className="relative flex min-h-9 items-center justify-between gap-1">
      {/* Both sizes, measured and never seen. */}
      <div aria-hidden className="invisible absolute left-0 top-0 h-0 overflow-hidden">
        {[false, true].map((small, index) => (
          <span
            key={index}
            ref={(element) => {
              measures.current[index] = element
            }}
            className="block w-max"
          >
            {figures(small, false)}
          </span>
        ))}
      </div>
      <div className="min-w-0">{figures(form % 2 === 1)}</div>
      {withIcon && (
        <span
          aria-hidden
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CLASS[tone]}`}
        >
          <Icon size={22} strokeWidth={1.8} />
        </span>
      )}
    </div>
  )
}

/**
 * Today's Cash · UPI · Delivery in the longest form that fits one line (owner,
 * 2026-10-16). Words where there is room; then delivery becomes a bike, then UPI
 * a phone, then cash a note, in that order; and only when even the icons do
 * not fit, two lines in words, breaking between the counter's tenders and
 * delivery.
 * Every form is measured, hidden, against the cell's real width, so it adapts
 * to any screen; the title and labels keep exact figures and words.
 */
function TenderLine({
  outletId,
  cashPaise,
  upiPaise,
  deliveryPaise,
}: {
  outletId: string
  cashPaise: number
  upiPaise: number
  deliveryPaise: number
}) {
  const cash = (icon: boolean) => (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {icon ? <Banknote size={13} aria-label="Cash" /> : 'Cash'}
      <SupportingMoney paise={cashPaise} />
    </span>
  )
  const upi = (icon: boolean) => (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {icon ? <QrCode size={13} aria-label="UPI" /> : 'UPI'}
      <SupportingMoney paise={upiPaise} />
    </span>
  )
  // Only the shown copy carries the test id; the measured ones are never read.
  const delivery = (icon: boolean, shown = true) => (
    <span
      className="inline-flex items-center gap-0.5 whitespace-nowrap"
      {...(shown ? { 'data-testid': `delivery-${outletId}` } : {})}
    >
      {icon ? <Bike size={13} aria-label="Delivery" /> : 'Delivery'}
      <SupportingMoney paise={deliveryPaise} />
    </span>
  )
  const dot = <span aria-hidden>·</span>
  // Shortened in the order the owner chose: delivery, then UPI, then cash. If
  // none fits, two lines in words.
  const forms = [
    [false, false, false],
    [false, false, true],
    [false, true, true],
    [true, true, true],
  ] as const
  const line = ([c, u, d]: readonly [boolean, boolean, boolean], shown = true) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {cash(c)}
      {dot}
      {upi(u)}
      {dot}
      {delivery(d, shown)}
    </span>
  )
  const box = useRef<HTMLDivElement>(null)
  const measures = useRef<(HTMLSpanElement | null)[]>([])
  const [chosen, setChosen] = useState(0)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const choose = () => {
      const width = element.clientWidth
      const fits = measures.current.findIndex((m) => !!m && m.scrollWidth <= width)
      setChosen(fits < 0 ? forms.length : fits)
    }
    choose()
    // Without a ResizeObserver the first measurement stands.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(choose)
    observer.observe(element)
    return () => observer.disconnect()
  }, [cashPaise, upiPaise, deliveryPaise, forms.length])
  return (
    <div
      ref={box}
      title={`Cash ${formatPaise(cashPaise)} · UPI ${formatPaise(upiPaise)} · Delivery ${formatPaise(deliveryPaise)}`}
      data-testid="metric-subtext"
      // A flex box, so an icon line is exactly one line tall: inline boxes
      // would add the text's strut beneath the icons.
      className="relative mt-0.5 flex text-[0.8125rem] leading-[1.125rem] text-content-muted"
    >
      {/* Every one-line form, measured and never seen. */}
      <div aria-hidden className="invisible absolute left-0 top-0 h-0 overflow-hidden">
        {forms.map((form, index) => (
          <span
            key={index}
            ref={(element) => {
              measures.current[index] = element
            }}
            className="block w-max"
          >
            {line(form, false)}
          </span>
        ))}
      </div>
      {chosen < forms.length ? (
        line(forms[chosen]!)
      ) : (
        // Two lines leave room for words again: the counter's tenders, then
        // delivery, with no separator left hanging at a line's end.
        <span className="flex flex-col">
          <span className="flex items-center gap-1 whitespace-nowrap">
            {cash(false)}
            {dot}
            {upi(false)}
          </span>
          <span className="flex">{delivery(false)}</span>
        </span>
      )}
    </div>
  )
}

/** `1–15 Sep`: the dates a month is compared with. */
function comparedRange(from: string, through: string): string {
  const name = new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${from}T12:00:00+05:30`))
  return `${Number(from.slice(8))}–${Number(through.slice(8))} ${name}`
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

/**
 * A tile's caption, one line. With `fit`, a caption that overruns its cell
 * drops to the size today's open orders fall back to, and returns once the cell
 * is wide enough again: *Expenses ₹1.2L · Ahead ₹3.9L* is wider than a phone's
 * cell (owner, 2026-10-21). Text scales with its size, so the width it would
 * take at the regular size is the small width scaled up; no hidden copy, which
 * would repeat the caption's test ids.
 */
function Subtext({
  children,
  title,
  fit = false,
}: {
  children: ReactNode
  title?: string
  fit?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [small, setSmall] = useState(false)
  useLayoutEffect(() => {
    const element = box.current
    if (!fit || !element) return
    const choose = () => {
      const width = element.clientWidth
      // No layout to measure (jsdom under test): the regular size stands.
      if (!width) return
      setSmall((wasSmall) =>
        wasSmall ? (element.scrollWidth * 13) / 11 > width + 1 : element.scrollWidth > width + 1,
      )
    }
    choose()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(choose)
    observer.observe(element)
    return () => observer.disconnect()
  })
  return (
    <div
      ref={box}
      title={title}
      data-testid="metric-subtext"
      className={`mt-0.5 whitespace-nowrap ${small ? 'text-[0.6875rem]' : 'text-[0.8125rem]'} leading-[1.125rem] text-content-muted`}
    >
      {children}
    </div>
  )
}
type Tone = 'success' | 'danger' | 'primary'
const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  primary: 'bg-primary/10 text-accent-text',
}
function MetricValue({
  children,
  icon: Icon,
  tone,
}: {
  children: ReactNode
  icon: LucideIcon
  tone: Tone
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-1">
      <div className="min-w-0">{children}</div>
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CLASS[tone]}`}
      >
        <Icon size={22} strokeWidth={1.8} />
      </span>
    </div>
  )
}
function MetricShimmer({ lines = 1 }: { lines?: number }) {
  return (
    <div className="min-w-0 py-1.5">
      <Shimmer className="mb-0.5 h-[1.125rem] w-28 max-w-full" />
      <div className="flex h-9 items-center justify-between gap-1">
        <Shimmer className="h-6 w-24 max-w-full" />
        <Shimmer className="h-9 w-9 shrink-0 !rounded-lg" />
      </div>
      {Array.from({ length: lines }, (_, line) => (
        <Shimmer
          key={line}
          className={`mt-0.5 h-[1.125rem] w-28 max-w-full ${line > 0 ? '@min-[13rem]:hidden' : ''}`}
        />
      ))}
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
  lines,
}: {
  label: string
  title?: string
  to: string
  children: ReactNode
  loading: boolean
  error?: boolean
  retry: () => void
  /** Subtext lines the shimmer reserves; one unless the loaded cell has more. */
  lines?: number
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
      <LoadingRegion label={label} className="@container min-w-0 first:pr-3 last:pl-3">
        <MetricShimmer {...(lines ? { lines } : {})} />
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
