import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import { DataActionError, type BillingBill, type BillingBillSummary } from '@/data-access/adapters'
import { ManagerBillDetail } from '@/features/billing/manager-bill-detail'
import {
  BillDetailTransition,
  DETAIL_TRANSITION_MS,
  ManagerBillSummary,
} from '@/features/billing/manager-bill-row'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'

/**
 * Every bill this customer paid at this outlet, at the foot of their card
 * (the-card-lists-every-bill) [owner, 2026-10-06].
 *
 * **Each bill is Billing's own row.** The same summary collapsed — number,
 * state, how and when paid, by whom, total — and the same detail open, with
 * Billing's actions, because a bill must read the same wherever a manager
 * meets it [owner, 2026-10-06].
 *
 * **Nothing is read until it is asked for, and then only what is shown**
 * [owner, 2026-10-06]: low egress, always. The card opens on its figures and
 * reads no bill; *See bills* reads ten row summaries, and ten more only as the
 * window is scrolled near its end; a bill's lines, payments and customer are
 * read when that row is first opened, once.
 *
 * **A window of its own, inside a card that fits the screen.** The list scrolls
 * inside a fixed height so the card does not jump as pages land, and that
 * height gives way first when the screen is short — the card as a whole never
 * outgrows the viewport. The next ten load as the reader nears the bottom of
 * the window, by the same sentinel the Customers lists use, observed against
 * the window rather than the page.
 */
export function CustomerBills({ outletId, customerId }: { outletId: string; customerId: string }) {
  const [open, setOpen] = useState(false)
  /**
   * Once opened, the list stays mounted and *Hide bills* only hides it, so
   * opening it again reads nothing: every page and detail already read is kept.
   */
  const [opened, setOpened] = useState(false)
  return (
    <>
      {/*
        A divider with its label in the middle, not a button [owner, 2026-10-06]:
        the bills are more of the card, opened in place, so the control reads as
        a seam in it. The whole width is the tap target.
      */}
      <button
        type="button"
        aria-expanded={open}
        data-testid="customer-card-bills-toggle"
        onClick={() => {
          setOpen((value) => !value)
          setOpened(true)
        }}
        className="group mt-2 flex h-[var(--size-control-phone)] w-full shrink-0 items-center gap-3 text-sm font-semibold text-content-muted outline-none hover:text-content"
      >
        <span aria-hidden className="h-px flex-1 bg-border" />
        {/*
          The keyboard's ring hugs the label rather than boxing the whole
          divider, which read as a stray orange frame [owner, 2026-10-06].
        */}
        <span className="flex items-center gap-1 rounded-md px-2 py-1 group-focus-visible:focus-ring">
          {open ? 'Hide bills' : 'See bills'}
          <ChevronDown
            aria-hidden
            size={16}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </button>
      {opened && <BillList outletId={outletId} customerId={customerId} hidden={!open} />}
    </>
  )
}

function BillList({
  outletId,
  customerId,
  hidden,
}: {
  outletId: string
  customerId: string
  hidden: boolean
}) {
  const { billing } = useAdapters()
  const session = useSession()
  /** Null until the first page lands. */
  const [bills, setBills] = useState<BillingBillSummary[] | null>(null)
  /**
   * Each opened bill's detail, read when its row is first opened and kept, so
   * reopening it reads nothing again. `failed` offers a retry in its place.
   */
  const [details, setDetails] = useState<ReadonlyMap<string, BillingBill | 'failed'>>(new Map())
  /** Where the next page starts; 0 before anything has been read. */
  const [next, setNext] = useState<number | null>(0)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closingIds, setClosingIds] = useState<string[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef(false)
  const closingTimers = useRef<number[]>([])
  const windowRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLLIElement>(null)

  useEffect(() => () => closingTimers.current.forEach((timer) => window.clearTimeout(timer)), [])

  const loadMore = useCallback(() => {
    if (inFlight.current || next === null) return
    inFlight.current = true
    setFailed(false)
    billing
      .listCustomerBills(outletId, customerId, next)
      .then((page) => {
        // No bill twice, should one be rung between two pages.
        setBills((current) => {
          const seen = new Set((current ?? []).map((bill) => bill.id))
          return [...(current ?? []), ...page.bills.filter((bill) => !seen.has(bill.id))]
        })
        setNext(page.next)
      })
      .catch(() => setFailed(true))
      .finally(() => {
        inFlight.current = false
      })
  }, [billing, outletId, customerId, next])

  // The first page, read when the list opens.
  useEffect(() => {
    if (bills === null && !failed) loadMore()
  }, [bills, failed, loadMore])

  // Re-armed after every page: an observer fires on a change in intersection,
  // and a sentinel already in view when a short page landed would never ask again.
  useEffect(() => {
    const node = sentinel.current
    if (!node || next === null || failed) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root: windowRef.current, rootMargin: '80px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [next, failed, loadMore, bills?.length])

  /** The detail behind a row, read once, the first time the row is opened. */
  const readDetail = (billId: string) => {
    setDetails((current) => {
      const next = new Map(current)
      next.delete(billId)
      return next
    })
    billing
      .getBill(billId)
      .then((bill) => setDetails((current) => new Map(current).set(billId, bill ?? 'failed')))
      .catch(() => setDetails((current) => new Map(current).set(billId, 'failed')))
  }

  /** One open at a time, as on Billing; the one closing keeps its detail until it has. */
  const toggle = (billId: string) => {
    const detail = details.get(billId)
    if (selectedId !== billId && (detail === undefined || detail === 'failed')) readDetail(billId)
    const closing = selectedId
    setSelectedId((current) => (current === billId ? null : billId))
    setCancellingId(null)
    setReason('')
    if (closing === null) return
    setClosingIds((current) => (current.includes(closing) ? current : [...current, closing]))
    const timer = window.setTimeout(() => {
      setClosingIds((current) => current.filter((id) => id !== closing))
      closingTimers.current = closingTimers.current.filter((id) => id !== timer)
    }, DETAIL_TRANSITION_MS)
    closingTimers.current.push(timer)
  }

  /** A bill changed by its own detail, re-read and laid over the row in place. */
  const refresh = async (billId: string, operation: () => Promise<unknown>) => {
    try {
      setMessage(null)
      await operation()
      const fresh = await billing.getBill(billId)
      if (fresh) {
        setDetails((current) => new Map(current).set(billId, fresh))
        // The row's own figures move with it: a cancelled bill says so collapsed too.
        setBills(
          (current) =>
            current?.map((bill) =>
              bill.id === billId
                ? { ...bill, status: fresh.status, voidKind: fresh.voidKind }
                : bill,
            ) ?? null,
        )
      }
      setCancellingId(null)
      setReason('')
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
      throw cause
    }
  }

  return (
    <div
      ref={windowRef}
      hidden={hidden}
      data-testid="customer-card-bills"
      aria-label="Bills here"
      role="region"
      // A fixed height, which yields before the card would outgrow the screen,
      // and a boundary of its own, so it reads as one group that scrolls inside
      // the card rather than as more of the card [owner, 2026-10-06]. No
      // scrollbar drawn: a desktop one took its width out of every row, and the
      // cut-off row at the foot already says there is more [owner, 2026-10-06].
      className="no-scrollbar h-96 min-h-32 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-2"
    >
      {message && (
        <p role="status" className="mb-2 text-sm font-semibold text-danger">
          {message}
        </p>
      )}
      {bills === null ? (
        failed ? (
          <LoadFailed message="These bills could not be loaded." onRetry={() => setFailed(false)} />
        ) : (
          <div aria-busy="true" aria-label="Loading bills" className="space-y-2">
            {[0, 1, 2].map((item) => (
              <Shimmer key={item} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )
      ) : bills.length === 0 ? (
        <p className="py-3 text-sm text-content-muted">No bills here yet.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {bills.map((bill) => {
              const expanded = bill.id === selectedId
              const showingDetail = expanded || closingIds.includes(bill.id)
              return (
                <li key={bill.id} data-testid="customer-card-bill">
                  <ManagerBillSummary
                    bill={bill}
                    expanded={expanded}
                    showingDetail={showingDetail}
                    onToggle={() => toggle(bill.id)}
                  />
                  {showingDetail && (
                    <BillDetailTransition open={expanded}>
                      <OpenedBill
                        detail={details.get(bill.id)}
                        onRetry={() => readDetail(bill.id)}
                        render={(detail) => (
                          <ManagerBillDetail
                            bill={detail}
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
                              void refresh(bill.id, () => billing.voidBill(bill.id, reason)).catch(
                                () => undefined,
                              )
                            }
                            onReviewAttribution={(outcome, resolvedOperatorId, reviewReason) =>
                              refresh(bill.id, () =>
                                billing.reviewAttribution(
                                  bill.id,
                                  outcome,
                                  resolvedOperatorId,
                                  reviewReason,
                                ),
                              )
                            }
                          />
                        )}
                      />
                    </BillDetailTransition>
                  )}
                </li>
              )
            })}
            {next !== null && !failed && (
              // The next page's shape, standing where it will land.
              <li ref={sentinel} aria-hidden data-testid="customer-card-bills-more">
                <Shimmer className="h-20 w-full rounded-xl" />
              </li>
            )}
          </ul>
          {failed && <LoadFailed message="The rest could not be loaded." onRetry={loadMore} />}
        </>
      )}
    </div>
  )
}

/**
 * An opened row's detail: Billing's own once it has been read, and until then
 * a placeholder in the detail's frame, so the row does not jump twice.
 */
function OpenedBill({
  detail,
  onRetry,
  render,
}: {
  detail: BillingBill | 'failed' | undefined
  onRetry: () => void
  render: (bill: BillingBill) => ReactNode
}) {
  if (detail !== undefined && detail !== 'failed') return render(detail)
  return (
    <div className="rounded-b-xl border border-t-0 border-border bg-surface-raised p-3">
      {detail === 'failed' ? (
        <LoadFailed message="This bill could not be loaded." onRetry={onRetry} />
      ) : (
        <div aria-busy="true" aria-label="Loading this bill" className="space-y-2">
          <Shimmer className="h-20 w-full rounded-xl" />
          <Shimmer className="h-12 w-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p role="alert" className="text-sm font-semibold text-danger">
        {message}
      </p>
      <Button variant="secondary" size="phone" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
