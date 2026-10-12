import { Check, ListPlus, UserRound, UserRoundPlus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { MemberMark } from '@/components/ui/member-mark'
import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { billTotals } from '@/domain'
import { formatIndianPhone } from '../../../shared/phone'

import type { CustomerSelection } from './customer-dialog'

/**
 * The composer's controls: the total, who the order is for, and how it leaves.
 *
 * It lives in two places, one at a time. Composing a new bill it sits pinned to
 * the bottom of the current-bill panel, under the hand holding the tablet.
 * Editing a saved order it moves into the card docked at the top of the activity
 * rail, next to the order it is changing — so the thing being edited and the
 * controls that finish the edit are one block, and the panel below is left as
 * what it is at that moment: the items, and nothing else.
 *
 * Exactly one instance is ever mounted. Two would mean two Save changes buttons
 * and two customer rows opening one dialog, which is a worse bug than whichever
 * layout problem tempted anyone into it.
 *
 * **The customer is one row, not two boxes.** Identity is decided in the dialog
 * the row opens — the phone is what identifies somebody — and the row reports
 * what was decided in three states, and a decision already made is changed by
 * tapping the row again and making a different one.
 *
 * Customer entry is optional for Order and Save changes. Paid asks for a
 * missing number at checkout, before loyalty and tender. Both snapshot
 * columns stay nullable: ordering never requires identification or Skip.
 */
export function BillComposerFooter({
  lines,
  customer,
  settling,
  editing,
  onOpenCustomer,
  onPaid,
  onSaveOrder,
  onCancelEdit,
  discountTotalPaise = 0,
  service,
  serviceOwed = false,
  collectCustomerDetails = true,
}: {
  lines: BillLineDraft[]
  /** What the biller decided, or null while they have decided nothing. */
  customer: CustomerSelection | null
  settling: boolean
  editing: boolean
  onOpenCustomer: () => void
  onPaid: () => void
  onSaveOrder: () => void
  onCancelEdit?: (() => void) | undefined
  /**
   * What every discount on this order comes to, so the Total here is the total
   * the tender dialog opens at. Computed once by the counter and passed down —
   * a second calculation in this file is how a counter starts quoting one figure
   * and charging another.
   */
  discountTotalPaise?: number
  /** Dine-in and takeaway, where the outlet offers them, beside the customer. */
  service?: ReactNode
  /**
   * Where the food goes is still unanswered and the outlet requires an answer
   * [owner, 2026-09-27]. The terminal actions wait, and the chips standing
   * unpressed beside them are the reminder. Customer entry remains optional.
   */
  serviceOwed?: boolean
  collectCustomerDetails?: boolean
}) {
  const totals = billTotals(lines, { discountPaise: discountTotalPaise })

  const canPay = !settling && lines.length > 0 && !serviceOwed

  return (
    <div className="space-y-3">
      {/*
        Docked, the card this footer sits in already shows the order's total at
        the top, so a Total row here would be the same number twice a centimetre
        apart. The panel has no other total, so it keeps this one.
      */}
      {!editing && (
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-content-muted">Total</span>
          <Money paise={totals.totalPaise} display data-testid="bill-total" />
        </div>
      )}

      {/*
        Editing, this footer is docked in the rail and the panel renders the row
        itself, in the place it always sits. Rendering it here too would be two
        of one control — which is the failure this footer's own doc warns about.
      */}
      {!editing && (
        <CustomerServiceRow
          customer={customer}
          onOpen={onOpenCustomer}
          service={service}
          collectCustomerDetails={collectCustomerDetails}
        />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Button
          size="control"
          className="w-full text-lg"
          disabled={!canPay}
          data-testid="save-order"
          onClick={onSaveOrder}
        >
          {editing ? <Check aria-hidden size={18} /> : <ListPlus aria-hidden size={18} />}
          {editing ? 'Save changes' : 'Order'}
        </Button>
        {editing ? (
          <Button
            variant="secondary"
            size="control"
            disabled={settling}
            data-testid="cancel-edit"
            onClick={onCancelEdit}
          >
            Cancel edit
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="control"
            disabled={!canPay}
            data-testid="settle"
            onClick={onPaid}
          >
            Paid
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * What the row says once a decision exists.
 *
 * `Skipped Customer Info` is the ordinary skipped row — a decision, stated, and
 * tappable again. It names what was skipped rather than saying the customer was,
 * because there is still a customer; it is their details that were not taken.
 *
 * `Asha · no number` is an order rung **before** this change: every one of them
 * carries a name and no phone, so reopening one has to say which half is
 * missing without implying the name identifies anybody. A customer who gave a
 * number but no name is their number, which is what they are.
 */
function customerRowLabel(customer: CustomerSelection): string {
  if (customer.kind === 'skipped') {
    return customer.name === '' ? 'Skipped Customer Info' : `${customer.name} · no number`
  }
  const phone = `+91 ${formatIndianPhone(customer.phone)}`
  return customer.name === '' ? phone : `${customer.name} · ${phone}`
}

/**
 * The type chips on a row of their own, **above** the customer control
 * [owner, 2026-09-27] (each-outlet-chooses-how-it-serves): where the food goes
 * first, then who it is for. At an outlet where the counter asks nothing this
 * is the customer row alone, exactly as before.
 */
export function CustomerServiceRow({
  customer,
  onOpen,
  service,
  collectCustomerDetails = true,
}: {
  customer: CustomerSelection | null
  onOpen: () => void
  service?: ReactNode
  collectCustomerDetails?: boolean
}) {
  if (!collectCustomerDetails) return service ?? null
  if (!service) return <CustomerRow customer={customer} onOpen={onOpen} />
  return (
    <div className="space-y-3" data-testid="customer-service-row">
      {service}
      <CustomerRow customer={customer} onOpen={onOpen} />
    </div>
  )
}

/**
 * Who the order is for, as one control.
 *
 * **Its own component so it can keep its place.** Composing a bill it sits in
 * the panel's footer; editing a saved order the footer moves into the docked
 * card, and the row stays behind in the panel — because a biller who has just
 * learnt where the customer goes should not have to find it again on the way
 * back in [owner, 2026-09-19]. One instance is mounted either way.
 */
export function CustomerRow({
  customer,
  onOpen,
}: {
  customer: CustomerSelection | null
  onOpen: () => void
}) {
  /*
    One control and nothing beside it. There was a clear action here; it was
    removed because it only ever returned the row to a state the biller then had
    to leave again through this same dialog [owner, 2026-09-19]. A decision is
    changed by making a different one.

    And no skip out here either, which is the one control this change most
    deliberately does not add: a bypass under the same thumb that taps Paid forty
    times an hour is muscle memory inside a week.
  */
  return (
    <button
      type="button"
      data-testid="customer-row"
      onClick={onOpen}
      className="flex h-[var(--size-control)] w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left font-semibold text-content hover:bg-surface-raised focus-visible:focus-ring"
    >
      {customer === null ? (
        <>
          <UserRoundPlus aria-hidden size={18} className="shrink-0 text-content-muted" />
          <span className="text-content-muted">Enter Customer Info</span>
        </>
      ) : (
        <>
          <UserRound aria-hidden size={18} className="shrink-0 text-primary" />
          {customer.kind === 'identified' && customer.tier === 'gold' ? (
            /*
              The member's star, beside the name it belongs to rather than at
              the end of the number (a-gold-member-is-a-label). The name is the
              part that gives way on a narrow panel; the star and the number
              stay whole.
            */
            <>
              {customer.name !== '' && <span className="truncate">{customer.name}</span>}{' '}
              <MemberMark />
              <span className="shrink-0">
                {customer.name !== '' && '· '}+91 {formatIndianPhone(customer.phone)}
              </span>
            </>
          ) : (
            <span className="truncate">{customerRowLabel(customer)}</span>
          )}
        </>
      )}
    </button>
  )
}
