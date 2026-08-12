import { ChevronDown, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type BillingBill,
  type BillingDeliveryDiagnostic,
  type BillingOrder,
  type BillStatus,
  type PaymentMethod,
} from '@/data-access/adapters'
import { formatBusinessDate, formatDayTime, resolveBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

import { ManagerBillDetail } from './manager-bill-detail'
import { ManagerSyncStatus } from './manager-sync-status'

type View = 'bills' | 'orders' | 'sync'

const DETAIL_TRANSITION_MS = 200

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
 * The native input owns the platform calendar; the button gives its selection
 * a business-readable label. A blank browser field used to make `dd-mm-yyyy`
 * look unanswered while silently widening history to every available day.
 */
function HistoryBusinessDateField({
  businessDate,
  today,
  onChange,
}: {
  businessDate: string
  today: string
  onChange: (businessDate: string) => void
}) {
  const native = useRef<HTMLInputElement>(null)
  const label = businessDate === today ? 'Today' : formatBusinessDate(businessDate)

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-label={`Business date — ${formatBusinessDate(businessDate)}. Opens a calendar.`}
        data-testid="billing-history-date-open"
        onClick={() => {
          if (native.current?.showPicker) native.current.showPicker()
          else native.current?.click()
        }}
        className="h-[var(--size-control)] w-full truncate rounded-lg border border-border bg-surface px-3 text-left font-semibold text-content hover:bg-surface-raised focus-visible:focus-ring"
      >
        {label}
      </button>
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        data-testid="billing-history-date-picker"
        value={businessDate}
        max={today}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
      />
    </div>
  )
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
  const [outlets, setOutlets] = useState<Tables<'outlets'>[] | null>(null)
  const [outletId, setOutletId] = useState(session.outletId ?? '')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<BillStatus | 'all'>('all')
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all')
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
  const selectedOutlet = outlets?.find((outlet) => outlet.id === outletId) ?? null
  const today = selectedOutlet
    ? resolveBusinessDate(new Date(), selectedOutlet.business_day_cutover)
    : ''
  const businessDate = date || today

  useEffect(
    () => () => {
      closingTimers.current.forEach((timer) => window.clearTimeout(timer))
      if (anchorFrame.current !== null) window.cancelAnimationFrame(anchorFrame.current)
    },
    [],
  )

  useEffect(() => {
    void outletsAdapter
      .listOutlets()
      .then((rows) => {
        setOutlets(rows)
        if (!outletId && rows[0]) setOutletId(rows[0].id)
      })
      .catch(() => setOutlets([]))
  }, [outletId, outletsAdapter])

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!outletId || !businessDate) return
    setLoading(true)
    try {
      const [nextBills, nextOrders, nextDiagnostics] = await Promise.all([
        billing.listManagerHistory({
          outletId,
          businessDate,
          status,
          paymentMethod: method,
        }),
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
  }, [billing, businessDate, method, outletId, status])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const mutate = async (
    operation: () => Promise<unknown>,
    success: string,
    keepBillOpen = false,
  ) => {
    try {
      await operation()
      setReason('')
      setCancellingId(null)
      setCancellingOrderId(null)
      setMessage(success)
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

  if (outlets === null)
    return (
      <LoadingRegion label="billing history">
        <Shimmer className="h-48" />
      </LoadingRegion>
    )

  return (
    <section className="space-y-4" aria-labelledby="billing-history-title">
      <div>
        <h1 id="billing-history-title" className="text-2xl font-black text-content">
          Billing history
        </h1>
        <p className="text-sm text-content-muted">
          Bills stay in history. A correction cancels the original and creates a new bill at the
          counter.
        </p>
      </div>

      <div
        data-testid="billing-history-filters"
        className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 lg:grid-cols-4"
      >
        <Select
          aria-label="Outlet"
          value={outletId}
          onChange={(event) => setOutletId(event.target.value)}
        >
          {outlets.map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        </Select>
        {businessDate && (
          <HistoryBusinessDateField businessDate={businessDate} today={today} onChange={setDate} />
        )}
        <Select
          aria-label="Bill status"
          value={status}
          onChange={(event) => setStatus(event.target.value as BillStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="settled">Paid</option>
          <option value="void">Cancelled</option>
        </Select>
        <Select
          aria-label="Payment method"
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod | 'all')}
        >
          <option value="all">All payments</option>
          {(['cash', 'upi'] satisfies PaymentMethod[]).map((value) => (
            <option key={value} value={value}>
              {methodLabel(value)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing history views">
        {(
          [
            ['bills', `Bills (${bills.length})`],
            ['orders', `Open orders (${orders.length})`],
            [
              'sync',
              `Sync status${diagnostics.some((item) => !['accepted', 'replay', 'applied', 'corrected', 'discarded'].includes(item.resultCategory)) ? ' · Check' : ''}`,
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
                          void mutate(
                            () => billing.voidBill(bill.id, reason),
                            `Bill ${bill.billNumber} was cancelled. Ring the corrected sale manually on the enrolled counter tablet.`,
                            true,
                          )
                        }
                      />
                    </BillDetailTransition>
                  )}
                </li>
              )
            })}
          </ul>
        )
      ) : view === 'orders' ? (
        orders.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No stranded open orders at this outlet." />
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => {
              const cancellingOrder = cancellingOrderId === order.id
              return (
                <li key={order.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-black text-content">Order {order.orderNumber}</p>
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
                        <dt className="text-xs font-semibold text-content-muted">Customer name</dt>
                        <dd className="mt-0.5 text-sm font-semibold text-content">
                          {order.customerName || 'Not provided'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-content-muted">Customer phone</dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold text-content">
                          {order.customerPhone || 'Not provided'}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  {cancellingOrder ? (
                    <div className="mt-3 rounded-xl border border-danger bg-surface p-3">
                      <h3 className="font-black text-content">Cancel order {order.orderNumber}?</h3>
                      <p className="mt-1 text-sm text-content-muted">
                        The order leaves active work. Nothing is transferred to another tablet.
                      </p>
                      <label
                        htmlFor={`cancel-order-reason-${order.id}`}
                        className="mt-3 block text-sm font-bold text-content"
                      >
                        Why is this order being cancelled?
                      </label>
                      <Input
                        id={`cancel-order-reason-${order.id}`}
                        aria-label={`Cancellation reason for order ${order.orderNumber}`}
                        className="mt-1"
                        placeholder="For example, customer changed their mind"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setCancellingOrderId(null)
                            setReason('')
                          }}
                        >
                          Keep order
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!reason.trim()}
                          onClick={() =>
                            void mutate(
                              () => billing.managerCancelOrder(order.id, reason),
                              `Order ${order.orderNumber} was cancelled. Nothing was transferred.`,
                            )
                          }
                        >
                          Confirm cancellation
                        </Button>
                      </div>
                    </div>
                  ) : (
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
                </li>
              )
            })}
          </ul>
        )
      ) : (
        <ManagerSyncStatus diagnostics={diagnostics} />
      )}
    </section>
  )
}
