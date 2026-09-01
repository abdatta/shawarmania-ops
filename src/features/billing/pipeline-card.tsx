import { MoreVertical, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Money } from '@/components/ui/money'
import type { BillingOrder } from '@/data-access/adapters'
import { formatRecentAge } from '@/domain'
import { PAYMENT_EDIT_WINDOW_MS } from '@/domain'

import { cn } from '@/lib/cn'

/**
 * One compact ticket, serving every pipeline section and both hosts.
 *
 * The card answers two questions at a glance — what is in it, and what happens
 * next — and nothing else. Per-line prices left deliberately (owner-flagged,
 * design D6): the total is what gets collected, line amounts live in the
 * composer and on the bill. Everything uncommon hides behind the kebab, whose
 * rows stay touch-safe at 44px.
 *
 * The same component draws the docked-edit variant: `showItems=false` drops the
 * item list the composer beside it is already editing, exactly as the old
 * receipt-shaped card did.
 */
export function PipelineCard({
  order,
  section,
  currentBillerId = null,
  showItems = true,
  busy = false,
  editDisabled = false,
  tenderLabel = null,
  onEdit,
  onMarkPrepared,
  onUnprepare,
  onMarkPaid,
  onCancel,
  onUnpay,
  onCancelAfterPaid,
}: {
  order: BillingOrder
  /** Which section the card sits in — decides its one primary action. */
  section: 'preparing' | 'unpaid-prepared'
  /** Omitted creator chip when this is the person holding the tablet. */
  currentBillerId?: string | null
  /** Off on the docked card: the composer beside it shows the same items. */
  showItems?: boolean
  busy?: boolean
  /** Editing suspends while another order holds the composer. */
  editDisabled?: boolean
  /** Resolved from the bill when known, so Un-pay can name what it takes back. */
  tenderLabel?: string | null
  onEdit?: (order: BillingOrder) => void
  onMarkPrepared: (order: BillingOrder) => void
  /** Only wired for Unpaid Prepared cards, where it is a visible secondary. */
  onUnprepare: (order: BillingOrder) => void
  onMarkPaid: (order: BillingOrder) => void
  onCancel: (order: BillingOrder) => void
  onUnpay: (order: BillingOrder, reason: string) => void
  onCancelAfterPaid: (order: BillingOrder, reason: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ bottom: number; right: number } | null>(null)
  const [unpaying, setUnpaying] = useState(false)
  const [cancellingAfterPaid, setCancellingAfterPaid] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  function placeMenu() {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    // The counter workspace scrolls horizontally, which necessarily clips
    // vertical overflow too. A fixed panel still opens above its trigger but
    // belongs to the viewport instead of that clipped scrolling box.
    setMenuPosition({
      bottom: window.innerHeight - rect.top + 4,
      right: window.innerWidth - rect.right,
    })
  }

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  const totalPaise = order.lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0)
  const reference = order.localReference ?? `Order #${order.orderNumber}`
  const isPaid = order.status === 'paid'
  // The five-minute clock, measured from stored payment time — never a timer.
  // Read one frame after mount so the render itself stays pure.
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNowMs(Date.now()))
    return () => cancelAnimationFrame(frame)
  }, [order.paidAt])
  const unwindOpen =
    isPaid &&
    order.paidAt !== null &&
    nowMs !== null &&
    Date.parse(order.paidAt) + PAYMENT_EDIT_WINDOW_MS > nowMs
  // The creator chip appears for everybody except the person holding the
  // tablet — including on paid cards, whose money someone else may have taken.
  const showCreator = order.creatorId !== currentBillerId

  const kebabRows: Array<{
    label: string
    dangerous?: boolean
    disabled?: boolean
    act: () => void
  }> = []
  if (order.status === 'open') {
    if (onEdit) {
      // Line editing locks once an order is paid; it also stands down while
      // another order holds the composer.
      kebabRows.push({
        label: 'Edit',
        disabled: editDisabled,
        act: () => {
          setMenuOpen(false)
          onEdit(order)
        },
      })
    }
    kebabRows.push({
      label: 'Cancel order',
      dangerous: true,
      act: () => {
        setMenuOpen(false)
        onCancel(order)
      },
    })
  } else if (unwindOpen) {
    kebabRows.push({
      label: 'Cancel after paid',
      dangerous: true,
      act: () => {
        setMenuOpen(false)
        setCancellingAfterPaid(true)
      },
    })
  }

  return (
    <article
      data-flip-id={order.id}
      data-testid={
        order.localReference ? `open-order-local-${order.id}` : `open-order-${order.orderNumber}`
      }
      data-paid={isPaid || undefined}
      className="rounded-xl border border-border bg-surface-raised px-2 py-1.5"
    >
      <div className="flex min-w-0 items-stretch gap-2">
        {/* The taller reference anchors the header. Customer and timing share
            its height rather than adding two extra rows to the ticket. */}
        <span
          data-testid={`order-reference-${order.id}`}
          className="flex shrink-0 items-center text-xl font-black leading-6 text-primary"
        >
          {order.localReference ?? `#${order.orderNumber}`}
        </span>
        <div className="min-w-0 flex-1 self-center">
          {order.customerName && (
            <div className="flex min-w-0 items-center gap-1 text-sm font-black leading-5 text-content">
              <UserRound aria-hidden className="shrink-0 text-accent-text" size={14} />
              <span className="max-w-40 truncate">{order.customerName}</span>
            </div>
          )}
          <div
            data-testid={`order-metadata-${order.id}`}
            className="flex min-w-0 items-center gap-x-1.5 text-xs leading-4 text-content-muted"
          >
            <span>{formatRecentAge(order.orderedAt)}</span>
            {showCreator && <span className="truncate">· {order.creatorName}</span>}
          </div>
        </div>
        <div className="flex shrink-0 self-center items-center gap-1.5">
          {isPaid && (
            <span
              data-testid={`paid-chip-${order.id}`}
              className="rounded-md bg-success px-1.5 py-0.5 text-xs font-black text-on-success"
            >
              PAID
            </span>
          )}
          <Money paise={totalPaise} display className="font-black text-content" />
        </div>
      </div>

      {showItems && order.lines.length > 0 && (
        <ul className="mt-0.5 space-y-0" aria-label={`Items for ${reference}`}>
          {order.lines.map((line, index) => (
            <li
              key={`${line.menuItemId}-${index}`}
              className="flex items-start gap-1.5 text-sm leading-5"
            >
              <span className="min-w-6 shrink-0 font-black text-content">{line.quantity}×</span>
              <span className="min-w-0 flex-1 font-bold text-content">{line.itemName}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex items-stretch justify-between gap-1.5">
        {section === 'unpaid-prepared' ? (
          /* Green is this card's identity: prepared food waiting for money.
             Filled success actions use their own contrast-gated token pair. */
          <>
            <Button
              size="phone"
              className="h-9 flex-1 bg-success px-3 text-on-success"
              disabled={busy}
              onClick={() => onMarkPaid(order)}
            >
              Paid
            </Button>
            <Button
              variant="secondary"
              size="phone"
              className="h-9 flex-1 px-3"
              disabled={busy}
              onClick={() => onUnprepare(order)}
            >
              Reprepare
            </Button>
          </>
        ) : (
          <>
            <Button
              size="phone"
              className="h-9 flex-1 px-3"
              disabled={busy}
              onClick={() => onMarkPrepared(order)}
            >
              Prepared
            </Button>
            {unwindOpen ? (
              <Button
                variant="secondary"
                size="phone"
                className="h-9 flex-1 px-3"
                disabled={busy}
                onClick={() => setUnpaying(true)}
              >
                Un-pay
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="phone"
                className="h-9 flex-1 px-3"
                disabled={busy || isPaid}
                onClick={() => onMarkPaid(order)}
              >
                Paid
              </Button>
            )}
          </>
        )}

        {kebabRows.length > 0 && (
          <div className="relative" ref={menuRef}>
            <Button
              variant="secondary"
              size="phone"
              className="h-9 w-9 px-0"
              aria-label={`More actions for ${reference}`}
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => {
                if (!menuOpen) placeMenu()
                setMenuOpen((open) => !open)
              }}
            >
              <MoreVertical aria-hidden size={17} />
            </Button>
            {menuOpen && (
              <div
                role="menu"
                aria-label={`More actions for ${reference}`}
                style={{ position: 'fixed', ...menuPosition }}
                className="z-30 w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"
              >
                {kebabRows.map((row) => (
                  <button
                    key={row.label}
                    role="menuitem"
                    disabled={row.disabled}
                    onClick={row.act}
                    className={cn(
                      'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-50',
                      row.dangerous ? 'text-danger' : 'text-content',
                    )}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <UnpayDialog
        open={unpaying}
        reference={reference}
        totalPaise={totalPaise}
        tenderLabel={tenderLabel}
        busy={busy}
        onClose={() => setUnpaying(false)}
        onConfirm={(reason) => {
          setUnpaying(false)
          onUnpay(order, reason)
        }}
      />
      <CancelAfterPaidDialog
        open={cancellingAfterPaid}
        reference={reference}
        totalPaise={totalPaise}
        busy={busy}
        onClose={() => setCancellingAfterPaid(false)}
        onConfirm={(reason) => {
          setCancellingAfterPaid(false)
          onCancelAfterPaid(order, reason)
        }}
      />
    </article>
  )
}

export function UnpayDialog({
  open,
  reference,
  totalPaise,
  tenderLabel,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  /** What the payment is called on screen — an order reference or a bill number. */
  reference: string
  totalPaise: number
  /** Resolved from the bill when known, so the dialog names what comes back. */
  tenderLabel?: string | null
  busy?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={`Take back the payment for ${reference}`}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl p-4"
    >
      {/* The form mounts only while the dialog is open, so its reason state
          starts empty every time — no reset effect, nothing stale carried. */}
      {open && (
        <ReasonForm
          tone="primary"
          heading="Take this payment back?"
          inputId="unpay-reason"
          inputPlaceholder="Why is this payment coming back?"
          body={
            <>
              <Money paise={totalPaise} display className="font-bold text-content" />{' '}
              {tenderLabel ? `taken as ${tenderLabel}` : 'was recorded'} will be voided and the
              order returns to the pipeline. Possible only within five minutes of taking it.
            </>
          }
          keepLabel="Keep the payment"
          confirmLabel="Take it back"
          busy={busy}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Modal>
  )
}

/**
 * Loud on purpose: confirming here moves money out of the drawer, and the one
 * thing this dialog must never be is easy to do half-asleep.
 */
export function CancelAfterPaidDialog({
  open,
  reference,
  totalPaise,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  reference: string
  totalPaise: number
  busy?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={`Cancel the paid ${reference}`}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border-danger p-4"
    >
      {open && (
        <ReasonForm
          tone="danger"
          heading="Cancel this paid order?"
          inputId="cancel-paid-reason"
          inputPlaceholder="Why is this order being cancelled?"
          bodyClassName="font-semibold text-content"
          body={
            <>
              This voids <Money paise={totalPaise} display className="font-black text-danger" /> —
              the money leaves the drawer — and cancels the order outright. It cannot be undone from
              this tablet.
            </>
          }
          keepLabel="Keep the order"
          confirmLabel="Void the money and cancel"
          busy={busy}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Modal>
  )
}

function ReasonForm({
  tone,
  heading,
  body,
  bodyClassName,
  inputId,
  inputPlaceholder,
  keepLabel,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  tone: 'primary' | 'danger'
  heading: string
  body: ReactNode
  bodyClassName?: string
  inputId: string
  inputPlaceholder: string
  keepLabel: string
  confirmLabel: string
  busy?: boolean | undefined
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <>
      <h2 className={cn('text-lg font-black', tone === 'danger' ? 'text-danger' : 'text-content')}>
        {heading}
      </h2>
      <p className={cn('mt-2 text-sm', bodyClassName ?? 'text-content-muted')}>{body}</p>
      <label htmlFor={inputId} className="mt-4 block text-sm font-bold text-content">
        Reason
      </label>
      <input
        id={inputId}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content focus-visible:focus-ring"
        placeholder={inputPlaceholder}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="phone" onClick={onClose}>
          {keepLabel}
        </Button>
        <Button
          {...(tone === 'danger' ? { variant: 'danger' as const } : {})}
          size="phone"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  )
}
