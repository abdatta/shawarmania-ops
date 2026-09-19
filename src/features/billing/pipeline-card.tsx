import { MoreVertical, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import type { BillingOrder } from '@/data-access/adapters'
import {
  formatRecentAge,
  isAwaitingOrderNumber,
  ticketEditDeadlineMs,
  UNSENT_ORDER_REFERENCE,
} from '@/domain'

import { cn } from '@/lib/cn'

import { StateToggle } from './state-toggle'

/**
 * One compact ticket, serving the whole pipeline list and both hosts.
 *
 * The card answers the **two** questions an order answers — is the food made,
 * is it paid — and nothing else. It used to answer them with its section plus
 * four button variants, and asked the biller to invert that projection while a
 * customer waited; now each question is its own control, in its own fixed
 * place, wearing its own fixed word. Nothing about the card depends on where it
 * sits, because there is nowhere else for it to sit.
 *
 * Per-line prices left deliberately (owner-flagged, design D6): the total is
 * what gets collected, line amounts live in the composer and on the bill.
 * Everything uncommon hides behind the kebab, whose rows stay touch-safe.
 *
 * The same component draws the docked-edit variant: `showItems=false` drops the
 * item list the composer beside it is already editing, exactly as the old
 * receipt-shaped card did.
 */
export function PipelineCard({
  order,
  currentBillerId = null,
  currentDeviceId = null,
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
  /** Omitted creator chip when this is the person holding the tablet. */
  currentBillerId?: string | null
  /**
   * The tablet reading this card, so a card from the other till can say so.
   * Null off the counter, where every card is somebody else's by definition and
   * the creator's name is the honest attribution.
   */
  currentDeviceId?: string | null
  /** Off on the docked card: the composer beside it shows the same items. */
  showItems?: boolean
  busy?: boolean
  /** Editing suspends while another order holds the composer. */
  editDisabled?: boolean
  /** Resolved from the bill when known, so the take-back can name what it returns. */
  tenderLabel?: string | null
  onEdit?: (order: BillingOrder) => void
  onMarkPrepared: (order: BillingOrder) => void
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

  /**
   * What the order actually comes to, read off the order rather than re-added
   * from its lines.
   *
   * Re-adding the lines produces the **gross** figure, which is what this card
   * showed while the tender dialog behind it asked for the discounted one — two
   * numbers for one order, a hundred rupees apart, on the same screen.
   */
  const totalPaise = order.totalPaise
  /** The list price, shown struck through only when a discount moved it. */
  const grossPaise = order.lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0)
  const discounted = grossPaise > totalPaise
  const awaitingNumber = isAwaitingOrderNumber(order.orderNumber)
  const reference = awaitingNumber ? UNSENT_ORDER_REFERENCE : `Order #${order.orderNumber}`
  const isPaid = order.status === 'paid'
  const prepared = order.preparedAt !== null
  /*
    The ticket's edit window, from the one domain function the database and both
    adapters also read — never a timer. Read one frame after mount so the render
    itself stays pure.

    A card sits in the pipeline list only while it is not both prepared and
    paid, so in practice every payment reachable here has no deadline yet and
    this is always open. It is still computed rather than assumed: the rule is
    the rule, and the day a paid-and-prepared card can appear in this list, the
    card must not offer something the database would refuse.
  */
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNowMs(Date.now()))
    return () => cancelAnimationFrame(frame)
  }, [order.paidAt, order.preparedAt])
  const editDeadlineMs = ticketEditDeadlineMs({
    paidAt: order.paidAt,
    preparedAt: order.preparedAt,
    settlesAnOrder: true,
  })
  const unwindOpen =
    isPaid &&
    order.paidAt !== null &&
    // No deadline yet — the food is still owed — so this needs no clock at all
    // and the card offers the take-back on its very first frame. Only a started
    // countdown has to wait to be measured.
    (editDeadlineMs === null || (nowMs !== null && editDeadlineMs > nowMs))
  // The creator chip appears for everybody except the person holding the
  // tablet — including on paid cards, whose money someone else may have taken.
  const showCreator = order.creatorId !== currentBillerId
  /*
    And the TILL chip appears whenever the order came from a different one.

    The creator's name used to carry this on its own, and did so correctly while
    an outlet had one tablet: another name meant another till. With two tablets
    one person may hold a shift on each, and then the neighbouring tablet's order
    carries the reader's own name — no creator chip, nothing to distinguish it
    from their own work, and a refusal they meet with no warning. Ownership is
    per tablet, so the tablet is the fact that predicts it.

    Only on the counter, and only when the label was readable: a tablet may read
    its own outlet's labels, and a null means "not this tablet's" rather than
    "this tablet's", so it is never claimed as own work.
  */
  /*
    Whether this order belongs to a different till, which is the ownership
    question, and separately whether its label could be read, which is only
    presentation. An unreadable label must never be mistaken for own work, so
    the gate below is keyed on the tablet and the chip on the label.
  */
  const foreignTill = currentDeviceId !== null && order.deviceId !== currentDeviceId
  const otherTill = foreignTill ? order.deviceLabel : null
  /*
    A neighbour's order is read-only here, and its two facts are *printed* on
    the card rather than offered as controls that refuse: no border, no press
    affordance, no pressed state to misreport. A dimmed button is a promise the
    screen is refusing to keep, and billers read it as breakage. The till named
    beside the time is the sentence that explains it.

    The boundary is still the database's, and the adapter refuses locally too,
    so this is the third of three guards and the only one an operator ever sees
    — changed in appearance here, never in authority.
  */
  const actionsDisabled = busy || foreignTill

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
        disabled: editDisabled || foreignTill,
        act: () => {
          setMenuOpen(false)
          onEdit(order)
        },
      })
    }
    kebabRows.push({
      label: 'Cancel order',
      dangerous: true,
      disabled: foreignTill,
      act: () => {
        setMenuOpen(false)
        onCancel(order)
      },
    })
  } else if (unwindOpen) {
    kebabRows.push({
      label: 'Cancel after paid',
      dangerous: true,
      disabled: foreignTill,
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
        awaitingNumber ? `open-order-local-${order.id}` : `open-order-${order.orderNumber}`
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
          {awaitingNumber ? (
            <>
              {/*
                The shape of the number that is coming, not a stand-in for it.
                A token stood here once and read as an identifier, so the real
                number replacing it read as the order changing identity.
              */}
              <Shimmer className="h-6 w-12 rounded-md" />
              <span className="sr-only">Order number not yet assigned</span>
            </>
          ) : (
            `#${order.orderNumber}`
          )}
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
            {otherTill && (
              <span className="truncate font-semibold" data-testid={`order-till-${order.id}`}>
                · on {otherTill}
              </span>
            )}
          </div>
        </div>
        {/* No paid badge: the ticked Paid box below says it, in the place the
            biller is already looking. */}
        <div className="flex shrink-0 self-center items-center gap-1.5">
          <span className="flex items-baseline gap-1.5">
            {discounted && (
              <Money
                paise={grossPaise}
                data-testid={`order-gross-${order.id}`}
                className="text-xs text-content-muted line-through"
              />
            )}
            <Money paise={totalPaise} display className="font-black text-content" />
          </span>
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
        {/*
          Prepared then Paid, in that order, at equal width, on every card in
          every state. This is the whole point of #55 and no state may reorder,
          resize, rename or withhold either of them.
        */}
        <StateToggle
          label="Prepared"
          tone="primary"
          checked={prepared}
          interactive={!foreignTill}
          disabled={busy}
          testId={`prepared-toggle-${order.id}`}
          onActivate={() => (prepared ? onUnprepare(order) : onMarkPrepared(order))}
        />
        <StateToggle
          label="Paid"
          tone="success"
          checked={isPaid}
          interactive={!foreignTill}
          disabled={busy}
          testId={`paid-toggle-${order.id}`}
          /*
            Unchecked opens the tender dialog and the tick lands only when money
            is actually recorded; checked opens the reasoned take-back. A card
            sits in this list only while it is not both prepared and paid, so
            every ticked Paid box here is untickable by construction — the box
            never lies about what pressing it will do.
          */
          onActivate={() => (isPaid ? setUnpaying(true) : onMarkPaid(order))}
        />

        {kebabRows.length > 0 && (
          <div className="relative" ref={menuRef}>
            <Button
              variant="secondary"
              size="phone"
              className="h-9 w-9 px-0"
              aria-label={`More actions for ${reference}`}
              aria-expanded={menuOpen}
              disabled={actionsDisabled}
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
