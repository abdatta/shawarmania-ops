import { KeyRound, Undo2 } from 'lucide-react'
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
  type MenuCategoryWithItems,
  type PaymentMethod,
} from '@/data-access/adapters'
import { provisionalReference, resolveBusinessDate, UNDO_WINDOW_MS } from '@/domain'
import { newUuid } from '@/lib/uuid'
import { useSession } from '@/session/context'

import { BillPanel } from './bill-panel'
import { MenuGrid } from './menu-grid'
import { useCounterState } from './use-counter-state'

/**
 * The billing counter — the screen this whole product is for.
 *
 * Two panes on a tablet, neither of which scrolls the page: the whole menu on
 * the left, the current bill on the right. Two taps from a complete order to a
 * cleared screen — a payment method, then Settle.
 *
 * **Settling does not wait for anything.** The bill goes to the queue and the
 * panel clears in the same tick, because the next customer is already there.
 * What appears afterwards is a confirmation with the bill's provisional
 * reference and an Undo, and it clears itself: a queue that waits for an
 * acknowledgement is a queue that stops.
 *
 * Undo removes an unsent queue entry. It is not an edit, and there is no path
 * here to one — a settled bill is append-only, and once it has gone the only
 * correction is a void, which arrives with `billing-live` (#10).
 */

interface Restorable {
  lines: BillLineDraft[]
  customerName: string
  customerPhone: string
  paymentMethod: PaymentMethod | null
}

interface Confirmation extends Restorable {
  clientId: string
  totalPaise: number
}

export function BillingCounter() {
  const session = useSession()
  const { billing, menu: menuAdapter, outlets } = useAdapters()
  const { shift } = useCounterState()

  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [lines, setLines] = useState<BillLineDraft[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const outletId = session.outletId
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    setPaymentMethod(null)
  }

  function settle() {
    if (!shift || !outlet || !outletId) return
    if (lines.length === 0) {
      setError('There is nothing on this bill yet.')
      return
    }
    if (!paymentMethod) {
      setError('Choose how this was paid, then settle.')
      return
    }

    const clientId = newUuid()
    // Stamped now, from the outlet's own cutover — never worked out from a
    // timestamp when the bill is read. A bill rung at 00:20 belongs to the
    // evening that is still going on.
    const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
    const settled: Restorable = { lines, customerName, customerPhone, paymentMethod }

    setSettling(true)
    setError(null)

    // Deliberately not awaited: the counter never blocks on the queue.
    void billing
      .settleBill({
        clientId,
        outletId,
        shiftId: shift.id,
        businessDate,
        paymentMethod,
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

    const totalPaise = lines.reduce(
      (running, line) => running + line.unitPricePaise * line.quantity,
      0,
    )
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
    setPaymentMethod(target.paymentMethod)
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-2 min-h-0 md:order-1 md:overflow-y-auto">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
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

      <div className="order-1 flex min-h-0 flex-col gap-2 md:order-2">
        <BillPanel
          lines={lines}
          customerName={customerName}
          customerPhone={customerPhone}
          paymentMethod={paymentMethod}
          settling={settling}
          onChangeQuantity={changeQuantity}
          onCustomerNameChange={setCustomerName}
          onCustomerPhoneChange={setCustomerPhone}
          onPaymentMethodChange={(method) => {
            setError(null)
            setPaymentMethod(method)
          }}
          onSettle={settle}
        />

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
                <span data-testid="provisional-reference">
                  {provisionalReference(confirmation.clientId)}
                </span>{' '}
                — its number is given when it syncs.
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
    </div>
  )
}
