import { ChevronDown, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

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
  type BillingDeliveryDiagnostic,
  type BillingOrder,
} from '@/data-access/adapters'
import { formatBusinessDate, formatDayTime, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'

import { averageBillPaise, combinedTakingsPaise, paymentTotalPaise } from './day-totals'
import { ManagerBillDetail } from './manager-bill-detail'
import { countSyncProblems, ManagerSyncStatus } from './manager-sync-status'
import { PaymentTotalCards } from './payment-total-cards'
import { splitPipeline } from './pipeline'

type View = 'bills' | 'orders' | 'status'

const DETAIL_TRANSITION_MS = 200
const ORDER_CANCELLATION_REASONS = ['Duplicate order', 'Mistaken entry'] as const

function BillDetailTransition({ open, children }: { open: boolean; children: ReactNode }) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!open) {
      const frame = window.requestAnimationFrame(() => setEntered(false))
      return () => window.cancelAnimationFrame(frame)
    }

    const frame = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  return (
    <div
      data-testid="manager-bill-detail-transition"
      data-open={open}
      aria-hidden={!open || undefined}
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${entered && open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function methodLabel(method: BillingBill['paymentMethod']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/**
 * How far back the platform calendar reaches: a year before the outlet's today,
 * to the first of that month. The steps still reach further one day at a time —
 * this is a floor on the picker, which needs one, not on the history.
 */
function earliestOffered(today: string): string {
  const [year, month] = today.split('-')
  return `${Number(year) - 1}-${month}-01`
}

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
  const { billing, outlets: outletsAdapter } = useAdapters()
  const session = useSession()
  // Which outlet, asked the way every other outlet-scoped surface asks it: chips
  // in the header, remembered between surfaces, conferring nothing.
  const { outletId, selector: outletSelector } = useOutletScope()
  /**
   * The day, and the outlet it is a day of.
   *
   * Both of these are answers about one outlet — its current business date
   * through its own cutover, and a day chosen against that. Carrying the outlet
   * alongside each of them means moving to another outlet makes both stale in
   * the same instant, rather than leaving one frame in which the new outlet is
   * read under the old outlet's day. It is why neither is reset by an effect:
   * there is nothing to reset, only something that stops applying.
   */
  const [resolvedToday, setResolvedToday] = useState<{ outletId: string; day: string } | null>(null)
  const [chosenDay, setChosenDay] = useState<{ outletId: string; day: string } | null>(null)
  const [view, setView] = useState<View>('bills')
  const [bills, setBills] = useState<BillingBill[]>([])
  const [orders, setOrders] = useState<BillingOrder[]>([])
  const [diagnostics, setDiagnostics] = useState<BillingDeliveryDiagnostic[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closingIds, setClosingIds] = useState<string[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const closingTimers = useRef<number[]>([])
  const anchorFrame = useRef<number | null>(null)
  // Empty until this outlet's own today has landed, which is what holds the day
  // bar behind its silhouette and the reads behind their guard.
  const today = resolvedToday?.outletId === outletId ? resolvedToday.day : ''
  const businessDate = (chosenDay?.outletId === outletId ? chosenDay.day : '') || today
  // No outlet, no day to be a day of. The control that calls this is only
  // rendered once the outlet's today has landed, so this guard never fires in
  // practice; it is here because the type says it can.
  const setDate = (day: string) => outletId && setChosenDay({ outletId, day })
  // Paid bills only, and derived rather than read again: the list is every bill
  // of this outlet-day, so the settled ones are already in hand. Cancelled bills
  // are listed but take part in no figure.
  const paidBills = bills.filter((bill) => bill.status !== 'void')
  const methodTotals = BILLING_PAYMENT_METHODS.map((paymentMethod) => ({
    method: paymentMethod,
    totalPaise: paymentTotalPaise(paidBills, paymentMethod),
  }))
  const takingsPaise = combinedTakingsPaise(methodTotals)
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

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!outletId || !businessDate) return
    setLoading(true)
    try {
      // One read of the whole outlet-day. The status and payment-method
      // parameters stay on the adapter for the counter, and this surface passes
      // neither: every bill of the day is listed, and each says for itself
      // whether it was paid or cancelled and what it was paid with.
      const [nextBills, nextOrders, nextDiagnostics] = await Promise.all([
        billing.listManagerHistory({ outletId, businessDate, status: 'all', paymentMethod: 'all' }),
        billing.listManagerOpenOrders(outletId),
        billing.listDeliveryDiagnostics(outletId),
      ])
      setBills(nextBills)
      setOrders(nextOrders)
      setDiagnostics(nextDiagnostics)
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

  const mutate = async (operation: () => Promise<unknown>, keepBillOpen = false) => {
    try {
      setMessage(null)
      await operation()
      setReason('')
      setCancellingId(null)
      setCancellingOrderId(null)
      if (!keepBillOpen) setSelectedId(null)
      await load()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
    }
  }

  const chooseView = (next: View) => {
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
      const currentIndex = selectedId ? bills.findIndex((bill) => bill.id === selectedId) : -1
      const nextIndex = bills.findIndex((bill) => bill.id === billId)
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing history views">
        {(
          [
            ['bills', `Bills (${bills.length})`],
            // The count is the whole board — both bands — under the plain name
            // this page has always used; the band names live in the sections.
            ['orders', `Open orders (${orders.length})`],
            ['status', syncProblemCount > 0 ? `Status (${syncProblemCount})` : 'Status'],
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
        bills.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No bills match these filters." />
        ) : (
          <ul className="space-y-2" data-testid="manager-bill-list">
            {bills.map((bill) => {
              const expanded = bill.id === selectedId
              const showingDetail = expanded || closingIds.includes(bill.id)
              const stateLabel = bill.status === 'void' ? 'Cancelled' : 'Paid'
              return (
                <li key={bill.id} data-testid={`manager-bill-${bill.id}`}>
                  <Button
                    id={`bill-summary-${bill.id}`}
                    variant="secondary"
                    className={`min-h-20 w-full justify-start gap-3 p-3 text-left transition-colors ${showingDetail ? 'rounded-b-none' : ''}`}
                    aria-expanded={expanded}
                    aria-controls={`bill-detail-${bill.id}`}
                    onClick={() => selectBill(bill.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-content">Bill {bill.billNumber}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-bold ${bill.status === 'void' ? 'border-danger text-danger' : 'border-success text-success'}`}
                        >
                          {stateLabel}
                        </span>
                        {/* The stored kind, displayed — never inferred from
                            timestamps or reasons (design D4). */}
                        {bill.status === 'void' && bill.voidKind === 'cancelled_after_paid' && (
                          <span
                            data-testid={`cancelled-after-paid-${bill.id}`}
                            className="rounded-full border border-danger px-2 py-0.5 text-xs font-black text-danger"
                          >
                            Cancelled after paid
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-sm font-normal text-content-muted">
                        {methodLabel(bill.paymentMethod)} · {formatDayTime(bill.paidAt)} · by{' '}
                        {bill.billerName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Money paise={bill.totalPaise} className="font-black text-content" />
                      <ChevronDown
                        aria-hidden
                        size={18}
                        className={`text-content-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </Button>
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
                      />
                    </BillDetailTransition>
                  )}
                </li>
              )
            })}
          </ul>
        )
      ) : view === 'status' ? (
        <div className="space-y-6">
          <section aria-labelledby="billing-payment-totals-title">
            <h2 id="billing-payment-totals-title" className="text-lg font-black text-content">
              Payment totals
            </h2>
            <p className="mt-1 text-sm text-content-muted">
              Paid bills for this outlet{' '}
              {businessDate === today ? 'today' : `on ${formatBusinessDate(businessDate)}`}.
            </p>
            <div className="mt-3">
              <PaymentTotalCards
                totals={methodTotals}
                testIdPrefix="billing-total"
                // The two questions the tender split stops one short of: what
                // the day took altogether, and what an average bill came to.
                further={[
                  { label: 'Total', paise: takingsPaise, testId: 'billing-total-combined' },
                  {
                    label: 'Average bill',
                    paise: averageBillPaise(takingsPaise, paidBills.length),
                    testId: 'billing-total-average',
                  },
                ]}
              />
            </div>
          </section>
          <ManagerSyncStatus diagnostics={diagnostics} />
        </div>
      ) : view === 'orders' ? (
        orders.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No open orders at this outlet." />
        ) : (
          // The same two sections the counter rail derives, derived the same
          // way — the manager reads the pipeline, not a flat pile.
          (
            [
              ['Preparing', splitPipeline(orders).preparing],
              ['Unpaid Prepared Orders', splitPipeline(orders).unpaidPrepared],
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
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xl font-black text-content">
                                Order {order.orderNumber}
                              </p>
                              <p className="mt-1 text-xs text-content-muted">
                                {formatDayTime(order.orderedAt)} · created by {order.creatorName}
                              </p>
                            </div>
                            <Money paise={order.totalPaise} display className="shrink-0" />
                          </div>

                          <section className="mt-3 rounded-xl border border-border bg-surface p-3">
                            <h3 className="text-sm font-black text-content">Order items</h3>
                            <ul className="mt-2 divide-y divide-border">
                              {order.lines.map((line, index) => (
                                <li
                                  key={`${line.menuItemId}-${index}`}
                                  className="grid grid-cols-[1fr_auto] gap-x-3 py-2 first:pt-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <p className="font-semibold leading-tight text-content">
                                      {line.itemName}
                                    </p>
                                    <p className="mt-1 text-xs text-content-muted">
                                      {line.quantity} × <Money paise={line.unitPricePaise} /> each
                                    </p>
                                  </div>
                                  <Money
                                    paise={line.unitPricePaise * line.quantity}
                                    className="self-center font-bold"
                                  />
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section className="mt-3 rounded-xl border border-border bg-surface p-3">
                            <h3 className="text-sm font-black text-content">Customer details</h3>
                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                              <div>
                                <dt className="text-xs font-semibold text-content-muted">
                                  Customer name
                                </dt>
                                <dd className="mt-0.5 text-sm font-semibold text-content">
                                  {order.customerName || 'Not provided'}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold text-content-muted">
                                  Customer phone
                                </dt>
                                <dd className="mt-0.5 break-words text-sm font-semibold text-content">
                                  {order.customerPhone || 'Not provided'}
                                </dd>
                              </div>
                            </dl>
                          </section>

                          {!cancellingOrder && (
                            <div className="mt-3 border-t border-border pt-3">
                              <Button
                                variant="secondary"
                                className="text-danger"
                                onClick={() => {
                                  setCancellingOrderId(order.id)
                                  setReason('')
                                }}
                              >
                                Cancel this order
                              </Button>
                            </div>
                          )}
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
          )
        )
      ) : null}
    </section>
  )
}
