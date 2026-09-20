import { KeyRound } from 'lucide-react'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { buttonVariants } from '@/components/ui/button-variants'
import { Button } from '@/components/ui/button'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type BillDiscountDraft,
  type BillDiscountRule,
  type DiscountPreset,
  type BillLineDraft,
  type BillingOrder,
  type MenuCategoryWithItems,
  type MenuDiscount,
  type PaymentAllocation,
} from '@/data-access/adapters'
import {
  billTotals,
  discountAmountPaise,
  isAwaitingOrderNumber,
  UNSENT_ORDER_REFERENCE,
  lineTotalPaise,
  menuLineDiscount,
  resolveBusinessDate,
  type MenuDiscountRule,
} from '@/domain'
import { useOnForeground } from '@/features/attention/attention'
import { newUuid } from '@/lib/uuid'
import { declareUnsavedWork } from '@/pwa/occupancy'
import { SessionContext } from '@/session/context'
import { CounterDeviceContext } from '@/session/counter-context'
import { normalizeIndianPhone } from '../../../shared/phone'

import { BillComposerFooter, CustomerRow } from './bill-composer-footer'
import { BillDiscountRows } from './bill-discount-rows'
import { CustomerDialog, type CustomerSelection } from './customer-dialog'
import { DiscountDialog } from './discount-dialog'
import { OfflineFillHint } from './offline-fill-hint'
import { BillPanel } from './bill-panel'
import { CounterActivityRail } from './counter-activity-rail'
import { EditingOrderPin } from './editing-order-pin'
import { MenuGrid } from './menu-grid'
import { MyShiftSurface } from './my-shift-surface'
import { PaymentDialog } from './payment-dialog'
import { useCounterState } from './use-counter-state'

/**
 * The billing counter — the screen this whole product is for.
 *
 * Three columns, always, none of which scrolls the page: the whole menu at left,
 * the current bill in the middle, and one continuous Open orders + Bills this
 * shift rail at right. Each column scrolls its own content. **Nothing rearranges
 * on a narrow screen** — the workspace scrolls sideways instead, because the
 * three columns are the counter, and a biller who loses one of them to a tab has
 * to go looking for the order they were about to take money for.
 *
 * Food-first is the default. **Order** saves the preparation so the kitchen can
 * start, and the money is taken on handover, from the rail. **Paid** is the
 * secondary path for the rarer upfront payment; neither settles on the spot —
 * tender is captured in a tap-first dialog.
 *
 * **A direct payment waits only for durable local acceptance.** The panel clears
 * after IndexedDB commits, never after a network response, and no confirmation
 * bar is inserted — the panel giving way to Bills this shift, with the new bill
 * queued in it, is the signal. The next customer never waits for delivery.
 * Tender corrections remain available with the bill in Bills this shift for
 * five minutes.
 *
 * Editing a saved order borrows this same composer: the order goes onto the
 * panel, any draft already in progress is suspended and restored afterwards, and
 * both the panel and the rail take the accent outline with the order pinned
 * beside the panel, so the mode and its subject are never in doubt.
 */

interface Restorable {
  lines: BillLineDraft[]
  /**
   * The bill-level discounts on the panel.
   *
   * Part of what a draft **is**: suspending a composed bill to edit an order,
   * or reopening an order, has to give back what was on the panel. Leaving them
   * out silently dropped every discount on both journeys.
   */
  discounts: readonly BillDiscountDraft[]
  customer: CustomerSelection | null
  payments: PaymentAllocation[]
}

/**
 * The two snapshot columns a decision comes to.
 *
 * The phone is what identifies somebody, so a skip carries no number and an
 * identified customer carries both. The `customer_id` is not here: the server
 * resolves it from the phone when the command is recorded, because a till
 * cannot know the id of a number it has never seen.
 */
function customerSnapshots(customer: CustomerSelection | null): {
  customerName: string
  customerPhone: string
} {
  if (customer === null) return { customerName: '', customerPhone: '' }
  if (customer.kind === 'skipped') return { customerName: customer.name, customerPhone: '' }
  return { customerName: customer.name, customerPhone: customer.phone }
}

/**
 * What a saved order's snapshots say the biller decided when they rang it.
 *
 * A canonical phone is an identification; anything else is a skip carrying
 * whatever name the order has — including none. Reopening one must not demand a
 * decision that was not asked for at the time.
 */
function customerFromOrder(order: BillingOrder): CustomerSelection {
  const phone = normalizeIndianPhone(order.customerPhone)
  if (phone !== null) return { kind: 'identified', phone, name: order.customerName ?? '' }
  return { kind: 'skipped', name: order.customerName ?? '' }
}

const COUNTER_COLUMN_RESIZE_STEP = 16
const COUNTER_COLUMN_WIDTHS_KEY = 'shawarmania.counter-column-widths'
// `gap-3` sits between each pair of the three workspace tracks.
const COUNTER_WORKSPACE_GAPS_WIDTH = 24

type CounterColumn = 'bill' | 'activity'

interface CounterColumnWidths {
  bill: number
  activity: number
}

function counterColumnMinWidth(): number {
  const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return 22 * (Number.isFinite(rootFontSize) ? rootFontSize : 16)
}

function isCounterColumnWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= counterColumnMinWidth()
}

function readCounterColumnWidths(): CounterColumnWidths {
  const fallback = { bill: counterColumnMinWidth(), activity: counterColumnMinWidth() }
  try {
    const stored = window.localStorage.getItem(COUNTER_COLUMN_WIDTHS_KEY)
    if (!stored) return fallback
    const widths: unknown = JSON.parse(stored)
    if (
      typeof widths !== 'object' ||
      widths === null ||
      !isCounterColumnWidth((widths as CounterColumnWidths).bill) ||
      !isCounterColumnWidth((widths as CounterColumnWidths).activity)
    ) {
      return fallback
    }
    const validWidths = widths as CounterColumnWidths
    return { bill: validWidths.bill, activity: validWidths.activity }
  } catch {
    return fallback
  }
}

export function BillingCounter({ outletId: counterOutletId }: { outletId?: string } = {}) {
  const session = useContext(SessionContext)
  const counterDevice = useContext(CounterDeviceContext)
  const resume = counterDevice?.offlineResume
  const { billing, counter, customers, menu: menuAdapter, outlets } = useAdapters()
  const { shift } = useCounterState()

  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [menuDiscounts, setMenuDiscounts] = useState<MenuDiscount[]>([])
  const [discountPresets, setDiscountPresets] = useState<DiscountPreset[]>([])
  const [billDiscountRules, setBillDiscountRules] = useState<BillDiscountRule[]>([])
  const [discountDialog, setDiscountDialog] = useState<{ editingIndex: number | null } | null>(null)
  const [menuOffline, setMenuOffline] = useState(false)
  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [lines, setLines] = useState<BillLineDraft[]>([])
  const [customer, setCustomer] = useState<CustomerSelection | null>(null)
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentPreset, setPaymentPreset] = useState<PaymentAllocation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  // A command reloads the surface that performed it itself. These two signals
  // refresh only the *other* column, preventing a pipeline action from loading
  // the rail twice and replaying its FLIP motion.
  const [billRefresh, setBillRefresh] = useState(0)
  const [pipelineRefresh, setPipelineRefresh] = useState(0)
  /*
    Distinct from `pipelineRefresh`, which every reload bumps. The rail returns
    to its newest end only when an order is taken **here**: a neighbouring
    till's order arriving must not move the list under the biller's thumb.
  */
  const [savedOrderKey, setSavedOrderKey] = useState(0)
  const [editingOrder, setEditingOrder] = useState<BillingOrder | null>(null)
  const [columnWidths, setColumnWidths] = useState<CounterColumnWidths>(readCounterColumnWidths)

  const outletId = counterOutletId ?? session?.outletId ?? null
  const suspendedDraft = useRef<Restorable | null>(null)
  const hasMenu = useRef(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const resize = useRef<{ column: CounterColumn; startX: number; startWidth: number } | null>(null)

  const resizeColumn = useCallback((column: CounterColumn, requestedWidth: number) => {
    setColumnWidths((current) => {
      const minimumWidth = counterColumnMinWidth()
      const otherColumn = column === 'bill' ? 'activity' : 'bill'
      const workspaceWidth = workspaceRef.current?.clientWidth ?? 0
      // Once the menu has spent all of its flexible width, a wider resizable
      // track would only create new horizontal overflow. On genuinely narrow
      // viewports the three minimum tracks intentionally scroll sideways.
      const maximumWidth =
        workspaceWidth > 0
          ? Math.max(
              minimumWidth,
              workspaceWidth - minimumWidth - current[otherColumn] - COUNTER_WORKSPACE_GAPS_WIDTH,
            )
          : Number.POSITIVE_INFINITY
      const width = Math.min(maximumWidth, Math.max(minimumWidth, Math.round(requestedWidth)))
      const next = { ...current, [column]: width }
      try {
        window.localStorage.setItem(COUNTER_COLUMN_WIDTHS_KEY, JSON.stringify(next))
      } catch {
        // A counter must remain usable when its browser disallows local storage.
      }
      return next
    })
  }, [])

  function beginColumnResize(column: CounterColumn, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    resize.current = { column, startX: event.clientX, startWidth: columnWidths[column] }
  }

  function moveColumnResize(event: PointerEvent<HTMLDivElement>) {
    if (!resize.current || resize.current.column !== event.currentTarget.dataset.column) return
    resizeColumn(
      resize.current.column,
      resize.current.startWidth - (event.clientX - resize.current.startX),
    )
  }

  function endColumnResize(event: PointerEvent<HTMLDivElement>) {
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      typeof event.currentTarget.releasePointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resize.current = null
  }

  function resizeColumnWithKeyboard(column: CounterColumn, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    resizeColumn(
      column,
      columnWidths[column] +
        (event.key === 'ArrowLeft' ? COUNTER_COLUMN_RESIZE_STEP : -COUNTER_COLUMN_RESIZE_STEP),
    )
  }

  const refreshMenu = useCallback(async () => {
    if (!outletId) return
    try {
      const loaded = await menuAdapter.readOutletMenu(outletId)
      hasMenu.current = true
      setMenu(loaded.categories)
      setMenuDiscounts(loaded.discounts)
      setDiscountPresets(loaded.presets)
      setMenuOffline(Boolean(resume))
      setError((current) =>
        current === 'Could not load the menu. Try again in a moment.' ? null : current,
      )
    } catch {
      if (hasMenu.current) {
        // A live shift may carry on from the last menu this screen fetched. A
        // reload has no such snapshot and therefore opens no billing work.
        setMenuOffline(true)
      } else {
        setError('Could not load the menu. Try again in a moment.')
      }
    }
  }, [menuAdapter, outletId, resume])

  const refreshVisibleData = useCallback(() => {
    void Promise.resolve().then(refreshMenu)
    setBillRefresh((value) => value + 1)
    setPipelineRefresh((value) => value + 1)
  }, [refreshMenu])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((loadedOutlet) => {
        if (!active) return
        setOutlet(loadedOutlet)
      })
      .catch(() => {
        if (active) setError('Could not load this outlet. Try again in a moment.')
      })
    void Promise.resolve().then(refreshMenu)
    return () => {
      active = false
    }
  }, [outlets, outletId, refreshMenu])

  useOnForeground(refreshVisibleData)

  useEffect(() => {
    if (!outletId) return
    return counter.subscribeToOutletBilling(outletId, refreshVisibleData)
  }, [counter, outletId, refreshVisibleData])

  /**
   * Hold off a waiting build while an order is being composed.
   *
   * The app takes a new build by reloading itself the moment the page is free,
   * and it works out "free" generically, by watching typing. An order is not
   * typing: it lives in `lines` and this whole feature renders no input, so a
   * fifteen-item order is invisible to that measure and would be reloaded away.
   * This is the one place in the app that has to say so for itself
   * (updates-wait-for-a-safe-moment, design D6).
   */
  useEffect(() => {
    if (lines.length === 0) return
    return declareUnsavedWork('billing-composer')
  }, [lines.length])

  /*
    The dialog resolves a complete number for itself, so there is no lookup
    effect here any more. Handed down rather than reached for, which keeps the
    dialog one component over the mock directory and the real one.
  */
  const lookupCustomer = useCallback((phone: string) => customers.lookupByPhone(phone), [customers])
  const openCustomerDialog = useCallback(() => setCustomerDialogOpen(true), [])

  /*
    The partial question, which reaches only this outlet's own customers. Handed
    down beside the complete-number lookup, which reaches the whole business:
    two scopes, two functions, and the dialog never has to know which is which.
  */
  const suggestCustomer = useCallback(
    (partial: string) => customers.suggestByPartialPhone(partial),
    [customers],
  )

  const quantities = useMemo(
    () => new Map(lines.map((line) => [line.menuItemId, line.quantity])),
    [lines],
  )

  const discountRules = useMemo<MenuDiscountRule[]>(
    () =>
      menuDiscounts.map((discount) => ({
        basis: discount.basis,
        ...(discount.basis === 'percent'
          ? { percentBp: discount.valueBp ?? 0 }
          : { amountPaise: discount.valuePaise ?? 0 }),
        categoryIds: discount.categoryIds,
      })),
    [menuDiscounts],
  )

  const categoryNameById = useMemo(
    () => new Map((menu ?? []).map(({ category }) => [category.id, category.name])),
    [menu],
  )

  /**
   * What each bill-level discount comes to, against this order as it stands.
   *
   * Derived rather than stored. A percentage has to stay a percentage of what is
   * actually on the bill, so the amount changes whenever a line does — and the
   * amount was never state to begin with. Holding it in state meant an effect
   * writing state during render, which is a cascade the lint rightly refuses.
   *
   * Every rule reads the order's **gross** subtotal, so two of them are additive
   * and the sequence they were applied in cannot change the total.
   */
  const billDiscounts = useMemo<BillDiscountDraft[]>(() => {
    const subtotal = lines.reduce(
      (sum, line) => sum + lineTotalPaise(line.unitPricePaise, line.quantity),
      0,
    )
    return billDiscountRules.map((rule) => ({
      ...rule,
      amountPaise:
        rule.basis === 'percent'
          ? discountAmountPaise({ basis: 'percent', percentBp: rule.valueBp ?? 0 }, subtotal, 1)
          : Math.min(rule.valuePaise ?? 0, subtotal),
    }))
  }, [lines, billDiscountRules])

  /**
   * What this order comes to, discounts and rounding included.
   *
   * One computation feeding the panel, the footer and every settle path, so the
   * number the biller reads is the number the command carries. A second
   * calculation anywhere here is how a counter starts quoting one figure and
   * charging another.
   */
  const totals = useMemo(
    () =>
      billTotals(lines, {
        discountPaise:
          lines.reduce((sum, line) => sum + (line.discountPaise ?? 0), 0) +
          billDiscounts.reduce((sum, discount) => sum + discount.amountPaise, 0),
      }),
    [lines, billDiscounts],
  )

  /**
   * Adding a line **snapshots** the item's name and price right now. A price
   * edited on the manager's phone while this order is open must not rewrite what
   * the customer was quoted, and a bill must never be joinable back to the live
   * menu.
   */
  const addItem = useCallback(
    (item: Tables<'menu_items'>) => {
      if (settling || !item.is_available) return
      setError(null)
      setLines((current) => {
        const existing = current.find((line) => line.menuItemId === item.id)
        if (existing) {
          return current.map((line) =>
            line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        }
        const captured = menuLineDiscount(
          { categoryId: item.category_id, unitPricePaise: item.price_paise, quantity: 1 },
          discountRules,
        )
        return [
          ...current,
          {
            menuItemId: item.id,
            itemName: item.name,
            unitPricePaise: item.price_paise,
            quantity: 1,
            discountPaise: captured.discountPaise,
            discountPercentBp: captured.discountPercentBp,
            categoryName: categoryNameById.get(item.category_id) ?? null,
          },
        ]
      })
    },
    [settling, discountRules, categoryNameById],
  )

  /**
   * Everything the panel carries that is not the lines themselves.
   *
   * Only the setters are used, and those are stable, so this never goes stale.
   */
  const resetBillContext = useCallback(() => {
    setBillDiscountRules([])
    setCustomer(null)
    setPaymentPreset([])
    // The error too: it is a sentence about a bill, and it outlived the bill.
    // "That payment was not saved on this tablet. Nothing was cleared" reads as
    // a live warning over a panel the biller has just emptied themselves.
    setError(null)
  }, [])

  const changeQuantity = useCallback(
    (menuItemId: string, delta: number) => {
      if (settling) return
      const next = lines.flatMap((line) => {
        if (line.menuItemId !== menuItemId) return [line]
        const quantity = line.quantity + delta
        // Below one there is no line: taking the last one off is how a line is
        // removed, so there is no separate delete to hunt for.
        if (quantity < 1) return []
        // The captured terms are re-applied at the new quantity rather than
        // re-read from today's menu: the line keeps the deal it was created
        // under, and only its size changes.
        const scaled =
          line.discountPercentBp != null
            ? Math.round((line.unitPricePaise * quantity * line.discountPercentBp) / 10000)
            : Math.round(((line.discountPaise ?? 0) / line.quantity) * quantity)
        return [
          { ...line, quantity, discountPaise: Math.min(scaled, line.unitPricePaise * quantity) },
        ]
      })
      setLines(next)
      /*
        **Taking the last line off ends the bill, not just the line.** The panel
        gives way to Bills this shift at zero lines, so what was on it is over —
        and anything left behind reappears on the next bill the moment an item is
        tapped.

        The sharp one is the bill-level discounts: they would be applied to the
        next customer, who never asked for them and whose bill nobody would think
        to check. Same hazard as a discount surviving a settle, same answer.

        Editing a saved order is deliberately not this case. That order still
        exists, its card is still docked, and emptying it is a revision in
        progress rather than an abandoned bill.
      */
      if (next.length === 0 && editingOrder === null) resetBillContext()
    },
    [editingOrder, lines, resetBillContext, settling],
  )

  function clearPanel() {
    setLines([])
    // Cleared with the lines, and for a sharper reason than tidiness: a
    // discount left behind after a settle is applied to the next customer, who
    // never asked for it and whose bill nobody would think to check. The same
    // reasoning applies when the last line is taken off by hand, which is why
    // `changeQuantity` calls the same reset.
    resetBillContext()
  }

  function putDraftOnPanel(draft: Restorable) {
    setLines(structuredClone(draft.lines))
    setCustomer(draft.customer)
    setPaymentPreset(structuredClone(draft.payments))
    // Restored from the draft rather than cleared. Clearing dropped every
    // bill-level discount the order carried the moment it was reopened, and the
    // revision then wrote a total the customer had never been quoted.
    setBillDiscountRules(
      (draft.discounts ?? []).map((discount) => ({
        basis: discount.basis,
        valueBp: discount.valueBp,
        valuePaise: discount.valuePaise,
      })),
    )
  }

  function beginOrderEdit(order: BillingOrder) {
    if (settling || editingOrder) return
    suspendedDraft.current = {
      lines,
      discounts: billDiscounts,
      customer,
      payments: paymentPreset,
    }
    setEditingOrder(order)
    putDraftOnPanel({
      lines: order.lines,
      discounts: order.discounts,
      customer: customerFromOrder(order),
      payments: [],
    })
    setPaymentDialogOpen(false)
    setError(null)
  }

  function leaveOrderEdit() {
    const draft = suspendedDraft.current
    suspendedDraft.current = null
    setEditingOrder(null)
    if (draft) putDraftOnPanel(draft)
    else clearPanel()
    setError(null)
  }

  async function saveOrder() {
    if (!shift || !outlet || !outletId || lines.length === 0) return
    setSettling(true)
    setError(null)
    try {
      await billing.saveOrder({
        clientId: newUuid(),
        outletId,
        shiftId: shift.id,
        businessDate: resolveBusinessDate(new Date(), outlet.business_day_cutover),
        lines,
        discounts: billDiscounts,
        customerId: null,
        ...customerSnapshots(customer),
      })
      clearPanel()
      setPipelineRefresh((value) => value + 1)
      setSavedOrderKey((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That order could not be saved.')
    } finally {
      setSettling(false)
    }
  }

  async function saveEditedOrder() {
    if (!editingOrder || lines.length === 0) return
    setSettling(true)
    setError(null)
    try {
      await billing.reviseOrder(editingOrder.id, {
        lines,
        discounts: billDiscounts,
        customerId: null,
        ...customerSnapshots(customer),
      })
      leaveOrderEdit()
      setPipelineRefresh((value) => value + 1)
    } catch (cause) {
      setError(
        cause instanceof DataActionError ? cause.message : 'That order could not be updated.',
      )
    } finally {
      setSettling(false)
    }
  }

  async function settle(payments: PaymentAllocation[]) {
    if (!shift || !outlet || !outletId) return
    if (lines.length === 0) {
      setError('There is nothing on this bill yet.')
      return
    }
    const totalPaise = totals.totalPaise
    if (
      payments.length === 0 ||
      payments.some((payment) => payment.amountPaise <= 0) ||
      payments.reduce((sum, payment) => sum + payment.amountPaise, 0) !== totalPaise
    ) {
      setError('The payment split must exactly match the bill total.')
      return
    }

    const clientId = newUuid()
    // Stamped now, from the outlet's own cutover — never worked out from a
    // timestamp when the bill is read. A bill rung at 00:20 belongs to the
    // evening that is still going on.
    const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
    setSettling(true)
    setError(null)
    try {
      // This resolves at the IndexedDB transaction boundary. Network delivery
      // starts later and is never awaited by the counter.
      await billing.settleBill({
        clientId,
        outletId,
        shiftId: shift.id,
        businessDate,
        payments,
        lines,
        discounts: billDiscounts,
        ...customerSnapshots(customer),
      })
      setPaymentDialogOpen(false)
      clearPanel()
      setBillRefresh((value) => value + 1)
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That payment was not saved on this tablet. Nothing was cleared; try again.',
      )
    } finally {
      setSettling(false)
    }
  }

  if (!shift) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="no-shift">
        <EmptyState
          icon={KeyRound}
          title="No shift is open, so there is nobody to credit these bills to. Open one — it takes a name and a PIN — and the counter is ready."
          action={
            <Link
              to="../shift"
              relative="path"
              className={buttonVariants({ size: 'control' })}
              data-testid="open-shift-link"
            >
              Open a shift
            </Link>
          }
        />
      </div>
    )
  }

  /*
    One footer, rendered in one of two places: the panel while a new bill is being
    composed, the docked card while a saved order is being edited. Built here
    because this is where the draft it edits lives.
  */
  const composerFooter = (
    <BillComposerFooter
      lines={lines}
      customer={customer}
      settling={settling}
      editing={editingOrder !== null}
      onOpenCustomer={openCustomerDialog}
      onPaid={() => {
        setError(null)
        setPaymentDialogOpen(true)
      }}
      onSaveOrder={editingOrder ? saveEditedOrder : saveOrder}
      discountTotalPaise={totals.discountPaise}
      onCancelEdit={leaveOrderEdit}
    />
  )

  return (
    /*
      Three columns, always. The menu receives the slack but never falls below its
      touch-safe minimum; the current bill and activity rail each own a resize
      control that changes only their respective track.

      Below three columns' worth of viewport this **scrolls sideways** rather than
      rearranging itself. A counter that reflows is a counter whose controls move
      while somebody is reaching for them, and 22rem is about a phone's width, so
      the narrow case ends up as three swipeable panels rather than as a
      compromise. `overflow-y-hidden` keeps that to one axis: each column still
      scrolls its own content, and the page never scrolls sideways as a whole.
    */
    <div
      data-testid="counter-workspace"
      ref={workspaceRef}
      className="grid h-full min-h-0 grid-cols-[minmax(22rem,1fr)_var(--counter-bill-width)_var(--counter-activity-width)] gap-3 overflow-x-auto overflow-y-hidden"
      style={
        {
          '--counter-bill-width': `${columnWidths.bill}px`,
          '--counter-activity-width': `${columnWidths.activity}px`,
        } as CSSProperties
      }
    >
      <div className="@container min-h-0 overflow-y-auto">
        {resume && (
          <p className="mb-2 text-xs font-semibold text-content-muted" data-testid="menu-as-of">
            Menu as of {new Date(resume.lastSuccessfulReadAt).toLocaleString()}
          </p>
        )}
        {menuOffline && (
          <p
            role="status"
            data-testid="menu-offline"
            className="mb-2 rounded-lg border border-warning bg-surface p-2 text-sm font-semibold text-content"
          >
            The backend is unavailable. Using this shift&rsquo;s last loaded menu; captured prices
            stay unchanged.
          </p>
        )}
        {error && (
          <p
            role="alert"
            data-testid="counter-error"
            className="mb-2 text-sm font-semibold text-danger"
          >
            {error}
          </p>
        )}
        {menu === null ? (
          // The menu grid's own silhouette: category headings over a grid of
          // tiles at the tile's height. Only this pane waits — the bill panel
          // beside it is the write path and is never replaced by a placeholder.
          <LoadingRegion label="the menu" className="space-y-3" data-testid="menu-loading">
            <OfflineFillHint />
            {[6, 3].map((tiles, section) => (
              <div key={section}>
                <Shimmer className="mb-1.5 h-4 w-24" />
                <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-4">
                  {Array.from({ length: tiles }, (_, tile) => (
                    <Shimmer key={tile} className="h-20" />
                  ))}
                </div>
              </div>
            ))}
          </LoadingRegion>
        ) : (
          <MenuGrid menu={menu} quantities={quantities} onAdd={addItem} />
        )}
      </div>

      <div className="relative flex min-h-0 flex-col gap-2" data-testid="bill-column">
        <div
          role="separator"
          aria-label="Resize current bill column"
          aria-orientation="vertical"
          aria-valuemin={counterColumnMinWidth()}
          aria-valuenow={columnWidths.bill}
          aria-valuetext={`${columnWidths.bill}px`}
          aria-controls="bill-panel"
          data-column="bill"
          data-testid="resize-current-bill-column"
          tabIndex={0}
          onPointerDown={(event) => beginColumnResize('bill', event)}
          onPointerMove={moveColumnResize}
          onPointerUp={endColumnResize}
          onPointerCancel={endColumnResize}
          onKeyDown={(event) => resizeColumnWithKeyboard('bill', event)}
          className="absolute -left-2.5 top-0 z-20 h-full w-5 cursor-col-resize touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        />
        {/*
          The middle column is Bills this shift by default, and the composer is
          a mode over it (design D5): composition starts on the first item tap,
          ends on save, settle or cancel-edit, and the money list it serves is
          what shows through in between. An order opened for edit borrows the
          same mode.
        */}
        {lines.length > 0 || editingOrder ? (
          <>
            <BillPanel
              lines={lines}
              onChangeQuantity={changeQuantity}
              discountRows={
                <BillDiscountRows
                  lines={lines}
                  discounts={billDiscounts}
                  categoryCount={(menu ?? []).length}
                  roundingPaise={totals.roundingPaise}
                  editable={!settling}
                  onEdit={(index) => setDiscountDialog({ editingIndex: index })}
                  onRemove={(index) =>
                    setBillDiscountRules((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                />
              }
              addDiscount={
                lines.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="phone"
                    className="w-full"
                    data-testid="add-discount"
                    disabled={settling}
                    onClick={() => setDiscountDialog({ editingIndex: null })}
                  >
                    Add discount
                  </Button>
                ) : null
              }
              {...(editingOrder
                ? {
                    editingOrderReference: isAwaitingOrderNumber(editingOrder.orderNumber)
                      ? UNSENT_ORDER_REFERENCE
                      : `order #${editingOrder.orderNumber}`,
                    /*
                      The customer row keeps its place while the rest of the
                      footer is docked beside the order [owner, 2026-09-19]. A
                      biller who has just learnt where the customer goes should
                      not have to go looking for it again on the way back in.
                    */
                    footer: <CustomerRow customer={customer} onOpen={openCustomerDialog} />,
                  }
                : { footer: composerFooter })}
            />

            <DiscountDialog
              open={discountDialog !== null}
              editing={
                discountDialog?.editingIndex != null
                  ? (billDiscounts[discountDialog.editingIndex] ?? null)
                  : null
              }
              presets={discountPresets}
              busy={settling}
              onClose={() => setDiscountDialog(null)}
              onConfirm={(discount) => {
                const rule: BillDiscountRule = {
                  basis: discount.basis,
                  valueBp: discount.valueBp,
                  valuePaise: discount.valuePaise,
                }
                setBillDiscountRules((current) => {
                  const editingIndex = discountDialog?.editingIndex
                  // Editing replaces that discount rather than adding another,
                  // which is what "edit" has to mean for the row to be honest.
                  if (editingIndex == null) return [...current, rule]
                  return current.map((existing, index) =>
                    index === editingIndex ? rule : existing,
                  )
                })
                setDiscountDialog(null)
              }}
            />
          </>
        ) : (
          <MyShiftSurface
            embedded
            {...(resume ? { asOf: resume.lastSuccessfulReadAt } : {})}
            refreshKey={billRefresh}
            onActivityChanged={() => setPipelineRefresh((value) => value + 1)}
          />
        )}
      </div>

      <div className="relative min-h-0 [&>aside]:h-full">
        <div
          role="separator"
          aria-label="Resize activity column"
          aria-orientation="vertical"
          aria-valuemin={counterColumnMinWidth()}
          aria-valuenow={columnWidths.activity}
          aria-valuetext={`${columnWidths.activity}px`}
          aria-controls="counter-activity-rail"
          data-column="activity"
          data-testid="resize-activity-column"
          tabIndex={0}
          onPointerDown={(event) => beginColumnResize('activity', event)}
          onPointerMove={moveColumnResize}
          onPointerUp={endColumnResize}
          onPointerCancel={endColumnResize}
          onKeyDown={(event) => resizeColumnWithKeyboard('activity', event)}
          className="absolute -left-2.5 top-0 z-20 h-full w-5 cursor-col-resize touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        />
        <CounterActivityRail
          {...(resume ? { asOf: resume.lastSuccessfulReadAt } : {})}
          refreshKey={pipelineRefresh}
          savedOrderKey={savedOrderKey}
          editingOrder={editingOrder}
          onEditOrder={beginOrderEdit}
          onActivityChanged={() => setBillRefresh((value) => value + 1)}
          pin={
            editingOrder && (
              <EditingOrderPin
                order={editingOrder}
                lines={lines}
                customerName={customerSnapshots(customer).customerName}
                footer={composerFooter}
              />
            )
          }
        />
      </div>

      <CustomerDialog
        open={customerDialogOpen}
        selection={customer}
        lookup={lookupCustomer}
        suggest={suggestCustomer}
        onClose={() => setCustomerDialogOpen(false)}
        onChoose={(selection) => {
          setCustomer(selection)
          setCustomerDialogOpen(false)
        }}
      />

      <PaymentDialog
        open={paymentDialogOpen}
        totalPaise={totals.totalPaise}
        initialPayments={paymentPreset}
        busy={settling}
        error={error}
        onClose={() => setPaymentDialogOpen(false)}
        onConfirm={(payments) => void settle(payments)}
      />
    </div>
  )
}
