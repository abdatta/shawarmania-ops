import { Banknote, Delete, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Money } from '@/components/ui/money'
import type { PaymentAllocation, PaymentMethod } from '@/data-access/adapters'

const METHODS: { method: PaymentMethod; label: string }[] = [
  { method: 'cash', label: 'Cash' },
  { method: 'upi', label: 'UPI' },
  { method: 'swiggy', label: 'Swiggy' },
  { method: 'zomato', label: 'Zomato' },
]

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'] as const
const NO_PAYMENTS: PaymentAllocation[] = []

function labelFor(method: PaymentMethod) {
  return METHODS.find((candidate) => candidate.method === method)!.label
}

/** Tap-first exact tender capture shared by direct bills and saved orders. */
type PaymentDialogProps = {
  open: boolean
  totalPaise: number
  initialPayments?: PaymentAllocation[]
  busy?: boolean
  onClose: () => void
  onConfirm: (payments: PaymentAllocation[]) => void
}

export function PaymentDialog(props: PaymentDialogProps) {
  if (!props.open) return null
  return <OpenPaymentDialog {...props} />
}

function OpenPaymentDialog({
  totalPaise,
  initialPayments = NO_PAYMENTS,
  busy = false,
  onClose,
  onConfirm,
}: PaymentDialogProps) {
  const [payments, setPayments] = useState<PaymentAllocation[]>(() => initialPayments)
  const [digits, setDigits] = useState('')
  const allocatedPaise = useMemo(
    () => payments.reduce((sum, payment) => sum + payment.amountPaise, 0),
    [payments],
  )
  const remainingPaise = totalPaise - allocatedPaise
  const keyedPaise = digits ? Number(digits) * 100 : 0

  function allocate(method: PaymentMethod) {
    const amountPaise = digits ? keyedPaise : remainingPaise
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > remainingPaise)
      return
    setPayments((current) => {
      const existing = current.find((payment) => payment.method === method)
      if (!existing) return [...current, { method, amountPaise }]
      return current.map((payment) =>
        payment.method === method
          ? { ...payment, amountPaise: payment.amountPaise + amountPaise }
          : payment,
      )
    })
    setDigits('')
  }

  function appendDigit(value: string) {
    setDigits((current) => {
      const next = `${current}${value}`.replace(/^0+(?=\d)/, '').slice(0, 7)
      return Number(next || '0') * 100 <= remainingPaise ? next : current
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label="Record payment"
      className="m-auto w-[min(94vw,30rem)] rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-content">Record payment</h2>
          <p className="text-sm text-content-muted">
            Tap a method for the full balance, or key an amount first to split it.
          </p>
        </div>
        <Money paise={totalPaise} display className="shrink-0" />
      </div>

      {payments.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Payment split">
          {payments.map((payment) => (
            <li
              key={payment.method}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-raised px-3"
            >
              <span className="flex-1 font-bold text-content">{labelFor(payment.method)}</span>
              <Money paise={payment.amountPaise} className="font-bold" />
              <Button
                variant="secondary"
                size="phone"
                className="w-10 px-0"
                aria-label={`Remove ${labelFor(payment.method)} payment`}
                onClick={() =>
                  setPayments((current) =>
                    current.filter((candidate) => candidate.method !== payment.method),
                  )
                }
              >
                <Trash2 aria-hidden size={17} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div>
          <div className="mb-2 rounded-xl border border-border bg-surface-raised p-3 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-content-muted">
              {digits ? 'Amount to add' : 'Balance left'}
            </p>
            <Money paise={digits ? keyedPaise : remainingPaise} display />
          </div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Payment methods">
            {METHODS.map(({ method, label }) => (
              <Button
                key={method}
                variant={method === 'cash' ? 'primary' : 'secondary'}
                size="phone"
                disabled={remainingPaise === 0 || (digits !== '' && keyedPaise === 0)}
                onClick={() => allocate(method)}
              >
                {method === 'cash' && <Banknote aria-hidden size={17} />}
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1" aria-label="Amount keypad">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="phone"
              className="min-w-0 px-0 text-lg"
              disabled={remainingPaise === 0}
              onClick={() => appendDigit(key)}
            >
              {key}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0"
            aria-label="Delete last digit"
            disabled={!digits}
            onClick={() => setDigits((current) => current.slice(0, -1))}
          >
            <Delete aria-hidden size={18} />
          </Button>
        </div>
      </div>

      {digits && keyedPaise > remainingPaise && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          That is more than the balance left.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="control" onClick={onClose}>
          Back
        </Button>
        <Button
          size="control"
          disabled={busy || totalPaise <= 0 || remainingPaise !== 0}
          onClick={() => onConfirm(payments)}
        >
          Mark Paid
        </Button>
      </div>
    </Modal>
  )
}
