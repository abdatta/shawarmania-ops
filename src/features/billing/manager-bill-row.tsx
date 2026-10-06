import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillingBill, BillingBillSummary } from '@/data-access/adapters'
import { formatDayTime } from '@/domain'

/**
 * One bill as a manager's lists show it: the summary row that expands into
 * `ManagerBillDetail` beneath it.
 *
 * Shared by Billing and the Customers card (the-card-lists-every-bill), so a
 * bill reads the same wherever a manager meets it [owner, 2026-10-06] — the
 * same summary collapsed, the same detail open.
 */

export const DETAIL_TRANSITION_MS = 200

export function BillDetailTransition({ open, children }: { open: boolean; children: ReactNode }) {
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

export function methodLabel(method: BillingBill['paymentMethod']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/** The collapsed row: number, state, how and when it was paid, by whom, and the total. */
export function ManagerBillSummary({
  bill,
  expanded,
  showingDetail,
  onToggle,
}: {
  /** A whole bill, or the summary a paged list reads; the row prints only these. */
  bill: BillingBillSummary
  expanded: boolean
  /** True while the detail is open or still closing, which squares the row's foot. */
  showingDetail: boolean
  onToggle: () => void
}) {
  const stateLabel = bill.status === 'void' ? 'Cancelled' : 'Paid'
  return (
    <Button
      id={`bill-summary-${bill.id}`}
      variant="secondary"
      className={`min-h-20 w-full justify-start gap-3 p-3 text-left transition-colors ${showingDetail ? 'rounded-b-none' : ''}`}
      aria-expanded={expanded}
      aria-controls={`bill-detail-${bill.id}`}
      onClick={onToggle}
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
          {bill.recordedAfterShiftEnd && (
            <span
              data-testid={`after-departure-${bill.id}`}
              className="rounded-full border border-warning px-2 py-0.5 text-xs font-black text-warning"
            >
              After operator left
            </span>
          )}
        </span>
        <span className="mt-1 block text-sm font-normal text-content-muted">
          {methodLabel(bill.paymentMethod)} · {formatDayTime(bill.paidAt)} · by {bill.billerName}
          {/*
            And which till, where the outlet has more than one.
            The operator's name does not answer it: one person may
            hold a shift on both counters, so reconciling a
            two-till evening needs the till named.
          */}
          {bill.tillLabel && <> · on {bill.tillLabel}</>}
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
  )
}
