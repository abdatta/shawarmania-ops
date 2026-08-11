import { KeyRound, Undo2, UserRoundCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { buttonVariants } from '@/components/ui/button-variants'
import { Button } from '@/components/ui/button'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type BillLineDraft,
  type BillingOrder,
  type CustomerIdentity,
  type MenuCategoryWithItems,
  type PaymentAllocation,
} from '@/data-access/adapters'
import { resolveBusinessDate, UNDO_WINDOW_MS } from '@/domain'
import { newUuid } from '@/lib/uuid'
import { declareUnsavedWork } from '@/pwa/occupancy'
import { useSession } from '@/session/context'
import { validateIndianPhone } from '../../../shared/phone'

import { BillComposerFooter } from './bill-composer-footer'
import { BillPanel } from './bill-panel'
import { CounterActivityRail } from './counter-activity-rail'
import { EditingOrderPin } from './editing-order-pin'
import { MenuGrid } from './menu-grid'
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
 * start, and the money is taken on handover, from the rail. **Mark Paid** is the
 * secondary path for the rarer upfront payment; neither settles on the spot —
 * tender is captured in a tap-first dialog.
 *
 * **A direct payment does not wait for anything.** The bill goes to the queue
 * and the panel clears in the same tick, because the next customer is already
 * there. What appears afterwards is a confirmation with the bill's short local
 * reference and an Undo, and it clears itself: a queue that waits for an
 * acknowledgement is a queue that stops.
 *
 * Undo removes an unsent queue entry. It is not an edit, and there is no path
 * here to one — a settled bill is append-only, and the only correction is a
 * manager's reasoned void followed by a manual re-ring on this tablet.
 *
 * Editing a saved order borrows this same composer: the order goes onto the
 * panel, any draft already in progress is suspended and restored afterwards, and
 * both the panel and the rail take the accent outline with the order pinned
 * beside the panel, so the mode and its subject are never in doubt.
 */

interface Restorable {
  lines: BillLineDraft[]
  customerName: string
  customerPhone: string
  payments: PaymentAllocation[]
}

interface Confirmation extends Restorable {
  clientId: string
  totalPaise: number
}

export function BillingCounter() {
  const session = useSession()
  const { billing, customers, menu: menuAdapter, outlets } = useAdapters()
  const { shift } = useCounterState()

  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [lines, setLines] = useState<BillLineDraft[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentPreset, setPaymentPreset] = useState<PaymentAllocation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [customerMatch, setCustomerMatch] = useState<CustomerIdentity | null>(null)
  const [customerMatchPhone, setCustomerMatchPhone] = useState<string | null>(null)
  const [declinedPhone, setDeclinedPhone] = useState<string | null>(null)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [editingOrder, setEditingOrder] = useState<BillingOrder | null>(null)

  const outletId = session.outletId
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suspendedDraft = useRef<Restorable | null>(null)

  useEffect(() => {
    if (!outletId) return
    let active = true
    void Promise.all([menuAdapter.listMenu(outletId), outlets.getOutlet(outletId)])
      .then(([loadedMenu, loadedOutlet]) => {
        if (!active) return
        setMenu(loadedMenu)
        setOutlet(loadedOutlet)
      })
      .catch(() => {
        if (active) setError('Could not load the menu. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [menuAdapter, outlets, outletId])

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    },
    [],
  )

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

  useEffect(() => {
    const validation = validateIndianPhone(customerPhone)
    if (!validation.phone || validation.phone === declinedPhone) {
      return
    }
    let active = true
    void customers
      .lookupByPhone(validation.phone)
      .then((match) => {
        if (active) {
          setCustomerMatch(match)
          setCustomerMatchPhone(validation.phone)
        }
      })
      .catch(() => {
        if (active) setCustomerMatch(null)
      })
    return () => {
      active = false
    }
  }, [customerPhone, customers, declinedPhone])

  const currentPhone = validateIndianPhone(customerPhone).phone
  const visibleCustomerMatch =
    currentPhone && currentPhone === customerMatchPhone && currentPhone !== declinedPhone
      ? customerMatch
      : null

  const quantities = useMemo(
    () => new Map(lines.map((line) => [line.menuItemId, line.quantity])),
    [lines],
  )

  /**
   * Adding a line **snapshots** the item's name and price right now. A price
   * edited on the manager's phone while this order is open must not rewrite what
   * the customer was quoted, and a bill must never be joinable back to the live
   * menu.
   */
  const addItem = useCallback((item: Tables<'menu_items'>) => {
    if (!item.is_available) return
    setError(null)
    setLines((current) => {
      const existing = current.find((line) => line.menuItemId === item.id)
      if (existing) {
        return current.map((line) =>
          line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        )
      }
      return [
        ...current,
        {
          menuItemId: item.id,
          itemName: item.name,
          unitPricePaise: item.price_paise,
          quantity: 1,
        },
      ]
    })
  }, [])

  const changeQuantity = useCallback((menuItemId: string, delta: number) => {
    setLines((current) =>
      current.flatMap((line) => {
        if (line.menuItemId !== menuItemId) return [line]
        const quantity = line.quantity + delta
        // Below one there is no line: taking the last one off is how a line is
        // removed, so there is no separate delete to hunt for.
        return quantity < 1 ? [] : [{ ...line, quantity }]
      }),
    )
  }, [])

  function clearPanel() {
    setLines([])
    setCustomerName('')
    setCustomerPhone('')
    setCustomerMatch(null)
    setCustomerMatchPhone(null)
    setDeclinedPhone(null)
    setPaymentPreset([])
  }

  function putDraftOnPanel(draft: Restorable) {
    setLines(structuredClone(draft.lines))
    setCustomerName(draft.customerName)
    setCustomerPhone(draft.customerPhone)
    setPaymentPreset(structuredClone(draft.payments))
    setCustomerMatch(null)
    setCustomerMatchPhone(null)
    setDeclinedPhone(null)
  }

  function beginOrderEdit(order: BillingOrder) {
    if (editingOrder) return
    suspendedDraft.current = { lines, customerName, customerPhone, payments: paymentPreset }
    setEditingOrder(order)
    putDraftOnPanel({
      lines: order.lines,
      customerName: order.customerName ?? '',
      customerPhone: order.customerPhone ?? '',
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

  async function saveCustomerIfComplete(): Promise<string | null> {
    const validation = validateIndianPhone(customerPhone)
    if (!validation.phone) return null
    const identity = await customers.createOrGet({ phone: validation.phone, name: customerName })
    return identity.id
  }

  async function saveOrder() {
    if (!shift || !outlet || !outletId || lines.length === 0) return
    setSettling(true)
    setError(null)
    try {
      const customerId = await saveCustomerIfComplete()
      await billing.saveOrder({
        clientId: newUuid(),
        outletId,
        shiftId: shift.id,
        businessDate: resolveBusinessDate(new Date(), outlet.business_day_cutover),
        lines,
        customerId,
        customerName,
        customerPhone,
      })
      clearPanel()
      setActivityRefresh((value) => value + 1)
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
      const customerId = await saveCustomerIfComplete()
      await billing.reviseOrder(editingOrder.id, {
        lines,
        customerId,
        customerName,
        customerPhone,
      })
      leaveOrderEdit()
      setActivityRefresh((value) => value + 1)
    } catch (cause) {
      setError(
        cause instanceof DataActionError ? cause.message : 'That order could not be updated.',
      )
    } finally {
      setSettling(false)
    }
  }

  function settle(payments: PaymentAllocation[]) {
    if (!shift || !outlet || !outletId) return
    if (lines.length === 0) {
      setError('There is nothing on this bill yet.')
      return
    }
    const totalPaise = lines.reduce(
      (running, line) => running + line.unitPricePaise * line.quantity,
      0,
    )
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
    const settled: Restorable = { lines, customerName, customerPhone, payments }

    setSettling(true)
    setError(null)
    setPaymentDialogOpen(false)
    // Customer identity is helpful, never a condition of sale.
    void saveCustomerIfComplete().catch(() => undefined)

    // Deliberately not awaited: the counter never blocks on the queue.
    void billing
      .settleBill({
        clientId,
        outletId,
        shiftId: shift.id,
        businessDate,
        payments,
        lines,
        customerName,
        customerPhone,
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof DataActionError
            ? cause.message
            : 'That bill could not be queued. Try again.',
        )
      })
      .finally(() => setSettling(false))

    setConfirmation({ clientId, totalPaise, ...settled })
    clearPanel()

    // The confirmation clears itself. It is on screen for exactly the undo
    // window, which is also exactly the period during which the bill cannot yet
    // have been sent — so an Undo that is visible is always an Undo that works.
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setConfirmation(null), UNDO_WINDOW_MS)
  }

  function undo(target: Confirmation) {
    setConfirmation(null)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    void billing.cancelQueuedBill(target.clientId).catch((cause: unknown) => {
      setError(
        cause instanceof DataActionError ? cause.message : 'That bill could no longer be undone.',
      )
    })
    setLines(target.lines)
    setCustomerName(target.customerName)
    setCustomerPhone(target.customerPhone)
    setPaymentPreset(target.payments)
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
      customerName={customerName}
      customerPhone={customerPhone}
      settling={settling}
      editing={editingOrder !== null}
      onCustomerNameChange={setCustomerName}
      onCustomerPhoneChange={setCustomerPhone}
      onPaid={() => {
        setError(null)
        setPaymentDialogOpen(true)
      }}
      onSaveOrder={editingOrder ? saveEditedOrder : saveOrder}
      onCancelEdit={leaveOrderEdit}
    />
  )

  return (
    /*
      Three columns, always, all the same width — the width the current bill
      wants. Slack goes to the menu, which is the column that reads better wide;
      the other two are exactly as wide as they need to be.

      Below three columns' worth of viewport this **scrolls sideways** rather than
      rearranging itself. A counter that reflows is a counter whose controls move
      while somebody is reaching for them, and 22rem is about a phone's width, so
      the narrow case ends up as three swipeable panels rather than as a
      compromise. `overflow-y-hidden` keeps that to one axis: each column still
      scrolls its own content, and the page never scrolls sideways as a whole.
    */
    <div
      data-testid="counter-workspace"
      className="grid h-full min-h-0 grid-cols-[minmax(22rem,1fr)_22rem_22rem] gap-3 overflow-x-auto overflow-y-hidden"
    >
      <div className="@container min-h-0 overflow-y-auto">
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

      <div className="flex min-h-0 flex-col gap-2">
        <BillPanel
          lines={lines}
          onChangeQuantity={changeQuantity}
          {...(editingOrder
            ? { editingOrderNumber: editingOrder.orderNumber }
            : { footer: composerFooter })}
        />

        {visibleCustomerMatch && (
          <div
            className="rounded-xl border border-primary bg-surface p-3"
            role="status"
            data-testid="customer-match"
          >
            <div className="flex gap-2">
              <UserRoundCheck aria-hidden className="mt-0.5 text-primary" size={20} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-content">Returning customer found</p>
                <p className="text-sm text-content-muted">
                  {visibleCustomerMatch.name
                    ? customerName.trim() && customerName.trim() !== visibleCustomerMatch.name
                      ? `Use ${visibleCustomerMatch.name}? This replaces the name in this order only.`
                      : `Fill this order with ${visibleCustomerMatch.name}?`
                    : 'This phone has no saved name.'}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="phone"
                    onClick={() => {
                      if (visibleCustomerMatch.name) setCustomerName(visibleCustomerMatch.name)
                      setCustomerMatch(null)
                      setDeclinedPhone(validateIndianPhone(customerPhone).phone)
                    }}
                  >
                    Use saved details
                  </Button>
                  <Button
                    variant="secondary"
                    size="phone"
                    onClick={() => {
                      setCustomerMatch(null)
                      setDeclinedPhone(validateIndianPhone(customerPhone).phone)
                    }}
                  >
                    Keep this order
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {confirmation && (
          <div
            role="status"
            data-testid="settled-confirmation"
            className="flex items-center gap-2 rounded-xl border border-success bg-surface p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-content">
                Settled <Money paise={confirmation.totalPaise} />
              </p>
              <p className="truncate text-xs text-content-muted">
                <span data-testid="local-reference">
                  Local · {confirmation.clientId.replaceAll('-', '').slice(0, 4).toUpperCase()}
                </span>{' '}
                — not sent yet. Its bill number appears after delivery.
              </p>
            </div>
            <Button
              variant="secondary"
              size="phone"
              data-testid="undo-settle"
              onClick={() => undo(confirmation)}
            >
              <Undo2 aria-hidden size={16} />
              Undo
            </Button>
          </div>
        )}
      </div>

      <CounterActivityRail
        refreshKey={activityRefresh}
        editingOrder={editingOrder}
        onEditOrder={beginOrderEdit}
        pin={
          editingOrder && (
            <EditingOrderPin
              order={editingOrder}
              lines={lines}
              customerName={customerName}
              footer={composerFooter}
            />
          )
        }
      />

      <PaymentDialog
        open={paymentDialogOpen}
        totalPaise={lines.reduce(
          (running, line) => running + line.unitPricePaise * line.quantity,
          0,
        )}
        initialPayments={paymentPreset}
        busy={settling}
        onClose={() => setPaymentDialogOpen(false)}
        onConfirm={settle}
      />
    </div>
  )
}
