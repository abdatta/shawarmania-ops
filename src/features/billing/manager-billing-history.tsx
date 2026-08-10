import { AlertTriangle, Ban, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
import { formatDateTime } from '@/domain'
import { useSession } from '@/session/context'

type View = 'bills' | 'orders' | 'delivery'

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
  const [selected, setSelected] = useState<BillingBill | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    if (!outletId) return
    setLoading(true)
    try {
      const [nextBills, nextOrders, nextDiagnostics] = await Promise.all([
        billing.listManagerHistory({
          outletId,
          ...(date ? { businessDate: date } : {}),
          status,
          paymentMethod: method,
        }),
        billing.listManagerOpenOrders(outletId),
        billing.listDeliveryDiagnostics(outletId),
      ])
      setBills(nextBills)
      setOrders(nextOrders)
      setDiagnostics(nextDiagnostics)
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'Could not load billing history.',
      )
    } finally {
      setLoading(false)
    }
  }, [billing, date, method, outletId, status])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation()
      setReason('')
      setMessage(success)
      setSelected(null)
      await load()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
    }
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
          Outlet records are immutable. Corrections leave the original bill visible.
        </p>
      </div>
      <div className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Input
          aria-label="Revenue business date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Select
          aria-label="Bill status"
          value={status}
          onChange={(event) => setStatus(event.target.value as BillStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="settled">Sent</option>
          <option value="void">Void</option>
        </Select>
        <Select
          aria-label="Payment method"
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod | 'all')}
        >
          <option value="all">All payments</option>
          {['cash', 'upi', 'swiggy', 'zomato'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2" role="tablist" aria-label="Billing history views">
        {(
          [
            ['bills', `Bills (${bills.length})`],
            ['orders', `Open orders (${orders.length})`],
            ['delivery', `Delivery (${diagnostics.length})`],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant={view === id ? 'primary' : 'secondary'}
            size="phone"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
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
        <LoadingRegion label="billing records" className="space-y-2">
          <Shimmer className="h-20" />
          <Shimmer className="h-20" />
        </LoadingRegion>
      ) : view === 'bills' ? (
        bills.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No bills match these filters." />
        ) : (
          <ul className="space-y-2">
            {bills.map((bill) => (
              <li key={bill.id}>
                <Button
                  variant="secondary"
                  className="h-auto w-full justify-between p-3 text-left"
                  onClick={() => setSelected(bill)}
                >
                  <span>
                    <span className="block font-bold">
                      Bill {bill.billNumber} · {bill.status === 'void' ? 'Void' : 'Sent'}
                    </span>
                    <span className="block text-xs font-normal text-content-muted">
                      Revenue date {bill.businessDate} · {bill.paymentMethod} · paid{' '}
                      {formatDateTime(bill.paidAt)}
                    </span>
                  </span>
                  <Money paise={bill.totalPaise} className="font-bold" />
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : view === 'orders' ? (
        orders.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No stranded open orders at this outlet." />
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex justify-between">
                  <div>
                    <p className="text-2xl font-black text-primary">Order {order.orderNumber}</p>
                    <p className="text-xs text-content-muted">
                      {formatDateTime(order.orderedAt)} · {order.creatorName}
                    </p>
                  </div>
                  <Money paise={order.totalPaise} display />
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    aria-label={`Reason to cancel order ${order.orderNumber}`}
                    placeholder="Why is this order being cancelled?"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
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
                    Cancel order
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : diagnostics.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No delivery problems reported." />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-content-muted">
            Read-only status. Customer details and command contents are never shown here.
          </p>
          {diagnostics.map((item) => (
            <article
              key={item.reference}
              className="rounded-xl border border-border bg-surface p-3"
            >
              <p className="font-bold text-content">
                {item.commandType.replaceAll('_', ' ')} · {item.resultCategory.replaceAll('_', ' ')}
              </p>
              <p className="text-xs text-content-muted">
                Reference {item.reference.slice(0, 8)} · received {formatDateTime(item.receivedAt)}{' '}
                · age {Math.max(1, Math.round(item.ageMs / 60000))} min
              </p>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <div
          className="rounded-xl border-2 border-primary bg-surface p-4"
          role="dialog"
          aria-label={`Bill ${selected.billNumber} detail`}
        >
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-content">Bill {selected.billNumber}</h2>
              {selected.orderNumber && (
                <p className="text-sm text-content-muted">From order {selected.orderNumber}</p>
              )}
            </div>
            <Button variant="secondary" size="phone" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <ul className="my-3 divide-y divide-border">
            {selected.lines.map((line) => (
              <li key={line.menuItemId} className="flex justify-between py-2">
                <span>
                  {line.itemName} × {line.quantity}
                </span>
                <Money paise={line.unitPricePaise * line.quantity} />
              </li>
            ))}
          </ul>
          <div className="mb-3 rounded-lg bg-surface-raised p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-content-muted">Payment</p>
            {selected.payments.map((payment) => (
              <p
                key={payment.method}
                className="mt-1 flex justify-between gap-3 text-sm font-semibold capitalize text-content"
              >
                <span>{payment.method}</span>
                <Money paise={payment.amountPaise} />
              </p>
            ))}
          </div>
          <p className="text-sm text-content-muted">
            Revenue date {selected.businessDate}; ordered {formatDateTime(selected.orderedAt)}.
          </p>
          {(selected.paymentBusinessDate !== selected.businessDate ||
            selected.paidAt !== selected.orderedAt) && (
            <p className="text-sm font-semibold text-content">
              Paid {formatDateTime(selected.paidAt)} on payment business date{' '}
              {selected.paymentBusinessDate}.
            </p>
          )}
          {selected.status === 'void' ? (
            <p className="mt-3 rounded-lg border border-danger p-3 font-semibold text-danger">
              Void: {selected.voidReason}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <Input
                aria-label="Void reason"
                placeholder="Reason for void"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="danger"
                disabled={!reason.trim()}
                onClick={() =>
                  void mutate(
                    () => billing.voidBill(selected.id, reason),
                    `Bill ${selected.billNumber} is void. Ring the corrected sale manually on the enrolled counter tablet.`,
                  )
                }
              >
                <Ban aria-hidden size={18} />
                Void bill
              </Button>
              <p className="text-sm text-content-muted">
                After voiding, ring the corrected sale manually on the enrolled counter tablet. This
                phone creates no bill or draft.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
