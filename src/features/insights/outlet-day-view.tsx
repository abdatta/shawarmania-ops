import { Bell, Eye, Package, TriangleAlert, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import type {
  AlertSummary,
  AttendanceRecord,
  InventoryItemSummary,
  OutletDaySummary,
} from '@/data-access/adapters'
import {
  describeDifference,
  formatBusinessDate,
  formatPaise,
  formatQuantity,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { useSession } from '@/session/context'

/**
 * One outlet's day, as the owner inspects it — **read-only, and it says so**.
 *
 * This is the outlet switcher's destination: the owner drops into a shop
 * without a parallel set of writable screens. Read-only is stated rather than
 * implied by absent buttons, because a screen that merely lacks controls tells
 * you nothing about whether you were allowed to use them (design D6). The
 * refusal behind it is the data layer's, not this component's.
 */
export function OutletDayView() {
  const session = useSession()
  const { outletId } = useParams()
  const { outlets, insights, inventory, alerts, attendance } = useAdapters()

  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [summary, setSummary] = useState<OutletDaySummary | null>(null)
  const [lowStock, setLowStock] = useState<InventoryItemSummary[]>([])
  const [openAlerts, setOpenAlerts] = useState<AlertSummary[]>([])
  const [roster, setRoster] = useState<AttendanceRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const base = session.mode === 'demo' ? '/demo/owner' : '/owner'

  useEffect(() => {
    if (!outletId) return
    let active = true

    void (async () => {
      const found = await outlets.getOutlet(outletId)
      if (!active) return
      setOutlet(found)
      if (!found) {
        setLoaded(true)
        return
      }
      const resolved = resolveBusinessDate(new Date(), found.business_day_cutover)
      setToday(resolved)
      setBusinessDate(resolved)
    })()

    return () => {
      active = false
    }
  }, [outlets, outletId])

  useEffect(() => {
    if (!outletId || !businessDate) return
    let active = true

    void (async () => {
      const [day, items, raised, day0] = await Promise.all([
        insights.outletDay(outletId, businessDate),
        inventory.listItems(outletId),
        alerts.listAlerts({ outletId }),
        attendance.listOutletDay([outletId], businessDate),
      ])
      if (!active) return
      setSummary(day)
      setLowStock(items.filter((item) => item.isLow))
      setOpenAlerts(raised.filter((alert) => alert.status === 'open'))
      setRoster(day0.filter((record) => record.checkIn !== null))
      setLoaded(true)
    })()

    return () => {
      active = false
    }
  }, [insights, inventory, alerts, attendance, outletId, businessDate])

  if (loaded && !outlet) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Outlet" backTo={base} />
        <EmptyState title="That outlet is not available. It may have been removed, or it may not be yours to see." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={outlet?.name ?? 'Outlet'}
        subtitle={outlet?.location_label}
        backTo={base}
      />

      <p
        className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-content-muted"
        data-testid="read-only-notice"
      >
        <Eye aria-hidden size={14} className="shrink-0" />
        You are looking at this outlet, not working in it. Nothing here can be changed from the
        owner’s view — the manager’s own screens are where these records are written.
      </p>

      {today && businessDate && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="outlet-day" className="text-xs font-semibold text-content-muted">
            Day
          </label>
          <Select
            id="outlet-day"
            data-testid="outlet-day"
            className="h-11 w-auto"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
          >
            {Array.from({ length: 7 }, (_, index) => shiftBusinessDate(today, -index)).map(
              (date) => (
                <option key={date} value={date}>
                  {formatBusinessDate(date)}
                </option>
              ),
            )}
          </Select>
        </div>
      )}

      {!loaded ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : summary === null ? (
        <EmptyState title="This outlet’s figures are not available yet — the console is not connected to live trading data." />
      ) : (
        <div className="space-y-3">
          <Card className="space-y-3" data-testid="outlet-day-figures">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <Money paise={summary.salesPaise} display data-testid="outlet-day-sales" />
                <p className="text-xs text-content-muted">
                  {summary.billCount === 1 ? '1 bill' : `${summary.billCount} bills`} on this day
                </p>
              </div>
              <div className="text-right">
                <Money paise={summary.expectedCashPaise} data-testid="outlet-day-cash" />
                <p className="text-xs text-content-muted">
                  {summary.dayClosed ? 'counted and closed' : 'should be in the drawer'}
                </p>
              </div>
            </div>

            {summary.salesByMethod.length > 0 ? (
              <ul className="space-y-1 border-t border-border pt-2 text-xs">
                {summary.salesByMethod.map((total) => (
                  <li key={total.method} className="flex items-baseline justify-between">
                    <span className="text-content-muted">{total.method}</span>
                    <Money paise={total.amountPaise} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-border pt-2 text-xs text-content-muted">
                Nothing was rung on this day.
              </p>
            )}

            {summary.dayClosed && summary.cashDifferencePaise !== null && (
              <p
                className="flex items-center gap-2 rounded-lg border border-warning px-2 py-1 text-xs font-semibold text-content"
                data-testid="outlet-day-difference"
                data-difference={describeDifference(summary.cashDifferencePaise)}
              >
                {summary.cashDifferencePaise !== 0 && (
                  <TriangleAlert aria-hidden size={14} className="shrink-0" />
                )}
                {summary.cashDifferencePaise === 0
                  ? 'The drawer balanced exactly.'
                  : `The drawer was ${formatPaise(Math.abs(summary.cashDifferencePaise))} ${describeDifference(summary.cashDifferencePaise)}.`}
              </p>
            )}
          </Card>

          <Card className="space-y-2" data-testid="outlet-day-stock">
            <h2 className="flex items-center gap-2 text-sm font-bold text-content">
              <Package aria-hidden size={16} />
              Low stock
            </h2>
            {lowStock.length === 0 ? (
              <p className="text-xs text-content-muted">Nothing is at its threshold.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {lowStock.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-content">{item.name}</span>
                    <span className="text-content-muted">
                      {formatQuantity(item.currentQuantity, item.unit)} — threshold{' '}
                      {formatQuantity(item.lowStockThreshold, item.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-2" data-testid="outlet-day-alerts">
            <h2 className="flex items-center gap-2 text-sm font-bold text-content">
              <Bell aria-hidden size={16} />
              Open alerts
            </h2>
            {openAlerts.length === 0 ? (
              <p className="text-xs text-content-muted">Nothing has been raised from here.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {openAlerts.map((alert) => (
                  <li key={alert.id}>
                    <Link
                      to={`${base}/alerts`}
                      className="font-semibold text-accent-text underline underline-offset-2"
                    >
                      {alert.subject}
                    </Link>{' '}
                    <span className="text-content-muted">— {alert.priority} priority</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-2" data-testid="outlet-day-attendance">
            <h2 className="flex items-center gap-2 text-sm font-bold text-content">
              <Users aria-hidden size={16} />
              Checked in
            </h2>
            {roster.length === 0 ? (
              <p className="text-xs text-content-muted">Nobody has recorded a check-in.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {roster.map((record) => (
                  <li key={record.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-content">{record.personName}</span>
                    <span className="text-content-muted">
                      {record.status === 'present' ? 'present' : 'awaiting a decision'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Link
            to={`${base}/reports`}
            className={buttonVariants({ variant: 'secondary', size: 'phone' })}
          >
            See this outlet over a period
          </Link>
        </div>
      )}
    </div>
  )
}
