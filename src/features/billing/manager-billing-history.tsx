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
  MANAGER_BILL_ROWS_PAGE_SIZE,
  type BillingBill,
  type BillingBillRow,
  type BillingAttributionOutcome,
  type BillingDayNumbers,
  type BillingOrder,
  type CounterBiller,
  type KitchenMarks,
} from '@/data-access/adapters'
import { carryPeriod, earliestOffered, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'

import {
  billFilterSummary,
  DEFAULT_BILL_FILTER,
  isDefaultBillFilter,
  type BillFilter,
} from './bill-filter'
import { BillFilterSheet } from './bill-filter-sheet'
import { averageBillPaise, combinedTakingsPaise } from './day-totals'
import { ManagerBillDetail } from './manager-bill-detail'
import { BillDetailTransition, DETAIL_TRANSITION_MS, ManagerBillSummary } from './manager-bill-row'
import { DishOpenOrderSummary } from './dish-open-order-summary'
import { ManagerDayStats, ManagerDayStatsShimmer } from './manager-day-stats'
import { ManagerSyncStatus } from './manager-sync-status'
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

/**
 * How long the page may have been away before coming back reads it again: the
 * delivery badges' rule (the-app-asks-the-server-less), kept here so the two
 * agree (billing-history-reads-what-it-shows, design D6).
 */
const RETURN_REREAD_MS = 2 * 60_000

const ORDER_CANCELLATION_REASONS = ['Duplicate order', 'Mistaken entry'] as const

/** An opened bill's detail on its way: its first read, and only its first. */
function BillDetailShimmer() {
  return (
    <LoadingRegion label="the bill" className="space-y-2 pt-2">
      <Shimmer className="h-24 w-full rounded-xl" />
      <Shimmer className="h-16 w-full rounded-xl" />
    </LoadingRegion>
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
  const { billing, outlets: outletsAdapter, kitchen } = useAdapters()
  const session = useSession()
  /*
    An open order says what the counter's card says (each-dish-is-ticked-off,
    design R11), and the Orders tab reads for itself: the orders and their
    kitchens' answers are read each time the tab is chosen — so switching to it
    is how the owner sees the latest — never on a timer and never live.
  */
  const [marks, setMarks] = useState<KitchenMarks | null>(null)
  const [readAt, setReadAt] = useState(() => new Date())
  /** The outlet-day the listed open orders are of; another means not read yet. */
  const [ordersKey, setOrdersKey] = useState<string | null>(null)
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
  /**
   * The rows read so far, the read they answer, and how many the filter keeps
   * across every page (billing-history-reads-what-it-shows, design D1). A key
   * other than the page's current one means the first page is still on its way.
   */
  const [list, setList] = useState<{
    key: string
    rows: BillingBillRow[]
    matching: number
  } | null>(null)
  const [moreLoading, setMoreLoading] = useState(false)
  /** The day in numbers and the outlet-day it is of (design D2). */
  const [day, setDay] = useState<{ key: string; value: BillingDayNumbers } | null>(null)
  /**
   * Each opened bill's whole detail, read once and kept until the page is left
   * (design D3) — collapsing it, opening another and coming back reads nothing.
   * Never stored.
   */
  const [details, setDetails] = useState<ReadonlyMap<string, BillingBill | 'failed'>>(
    () => new Map(),
  )
  const [orders, setOrders] = useState<BillingOrder[]>([])
  const [billers, setBillers] = useState<CounterBiller[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closingIds, setClosingIds] = useState<string[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  /*
    The Bills tab's sort and filter (billing-day-at-a-glance, design D4). Kept
    while the day or outlet changes — the reader is asking the same question of
    another day — and gone when they leave the page. Never stored. The server
    applies it; a change reads the list again from its first page.
  */
  const [filter, setFilter] = useState<BillFilter>(DEFAULT_BILL_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const closingTimers = useRef<number[]>([])
  const anchorFrame = useRef<number | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)
  /** Which list and day reads are the latest: an older one landing late is dropped. */
  const listRead = useRef(0)
  const dayRead = useRef(0)
  /** When the page last read its day and rows, for the two-minute return rule. */
  const lastRead = useRef(0)
  // Empty until this outlet's own today has landed, which is what holds the day
  // bar behind its silhouette and the reads behind their guard.
  const today = resolvedToday?.outletId === outletId ? resolvedToday.day : ''
  const businessDate = today && carryPeriod(chosenDay?.day ?? null, chosenDay?.today ?? null, today)
  // The control that calls this is only rendered once the outlet's today has
  // landed, so the day is always chosen against a real today.
  const setDate = (next: string) => setChosenDay({ day: next, today })
  const dayKey = `${outletId}|${businessDate}`
  const listKey = `${dayKey}|${JSON.stringify(filter)}`
  const dayNumbers = day?.key === dayKey ? day.value : null
  const rows = list?.key === listKey ? list.rows : null
  const matching = list?.key === listKey ? list.matching : 0
  // The day's figures, from the shared revenue definition rather than a sum of
  // the rows in hand (design D2): the list is only ever a page of the day.
  const methodTotals = BILLING_PAYMENT_METHODS.map((paymentMethod) => ({
    method: paymentMethod,
    totalPaise:
      paymentMethod === 'cash' ? (dayNumbers?.cashPaise ?? 0) : (dayNumbers?.upiPaise ?? 0),
  }))
  const takingsPaise = combinedTakingsPaise(methodTotals)
  const filtering = !isDefaultBillFilter(filter)
  // Open orders are read for the day bar's day (design D5), so the list is the day's.
  const dayOrders = ordersKey === dayKey ? orders : []
  const unpaidPaise = dayOrders
    .filter((order) => order.status === 'open')
    .reduce((sum, order) => sum + order.totalPaise, 0)
  // The refusals behind the Stats tab, named on the tab itself. Its two
  // neighbours already carry their counts, so a tab that says nothing reads as a
  // tab with nothing in it — which is how the first production refusal went
  // unread. The same list the chip shows, and shown only when it is non-zero.
  const syncProblemCount = dayNumbers?.refusals.length ?? 0

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

  // The Orders tab's own read: the day's orders and their kitchens' answers,
  // asked for together (design D5).
  const loadOrders = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!outletId || !businessDate) return
      try {
        const [nextOrders, nextMarks] = await Promise.all([
          billing.listManagerOpenOrders(outletId, businessDate),
          // The orders still list if the kitchens cannot be read.
          kitchen.readManagerDishMarks(outletId).catch(() => null),
        ])
        if (!isCurrent()) return
        setOrders(nextOrders)
        setMarks(nextMarks)
        setReadAt(new Date())
        setOrdersKey(`${outletId}|${businessDate}`)
      } catch (cause) {
        if (!isCurrent()) return
        setMessage(cause instanceof DataActionError ? cause.message : 'Could not load open orders.')
      }
    },
    [billing, kitchen, outletId, businessDate],
  )

  /** The day in numbers: on opening, on a new day, and quietly after a change. */
  const loadDay = useCallback(async () => {
    if (!outletId || !businessDate) return
    const key = `${outletId}|${businessDate}`
    const read = ++dayRead.current
    try {
      const value = await billing.readDayNumbers(outletId, businessDate)
      if (read !== dayRead.current) return
      setDay({ key, value })
      lastRead.current = Date.now()
    } catch (cause) {
      if (read !== dayRead.current) return
      setMessage(
        cause instanceof DataActionError ? cause.message : 'Could not load the day’s figures.',
      )
    }
  }, [billing, businessDate, outletId])

  /**
   * The list from its first page, or — `count` — as many rows as are already
   * shown, quietly, read a hundred at a time (design D6).
   */
  const loadRows = useCallback(
    async (count = MANAGER_BILL_ROWS_PAGE_SIZE) => {
      if (!outletId || !businessDate) return
      const key = `${outletId}|${businessDate}|${JSON.stringify(filter)}`
      const read = ++listRead.current
      try {
        let page = await billing.listManagerBillRows(outletId, businessDate, filter, {
          limit: Math.min(count, 100),
        })
        let next = page.rows
        while (next.length < count && page.rows.length === 100 && next.length < page.matching) {
          page = await billing.listManagerBillRows(outletId, businessDate, filter, {
            after: next.at(-1)!.cursor,
            limit: Math.min(count - next.length, 100),
          })
          next = [...next, ...page.rows]
        }
        if (read !== listRead.current) return
        setList({ key, rows: next, matching: page.matching })
        setSelectedId((current) =>
          current && next.some((row) => row.id === current) ? current : null,
        )
        lastRead.current = Date.now()
      } catch (cause) {
        if (read !== listRead.current) return
        setMessage(
          cause instanceof DataActionError ? cause.message : 'Could not load billing history.',
        )
      }
    },
    [billing, businessDate, filter, outletId],
  )

  /** The next page, when the reader nears the end of what is shown (design D7). */
  const loadMore = useCallback(async () => {
    if (!outletId || !businessDate || !rows || moreLoading || rows.length >= matching) return
    const key = listKey
    const read = listRead.current
    setMoreLoading(true)
    try {
      const page = await billing.listManagerBillRows(outletId, businessDate, filter, {
        after: rows.at(-1)!.cursor,
      })
      if (read !== listRead.current) return
      setList((current) =>
        current?.key === key
          ? { key, rows: [...current.rows, ...page.rows], matching: page.matching }
          : current,
      )
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'Could not load billing history.',
      )
    } finally {
      setMoreLoading(false)
    }
  }, [billing, businessDate, filter, listKey, matching, moreLoading, outletId, rows])

  // A new outlet or day reads the day in numbers; the rows follow the filter
  // too, so a filter change reads them and nothing else.
  useEffect(() => {
    void Promise.resolve().then(loadDay)
  }, [loadDay])

  useEffect(() => {
    void Promise.resolve().then(() => loadRows())
  }, [loadRows])

  useEffect(() => {
    if (!outletId) return
    let active = true
    billing
      .listBillers(outletId)
      .then((next) => {
        if (active) setBillers(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [billing, outletId])

  // Choosing the Orders tab reads it afresh, and so does a new outlet or day
  // while it is open. A read for an outlet or day no longer shown is dropped.
  useEffect(() => {
    if (view !== 'orders') return
    let current = true
    void Promise.resolve().then(() => loadOrders(() => current))
    return () => {
      current = false
    }
  }, [view, loadOrders])

  // The next page is asked for while about ten rows are still below the
  // screen, so a steady scroll does not meet the end (design D7).
  useEffect(() => {
    const node = sentinel.current
    if (!node || !rows || rows.length >= matching) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '0px 0px 800px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, matching, rows])

  // Coming back after more than two minutes away reads the day and the rows
  // already shown again, quietly, as the delivery badges do (design D6).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (lastRead.current === 0 || Date.now() - lastRead.current <= RETURN_REREAD_MS) return
      void loadDay()
      void loadRows(Math.max(rows?.length ?? 0, MANAGER_BILL_ROWS_PAGE_SIZE))
      if (view === 'orders') void loadOrders()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadDay, loadOrders, loadRows, rows, view])

  /** A bill as it now is, laid over its row and its detail in place (design D4). */
  const patchBill = (bill: BillingBill) => {
    setDetails((current) => new Map(current).set(bill.id, bill))
    setList((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === bill.id
                ? {
                    ...row,
                    status: bill.status,
                    voidKind: bill.voidKind,
                    paymentMethod: bill.paymentMethod,
                    payments: bill.payments,
                    paymentRevision: bill.paymentRevision,
                  }
                : row,
            ),
          }
        : current,
    )
  }

  const cancelBill = async (billId: string) => {
    try {
      setMessage(null)
      patchBill(await billing.voidBill(billId, reason))
      setReason('')
      setCancellingId(null)
      // The strip, AOV and Stats moved; the list did not.
      void loadDay()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
    }
  }

  const cancelOrder = async (orderId: string) => {
    try {
      setMessage(null)
      await billing.managerCancelOrder(orderId, reason)
      setReason('')
      setCancellingOrderId(null)
      // A paid order still cooking becomes a bill cancelled after payment, so
      // the Bills rows and the figures are read again too, quietly.
      await loadOrders()
      void loadDay()
      void loadRows(Math.max(rows?.length ?? 0, MANAGER_BILL_ROWS_PAGE_SIZE))
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
      const review = await billing.reviewAttribution(
        billId,
        outcome,
        resolvedOperatorId,
        reviewReason,
      )
      const bill = details.get(billId)
      if (bill && bill !== 'failed') patchBill({ ...bill, attributionReview: review })
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That review could not be recorded.',
      )
      throw cause
    }
  }

  /** The detail behind a row, read the first time it is opened (design D3). */
  const readDetail = (row: BillingBillRow) => {
    setDetails((current) => {
      const next = new Map(current)
      next.delete(row.id)
      return next
    })
    billing
      .readManagerBillDetail(row)
      .then((bill) => setDetails((current) => new Map(current).set(row.id, bill ?? 'failed')))
      .catch(() => setDetails((current) => new Map(current).set(row.id, 'failed')))
  }

  const chooseView = (next: View) => {
    // Choosing another tab reads it in the effect above; the one already open,
    // tapped again, is read again here. Stats reads nothing: its figures came
    // with the day's (design D2).
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
      const shown = rows ?? []
      const currentIndex = selectedId ? shown.findIndex((row) => row.id === selectedId) : -1
      const nextIndex = shown.findIndex((row) => row.id === billId)
      const row = shown[nextIndex]
      const detail = details.get(billId)
      if (row && (detail === undefined || detail === 'failed')) readDetail(row)
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
        address changed. They come from the day's own read, by the revenue
        definition Overview and the Ledger use, never from the rows in hand,
        which are only ever a page of the day (billing-history-reads-what-it-shows). Four across rather than two by two because a wrapped
        row makes the reader work out which card belongs to which line, and
        because a strip this size can sit above the tabs without pushing the
        list off a phone.

        Held behind their shimmer until the day's read has landed: and rendering the
        cards a moment early would show a real ₹0 that is about to change. The
        silhouette is the strip's own height, so the tabs do not move under a
        finger already on its way to them.
      */}
      {dayNumbers === null ? (
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
                paise: averageBillPaise(takingsPaise, dayNumbers.settledBills),
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
              dayNumbers === null
                ? 'Bills (…)'
                : filtering && rows !== null && matching !== dayNumbers.bills
                  ? `Bills (${matching}/${dayNumbers.bills})`
                  : `Bills (${dayNumbers.bills})`,
            ],
            // The count is the whole board — both bands — under the plain name
            // this page has always used; the band names live in the sections.
            // It is the chosen day's, as the list is.
            [
              'orders',
              `Open orders (${
                view === 'orders' && ordersKey === dayKey
                  ? dayOrders.length
                  : (dayNumbers?.openOrders ?? '…')
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

      {view === 'bills' ? (
        <div className="space-y-2">
          {(dayNumbers?.bills ?? 0) > 0 && (
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
              tablets={dayNumbers?.tablets ?? []}
              onChange={setFilter}
              onClose={() => setFilterOpen(false)}
            />
          )}
          {/* The first page, and every filter change, read the list afresh
              behind its shimmer; the owner accepted the moment it takes. */}
          {rows === null ? (
            <BillingHistoryShimmer />
          ) : rows.length === 0 && !filtering ? (
            <EmptyState icon={ReceiptText} title="No bills on this day." />
          ) : rows.length === 0 ? (
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
            <>
              <ul className="space-y-2" data-testid="manager-bill-list">
                {rows.map((row) => {
                  const expanded = row.id === selectedId
                  const showingDetail = expanded || closingIds.includes(row.id)
                  const detail = details.get(row.id)
                  return (
                    <li key={row.id} data-testid={`manager-bill-${row.id}`}>
                      <ManagerBillSummary
                        bill={row}
                        expanded={expanded}
                        showingDetail={showingDetail}
                        onToggle={() => selectBill(row.id)}
                      />
                      {showingDetail && (
                        <BillDetailTransition open={expanded}>
                          {detail === undefined ? (
                            <BillDetailShimmer />
                          ) : detail === 'failed' ? (
                            <p
                              role="status"
                              className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
                            >
                              Could not load this bill. Close it and open it again to retry.
                            </p>
                          ) : (
                            <ManagerBillDetail
                              bill={detail}
                              currentUserId={session.userId}
                              cancelling={cancellingId === row.id}
                              reason={reason}
                              onReasonChange={setReason}
                              onStartCancelling={() => {
                                setCancellingId(row.id)
                                setReason('')
                              }}
                              onKeepBill={() => {
                                setCancellingId(null)
                                setReason('')
                              }}
                              onConfirmCancellation={() => void cancelBill(row.id)}
                              eligibleBillers={billers}
                              onReviewAttribution={(outcome, resolvedOperatorId, reviewReason) =>
                                reviewAttribution(row.id, outcome, resolvedOperatorId, reviewReason)
                              }
                            />
                          )}
                        </BillDetailTransition>
                      )}
                    </li>
                  )
                })}
              </ul>
              {rows.length < matching && (
                <div ref={sentinel} data-testid="manager-bill-list-more">
                  {moreLoading && (
                    <LoadingRegion label="more bills">
                      <Shimmer className="h-20 w-full rounded-xl" />
                    </LoadingRegion>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : view === 'stats' ? (
        // The tablets' sync — its age speaks for now, its problems are the chosen
        // day's — then the chosen day's figures, all from the day's one read
        // (billing-history-reads-what-it-shows, design D2), so choosing the tab
        // reads nothing.
        dayNumbers === null ? (
          <ManagerDayStatsShimmer />
        ) : (
          <div className="space-y-3">
            <ManagerSyncStatus
              problems={dayNumbers.refusals}
              newestAt={dayNumbers.newestCommandAt}
            />
            <ManagerDayStats stats={dayNumbers.stats} />
          </div>
        )
      ) : view === 'orders' ? (
        ordersKey !== dayKey ? (
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
                                  onClick={() => void cancelOrder(order.id)}
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
