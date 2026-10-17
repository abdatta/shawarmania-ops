import { ReceiptText, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Money } from '@/components/ui/money'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { useAdapters } from '@/data-access'
import {
  BILLING_PAYMENT_METHODS,
  DataActionError,
  type BillingBill,
  type BillingAttributionOutcome,
  type BillingDayStats,
  type BillingDeliveryDiagnostic,
  type BillingOrder,
  type CounterBiller,
  type KitchenMarks,
} from '@/data-access/adapters'
import { carryPeriod, earliestOffered, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'

import {
  applyBillFilter,
  billFilterSummary,
  dayTablets,
  DEFAULT_BILL_FILTER,
  isDefaultBillFilter,
  type BillFilter,
} from './bill-filter'
import { BillFilterSheet } from './bill-filter-sheet'
import { averageBillPaise, combinedTakingsPaise, paymentTotalPaise } from './day-totals'
import { ManagerBillDetail } from './manager-bill-detail'
import { BillDetailTransition, DETAIL_TRANSITION_MS, ManagerBillSummary } from './manager-bill-row'
import { DishOpenOrderSummary } from './dish-open-order-summary'
import { ManagerDayStats, ManagerDayStatsShimmer } from './manager-day-stats'
import { countSyncProblems, ManagerSyncStatus } from './manager-sync-status'
import { PaymentTotalCards } from './payment-total-cards'

/**
 * The manager's two open-order groups, derived — never stored.
 *
 * This lived in a shared `pipeline.ts` while the counter rail drew the same two
 * bands. #55 replaced the rail with one list in which a card's position encodes
 * nothing, and left the manager's history exactly as it was, so the split is now
 * this screen's own business and lives beside its only reader.
 *
 * A paid-but-unprepared order groups with Preparing: that is the upfront payer
 * whose food is still being made. Cancelled orders are nobody's work in flight.
 */
function splitPipeline(orders: readonly BillingOrder[]): {
  preparing: BillingOrder[]
  unpaidPrepared: BillingOrder[]
} {
  const preparing: BillingOrder[] = []
  const unpaidPrepared: BillingOrder[] = []
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    if (order.status === 'open') {
      if (order.preparedAt === null) preparing.push(order)
      else unpaidPrepared.push(order)
    } else if (order.status === 'paid' && order.preparedAt === null) {
      preparing.push(order)
    }
    // Paid and prepared: fully done, listed among the bills instead.
  }
  return { preparing, unpaidPrepared }
}

type View = 'bills' | 'orders' | 'stats'

const ORDER_CANCELLATION_REASONS = ['Duplicate order', 'Mistaken entry'] as const

function BillingHistoryShimmer() {
  return (
    <LoadingRegion label="billing records" className="space-y-2">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid min-h-20 grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-border bg-surface p-3"
        >
          <div className="space-y-2">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="h-3 w-48 max-w-full" />
          </div>
          <div className="space-y-2">
            <Shimmer className="ml-auto h-5 w-16" />
            <Shimmer className="ml-auto h-3 w-5" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}

export function ManagerBillingHistory() {
  const { billing, outlets: outletsAdapter, kitchen } = useAdapters()
  const session = useSession()
  /*
    An open order says what the counter's card says (each-dish-is-ticked-off,
    design R11), and the Orders tab reads for itself: the page counts the open
    orders when it opens, and the orders and their kitchens' answers are read
    each time the tab is chosen — so switching to it is how the owner sees the
    latest — never on a timer and never live.
  */
  const [marks, setMarks] = useState<KitchenMarks | null>(null)
  const [readAt, setReadAt] = useState(() => new Date())
  const [openCount, setOpenCount] = useState<number | null>(null)
  /** The outlet the listed open orders are of; another means not read yet. */
  const [ordersOutlet, setOrdersOutlet] = useState<string | null>(null)
  // Which outlet, asked the way every other outlet-scoped surface asks it: chips
  // in the header, remembered between surfaces, conferring nothing.
  const { outletId, selector: outletSelector } = useOutletScope()
  /**
   * The outlet's today, and the outlet it is the today of.
   *
   * Its current business date through its own cutover. Carrying the outlet
   * means moving to another outlet makes it stale in the same instant, so there
   * is no frame in which the new outlet is read against the old outlet's today,
   * and nothing to reset by an effect — only something that stops applying.
   */
  const [resolvedToday, setResolvedToday] = useState<{ outletId: string; day: string } | null>(null)
  /**
   * The reader's day, and the today it was chosen against — **not the outlet**.
   *
   * It used to carry the outlet, which made a switch fall back to today: the
   * reader stepped back to the 12th, changed outlet, and was on today again.
   * The day is a fact about what they are reading, not where, so it survives a
   * switch through `carryPeriod` — except that a reader who was on today stays
   * on today, the new outlet's (app-shell: the reader keeps their place).
   */
  const [chosenDay, setChosenDay] = useState<{ day: string; today: string } | null>(null)
  const [view, setView] = useState<View>('bills')
  const [bills, setBills] = useState<BillingBill[]>([])
  const [orders, setOrders] = useState<BillingOrder[]>([])
  const [diagnostics, setDiagnostics] = useState<BillingDeliveryDiagnostic[]>([])
  const [billers, setBillers] = useState<CounterBiller[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closingIds, setClosingIds] = useState<string[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /*
    The Bills tab's sort and filter (billing-day-at-a-glance, design D4). Kept
    while the day or outlet changes — the reader is asking the same question of
    another day — and gone when they leave the page. Never stored.
  */
  const [filter, setFilter] = useState<BillFilter>(DEFAULT_BILL_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  /** The Stats tab's figures, and the outlet-day they are of; another means not read yet. */
  const [stats, setStats] = useState<{ key: string; value: BillingDayStats } | null>(null)
  const [statsFailed, setStatsFailed] = useState<string | null>(null)
  const closingTimers = useRef<number[]>([])
  const anchorFrame = useRef<number | null>(null)
  // Empty until this outlet's own today has landed, which is what holds the day
  // bar behind its silhouette and the reads behind their guard.
  const today = resolvedToday?.outletId === outletId ? resolvedToday.day : ''
  const businessDate = today && carryPeriod(chosenDay?.day ?? null, chosenDay?.today ?? null, today)
  // The control that calls this is only rendered once the outlet's today has
  // landed, so the day is always chosen against a real today.
  const setDate = (day: string) => setChosenDay({ day, today })
  // Paid bills only, and derived rather than read again: the list is every bill
  // of this outlet-day, so the settled ones are already in hand. Cancelled bills
  // are listed but take part in no figure.
  const paidBills = bills.filter((bill) => bill.status !== 'void')
  const methodTotals = BILLING_PAYMENT_METHODS.map((paymentMethod) => ({
    method: paymentMethod,
    totalPaise: paymentTotalPaise(paidBills, paymentMethod),
  }))
  const takingsPaise = combinedTakingsPaise(methodTotals)
  // What the Bills tab lists: the filter narrows and orders the day's bills,
  // and touches none of the figures above, which stay the day's.
  const visibleBills = applyBillFilter(bills, filter)
  const filtering = !isDefaultBillFilter(filter)
  // Open orders follow the day bar (design D2). Filtered here rather than in the
  // adapter's read, which the counter shares.
  const dayOrders = orders.filter((order) => order.businessDate === businessDate)
  const unpaidPaise = dayOrders
    .filter((order) => order.status === 'open')
    .reduce((sum, order) => sum + order.totalPaise, 0)
  const statsKey = `${outletId}|${businessDate}`
  // The refusals waiting behind the Status tab, named on the tab itself. Its two
  // neighbours already carry their counts, so a tab that says nothing reads as a
  // tab with nothing in it — which is how the first production refusal went
  // unread. Counted from the same function the panel lists, and shown only when
  // it is non-zero: this tab always has contents, so a zero would say the one
  // thing that is not true of it.
  const syncProblemCount = countSyncProblems(diagnostics)

  useEffect(
    () => () => {
      closingTimers.current.forEach((timer) => window.clearTimeout(timer))
      if (anchorFrame.current !== null) window.cancelAnimationFrame(anchorFrame.current)
    },
    [],
  )

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outletsAdapter
      .getOutlet(outletId)
      .then((outlet) => {
        // Through the outlet's own cutover, never off the device clock: a bill
        // rung at 00:30 belongs to the trading day that is still running.
        if (active && outlet)
          setResolvedToday({
            outletId,
            day: resolveBusinessDate(new Date(), outlet.business_day_cutover),
          })
      })
      .catch(() => {
        if (active) setMessage('Could not work out which day this is. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outletId, outletsAdapter])

  // The Orders tab's own read, on the dish path.
  const loadOrders = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!outletId) return
      try {
        const [nextOrders, nextMarks] = await Promise.all([
          billing.listManagerOpenOrders(outletId),
          // The orders still list if the kitchens cannot be read.
          kitchen.readManagerDishMarks(outletId).catch(() => null),
        ])
        if (!isCurrent()) return
        setOrders(nextOrders)
        setMarks(nextMarks)
        setReadAt(new Date())
        // No count here: these are every day's open orders, and the tab counts
        // the chosen day's — from the list itself while it is open, and from the
        // page's own day-scoped count otherwise.
        setOrdersOutlet(outletId)
      } catch (cause) {
        if (!isCurrent()) return
        setMessage(cause instanceof DataActionError ? cause.message : 'Could not load open orders.')
      }
    },
    [billing, kitchen, outletId],
  )

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!outletId || !businessDate) return
    setLoading(true)
    try {
      // One read of the whole outlet-day. The status and payment-method
      // parameters stay on the adapter for the counter, and this surface passes
      // neither: every bill of the day is listed, and each says for itself
      // whether it was paid or cancelled and what it was paid with.
      const [nextBills, nextDiagnostics, nextBillers, nextCount] = await Promise.all([
        billing.listManagerHistory({ outletId, businessDate, status: 'all', paymentMethod: 'all' }),
        // The orders are the Orders tab's to read; the page only counts them
        // for the tab's label.
        billing.listDeliveryDiagnostics(outletId),
        billing.listBillers(outletId),
        billing.countManagerOpenOrders(outletId, businessDate),
      ])
      setBills(nextBills)
      setOpenCount(nextCount)
      setDiagnostics(nextDiagnostics)
      setBillers(nextBillers)
      setSelectedId((current) =>
        current && nextBills.some((bill) => bill.id === current) ? current : null,
      )
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'Could not load billing history.',
      )
    } finally {
      setLoading(false)
    }
  }, [billing, businessDate, outletId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  // Choosing the Orders tab reads it afresh, and so does a new outlet or day
  // while it is open.
  // A read for an outlet or day no longer shown is dropped when it lands.
  useEffect(() => {
    if (view !== 'orders') return
    let current = true
    void Promise.resolve().then(() => loadOrders(() => current))
    return () => {
      current = false
    }
  }, [view, loadOrders, businessDate])

  // Choosing Stats reads the chosen day's figures, and so does a new outlet or
  // day while it is open. A read for a day no longer shown is dropped.
  useEffect(() => {
    if (view !== 'stats' || !outletId || !businessDate) return
    let current = true
    const key = `${outletId}|${businessDate}`
    void Promise.resolve()
      .then(() => billing.readDayStats(outletId, businessDate))
      .then((value) => {
        if (!current) return
        setStats({ key, value })
        setStatsFailed(null)
      })
      .catch((cause: unknown) => {
        if (current)
          setStatsFailed(
            cause instanceof DataActionError ? cause.message : 'Could not load the day’s stats.',
          )
      })
    return () => {
      current = false
    }
  }, [billing, view, outletId, businessDate])

  const mutate = async (operation: () => Promise<unknown>, keepBillOpen = false) => {
    try {
      setMessage(null)
      await operation()
      setReason('')
      setCancellingId(null)
      setCancellingOrderId(null)
      if (!keepBillOpen) setSelectedId(null)
      await load()
      // A cancellation on the Orders tab leaves it showing the orders as they now are.
      if (view === 'orders') await loadOrders()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
    }
  }

  const reviewAttribution = async (
    billId: string,
    outcome: BillingAttributionOutcome,
    resolvedOperatorId?: string | null,
    reviewReason?: string | null,
  ) => {
    try {
      setMessage(null)
      await billing.reviewAttribution(billId, outcome, resolvedOperatorId, reviewReason)
      await load()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That review could not be recorded.',
      )
      throw cause
    }
  }

  const chooseView = (next: View) => {
    // Choosing another tab reads it in the effect above; the one already open,
    // tapped again, is read again here.
    if (next === 'orders' && view === 'orders') void loadOrders()
    setView(next)
    setSelectedId(null)
    setCancellingId(null)
    setCancellingOrderId(null)
    setReason('')
  }

  const closeDetail = (billId: string) => {
    setClosingIds((current) => (current.includes(billId) ? current : [...current, billId]))
    const timer = window.setTimeout(() => {
      setClosingIds((current) => current.filter((id) => id !== billId))
      closingTimers.current = closingTimers.current.filter((id) => id !== timer)
    }, DETAIL_TRANSITION_MS)
    closingTimers.current.push(timer)
  }

  /**
   * Hold the summary the manager just pressed where their finger left it, while
   * the taller detail above it collapses out from under it.
   *
   * It holds by scrolling, so it can only hold as far as the page can scroll.
   * Swapping near the top of a short list asks to scroll above the document
   * start, and the row rises by whatever is still owed. Nothing here can fix
   * that: keeping it truly still would mean inserting space above the header,
   * which moves the page instead of the row.
   */
  const anchorSummaryDuringSwap = (billId: string) => {
    const summary = document.getElementById(`bill-summary-${billId}`)
    if (!summary) return

    const targetTop = summary.getBoundingClientRect().top
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const until = window.performance.now() + (reducedMotion ? 50 : DETAIL_TRANSITION_MS + 60)

    const keepPosition = () => {
      const target = document.getElementById(`bill-summary-${billId}`)
      if (!target) return

      const offset = target.getBoundingClientRect().top - targetTop
      if (Math.abs(offset) >= 1) window.scrollBy(0, offset)
      if (window.performance.now() < until)
        anchorFrame.current = window.requestAnimationFrame(keepPosition)
    }

    if (anchorFrame.current !== null) window.cancelAnimationFrame(anchorFrame.current)
    anchorFrame.current = window.requestAnimationFrame(keepPosition)
  }

  const selectBill = (billId: string) => {
    if (selectedId === billId) {
      closeDetail(billId)
      setSelectedId(null)
    } else {
      const currentIndex = selectedId
        ? visibleBills.findIndex((bill) => bill.id === selectedId)
        : -1
      const nextIndex = visibleBills.findIndex((bill) => bill.id === billId)
      if (selectedId) closeDetail(selectedId)
      if (currentIndex >= 0 && nextIndex > currentIndex) anchorSummaryDuringSwap(billId)
      setSelectedId(billId)
    }
    setCancellingId(null)
    setReason('')
  }

  return (
    <section className="space-y-4" aria-labelledby="billing-history-title">
      <PageHeader
        scope={outletSelector}
        title="Billing history"
        subtitle="Bills stay in history after they are cancelled."
      />

      {/*
        Two questions, and the surface asks no others. Which outlet is answered
        in the header, where every outlet-scoped surface asks it; which day is
        answered here, in the same bar the Ledger uses. The bill-status and
        payment-method pickers that used to sit beside them narrowed a list that
        is already one outlet's one day, and each row names its own state and
        tender, so they were re-stating what was on screen.
      */}
      {today === '' ? (
        // The bar's own silhouette, so the list below does not move when the
        // outlet's today lands.
        <LoadingRegion label="which day this is">
          <Shimmer className="h-[calc(var(--size-control-phone)+0.5rem+2px)] w-full" />
        </LoadingRegion>
      ) : (
        <PeriodBar
          label="Day"
          testIdPrefix="billing-history"
          onStep={(by) => setDate(shiftBusinessDate(businessDate, by))}
          canStepForward={businessDate < today}
        >
          <DayField
            businessDate={businessDate}
            today={today}
            earliest={earliestOffered(today)}
            testIdPrefix="billing-history"
            onChange={setDate}
          />
        </PeriodBar>
      )}

      {/*
        What the outlet took, above the tabs rather than inside one.

        The surface is opened to answer one question — what did this day take —
        and the answer used to be two taps away, behind a tab named after tablet
        sync. It is the same four figures over the same paid bills; only their
        address changed. Four across rather than two by two because a wrapped
        row makes the reader work out which card belongs to which line, and
        because a strip this size can sit above the tabs without pushing the
        list off a phone.

        `loading` rather than `today === ''`: the figures are derived from bills,
        so they are only true once the day's read has landed, and rendering the
        cards a moment early would show a real ₹0 that is about to change. The
        silhouette is the strip's own height, so the tabs do not move under a
        finger already on its way to them.
      */}
      {loading ? (
        <LoadingRegion label="the day’s totals">
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((card) => (
              <Shimmer key={card} className="h-[4.5rem] w-full rounded-xl" />
            ))}
          </div>
        </LoadingRegion>
      ) : (
        <section aria-label="Payment totals">
          <PaymentTotalCards
            totals={methodTotals}
            testIdPrefix="billing-total"
            dense
            // The two questions the tender split stops one short of: what the
            // day took altogether, and what an average order came to. `AOV`
            // rather than `Average bill` because the full name does not fit a
            // quarter of a phone row, and it is what the owner calls it.
            further={[
              { label: 'Total', paise: takingsPaise, testId: 'billing-total-combined' },
              {
                label: 'AOV',
                paise: averageBillPaise(takingsPaise, paidBills.length),
                testId: 'billing-total-average',
              },
            ]}
          />
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing history views">
        {(
          [
            [
              'bills',
              filtering && visibleBills.length !== bills.length
                ? `Bills (${visibleBills.length}/${bills.length})`
                : `Bills (${bills.length})`,
            ],
            // The count is the whole board — both bands — under the plain name
            // this page has always used; the band names live in the sections.
            // It is the chosen day's, as the list is.
            [
              'orders',
              `Open orders (${
                view === 'orders' && ordersOutlet === outletId
                  ? dayOrders.length
                  : (openCount ?? '…')
              })`,
            ],
            // A refusal keeps its count on the tab, in red, so it reads as a
            // warning rather than as a number of stats.
            [
              'stats',
              syncProblemCount > 0 ? (
                <>
                  Stats {/* Red on the plain tab; the chosen tab's fill keeps its own colour. */}
                  <span className={view === 'stats' ? undefined : 'text-danger'}>
                    ({syncProblemCount})
                  </span>
                </>
              ) : (
                'Stats'
              ),
            ],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={view === id ? 'primary' : 'secondary'}
            size="phone"
            role="tab"
            aria-selected={view === id}
            onClick={() => chooseView(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
        >
          {message}
        </p>
      )}

      {loading ? (
        <BillingHistoryShimmer />
      ) : view === 'bills' ? (
        <div className="space-y-2">
          {bills.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              {filtering && (
                <Button
                  variant="ghost"
                  size="phone"
                  onClick={() => setFilter(DEFAULT_BILL_FILTER)}
                  data-testid="bill-filter-clear"
                >
                  Clear
                </Button>
              )}
              {/* What is in force is the button's own label, as on the kitchen. */}
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                aria-label={filtering ? `Filter: ${billFilterSummary(filter)}` : 'Filter'}
                className="inline-flex min-h-12 min-w-0 max-w-[75%] items-center gap-2 rounded-xl border-2 border-border px-4 font-bold text-content focus-visible:focus-ring"
              >
                <SlidersHorizontal aria-hidden size={20} className="shrink-0" />
                <span data-testid="bill-filter-summary" className="truncate">
                  {filtering ? billFilterSummary(filter) : 'Filter'}
                </span>
              </button>
            </div>
          )}
          {filterOpen && (
            <BillFilterSheet
              open
              filter={filter}
              tablets={dayTablets(bills)}
              onChange={setFilter}
              onClose={() => setFilterOpen(false)}
            />
          )}
          {bills.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No bills on this day." />
          ) : visibleBills.length === 0 ? (
            <div className="space-y-3">
              <EmptyState icon={ReceiptText} title="No bills match" />
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  size="phone"
                  onClick={() => setFilter(DEFAULT_BILL_FILTER)}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="manager-bill-list">
              {visibleBills.map((bill) => {
                const expanded = bill.id === selectedId
                const showingDetail = expanded || closingIds.includes(bill.id)
                return (
                  <li key={bill.id} data-testid={`manager-bill-${bill.id}`}>
                    <ManagerBillSummary
                      bill={bill}
                      expanded={expanded}
                      showingDetail={showingDetail}
                      onToggle={() => selectBill(bill.id)}
                    />
                    {showingDetail && (
                      <BillDetailTransition open={expanded}>
                        <ManagerBillDetail
                          bill={bill}
                          currentUserId={session.userId}
                          cancelling={cancellingId === bill.id}
                          reason={reason}
                          onReasonChange={setReason}
                          onStartCancelling={() => {
                            setCancellingId(bill.id)
                            setReason('')
                          }}
                          onKeepBill={() => {
                            setCancellingId(null)
                            setReason('')
                          }}
                          onConfirmCancellation={() =>
                            void mutate(() => billing.voidBill(bill.id, reason), true)
                          }
                          eligibleBillers={billers}
                          onReviewAttribution={(outcome, resolvedOperatorId, reviewReason) =>
                            reviewAttribution(bill.id, outcome, resolvedOperatorId, reviewReason)
                          }
                        />
                      </BillDetailTransition>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : view === 'stats' ? (
        // The tablets' sync, which speaks for now, then the chosen day's figures
        // (billing-day-at-a-glance, design D3).
        <div className="space-y-3">
          <ManagerSyncStatus diagnostics={diagnostics} />
          {stats?.key === statsKey ? (
            <ManagerDayStats stats={stats.value} />
          ) : statsFailed ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
            >
              {statsFailed}
            </p>
          ) : (
            <ManagerDayStatsShimmer />
          )}
        </div>
      ) : view === 'orders' ? (
        ordersOutlet !== outletId ? (
          <LoadingRegion label="open orders" className="space-y-2">
            <Shimmer className="h-40 rounded-xl" />
            <Shimmer className="h-40 rounded-xl" />
          </LoadingRegion>
        ) : dayOrders.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No open orders on this day." />
        ) : (
          <>
            {/* What the day's open orders still owe: unpaid ones only, as
                Overview's figure beside Today's revenue (design D2). A header
                like the two section names below it, with its value on the
                right; "yet to be paid", because "unpaid" reads as never
                (owner, 2026-10-16). */}
            <h3 className="flex items-baseline justify-between text-sm font-black text-content">
              Yet to be paid
              <Money paise={unpaidPaise} className="font-black" data-testid="open-orders-unpaid" />
            </h3>
            {/* The manager reads the pipeline in two groups, not a flat pile.
                The counter's rail is one list now (#55); this screen is unchanged. */}
            {(
              [
                ['Preparing', splitPipeline(dayOrders).preparing],
                ['Unpaid Prepared Orders', splitPipeline(dayOrders).unpaidPrepared],
              ] as const
            ).map(
              ([sectionTitle, sectionOrders]) =>
                sectionOrders.length > 0 && (
                  <section key={sectionTitle} aria-label={sectionTitle} className="space-y-2">
                    <h3 className="text-sm font-black text-content">{sectionTitle}</h3>
                    <ul className="space-y-2">
                      {sectionOrders.map((order) => {
                        const cancellingOrder = cancellingOrderId === order.id
                        return (
                          <li
                            key={order.id}
                            data-testid={`manager-open-order-${order.orderNumber}`}
                            className="rounded-xl border border-border bg-surface p-3"
                          >
                            <DishOpenOrderSummary
                              order={order}
                              marks={marks}
                              now={readAt}
                              {...(!cancellingOrder && {
                                onCancel: () => {
                                  setCancellingOrderId(order.id)
                                  setReason('')
                                },
                              })}
                            />
                            <Modal
                              open={cancellingOrder}
                              onClose={() => {
                                setCancellingOrderId(null)
                                setReason('')
                              }}
                              aria-label={`Cancel order ${order.orderNumber}`}
                              className="m-auto w-[min(92vw,26rem)] rounded-2xl p-4"
                            >
                              <h2 className="text-lg font-black text-content">
                                Cancel order {order.orderNumber}?
                              </h2>
                              <label
                                htmlFor={`cancel-order-reason-${order.id}`}
                                className="mt-4 block text-sm font-bold text-content"
                              >
                                Cancellation reason
                              </label>
                              <div
                                className="mt-3 grid grid-cols-2 gap-2"
                                role="group"
                                aria-label="Common cancellation reasons"
                              >
                                {ORDER_CANCELLATION_REASONS.map((candidate) => (
                                  <Button
                                    key={candidate}
                                    variant={reason === candidate ? 'primary' : 'secondary'}
                                    size="phone"
                                    aria-pressed={reason === candidate}
                                    onClick={() => setReason(candidate)}
                                  >
                                    {candidate}
                                  </Button>
                                ))}
                              </div>
                              <Input
                                id={`cancel-order-reason-${order.id}`}
                                aria-label={`Cancellation reason for order ${order.orderNumber}`}
                                className="mt-1"
                                placeholder="Or type a reason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                              />
                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <Button
                                  variant="secondary"
                                  size="control"
                                  onClick={() => {
                                    setCancellingOrderId(null)
                                    setReason('')
                                  }}
                                >
                                  Keep order
                                </Button>
                                <Button
                                  variant="danger"
                                  size="control"
                                  disabled={!reason.trim()}
                                  onClick={() =>
                                    void mutate(() => billing.managerCancelOrder(order.id, reason))
                                  }
                                >
                                  Cancel order
                                </Button>
                              </div>
                            </Modal>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ),
            )}
          </>
        )
      ) : null}
    </section>
  )
}
