import { Check, ListPlus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { billTotals } from '@/domain'
import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'

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
 * and two customer name fields sharing one id, which is a worse bug than
 * whichever layout problem tempted anyone into it.
 *
 * Either customer name or phone is required by this UI trial. The database keeps
 * both nullable so the owner can reverse the trial without a migration.
 */
export function BillComposerFooter({
  lines,
  customerName,
  customerPhone,
  settling,
  editing,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onPaid,
  onSaveOrder,
  onCancelEdit,
}: {
  lines: BillLineDraft[]
  customerName: string
  customerPhone: string
  settling: boolean
  editing: boolean
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onPaid: () => void
  onSaveOrder: () => void
  onCancelEdit?: (() => void) | undefined
}) {
  const totals = billTotals(
    lines.map((line) => ({ unitPricePaise: line.unitPricePaise, quantity: line.quantity })),
  )

  /*
    A phone that is not a phone is worse than no phone at all: it is PII written
    wrong, it will never match this customer again, and `customers.createOrGet`
    quietly declines to save it — so without this the biller is told nothing and
    the number lands on the bill anyway. Canonicalised by the same `shared/phone`
    rule the database uses, so the form and the far end cannot disagree.
  */
  const phone = validateIndianPhone(customerPhone)
  const typedPhone = customerPhone.trim() !== ''
  const phoneIsBad = typedPhone && phone.error !== null

  // Reported on blur, not on every keystroke: a number is incomplete for the
  // first nine digits of typing it, and a red line that appears while somebody is
  // still typing teaches them to ignore red lines.
  const [phoneBlurred, setPhoneBlurred] = useState(false)
  const showPhoneError = phoneIsBad && phoneBlurred

  const hasCustomerIdentity = customerName.trim() !== '' || phone.phone !== null
  const canComplete = !settling && lines.length > 0 && hasCustomerIdentity && !phoneIsBad

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

      <div className="grid grid-cols-2 gap-2">
        <label className="sr-only" htmlFor="customer-name">
          Customer name
        </label>
        <Input
          id="customer-name"
          className="h-11"
          autoComplete="off"
          placeholder="Customer name"
          aria-describedby={
            lines.length > 0 && !hasCustomerIdentity ? 'customer-requirement' : undefined
          }
          value={customerName}
          onChange={(event) => onCustomerNameChange(event.target.value)}
        />
        <label className="sr-only" htmlFor="customer-phone">
          Customer phone
        </label>
        <Input
          id="customer-phone"
          className="h-11"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="Phone number"
          aria-invalid={showPhoneError || undefined}
          aria-describedby={
            showPhoneError
              ? 'customer-phone-error'
              : lines.length > 0 && !hasCustomerIdentity
                ? 'customer-requirement'
                : undefined
          }
          value={customerPhone}
          onChange={(event) => onCustomerPhoneChange(event.target.value)}
          onBlur={() => setPhoneBlurred(true)}
          onFocus={() => setPhoneBlurred(false)}
        />
      </div>

      {showPhoneError && (
        <p
          id="customer-phone-error"
          data-testid="customer-phone-error"
          className="text-xs font-semibold text-danger"
        >
          {phoneErrorMessage(phone.error!)}
        </p>
      )}

      {!showPhoneError && lines.length > 0 && !hasCustomerIdentity && (
        <p id="customer-requirement" className="text-xs font-semibold text-danger">
          Add a customer name or phone to continue.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Button
          size="control"
          className="w-full text-lg"
          disabled={!canComplete}
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
            disabled={!canComplete}
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
