import { Delete } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { BillDiscountDraft, DiscountPreset } from '@/data-access/adapters'
import { formatPaise, rupeesToPaise } from '@/domain'

/**
 * Adding a discount to the order in front of you.
 *
 * Built from the same parts as the tender dialog on purpose: the counter learns
 * one interaction, not two. What differs from it is deliberate, and every
 * difference is the owner's [owner, 2026-09-03]:
 *
 * - **The readout starts at nought and carries its unit**, so the panel is never
 *   ambiguous about what is being typed.
 * - **The unit switches on a tap without clearing the entry.** Typing `15` and
 *   then deciding between % and ₹ is how somebody actually decides.
 * - **A decimal point replaces `00`.** `00` earns its place on a tender pad
 *   where amounts are round hundreds; here it earns nothing.
 * - **Nought sits centre, the decimal left, backspace right**, so the pad reads
 *   as a keypad rather than as a calculator.
 * - **No resulting total is shown.** A discount is not set by aiming at a final
 *   amount, so a running total would answer a question nobody is asking.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function DiscountDialog(props: {
  open: boolean
  /** The discount being edited, or null when adding a new one. */
  editing: BillDiscountDraft | null
  /** The outlet's configured presets, each carrying its own unit. */
  presets: readonly DiscountPreset[]
  busy?: boolean
  onClose: () => void
  onConfirm: (discount: BillDiscountDraft) => void
}) {
  if (!props.open) return null
  return <OpenDiscountDialog {...props} />
}

function OpenDiscountDialog({
  editing,
  presets,
  busy = false,
  onClose,
  onConfirm,
}: {
  editing: BillDiscountDraft | null
  presets: readonly DiscountPreset[]
  busy?: boolean
  onClose: () => void
  onConfirm: (discount: BillDiscountDraft) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [basis, setBasis] = useState<'percent' | 'amount'>(editing?.basis ?? 'percent')
  const [typed, setTyped] = useState(() => {
    if (!editing) return ''
    return editing.basis === 'percent'
      ? String((editing.valueBp ?? 0) / 100)
      : String((editing.valuePaise ?? 0) / 100)
  })

  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const numeric = Number(typed || '0')
  const valid = Number.isFinite(numeric) && numeric > 0 && (basis !== 'percent' || numeric <= 100)

  function append(key: string) {
    setTyped((current) => {
      // One decimal point, and never a leading run of noughts.
      if (key === '.' && current.includes('.')) return current
      const next = `${current}${key}`
      const [, fraction = ''] = next.split('.')
      if (fraction.length > 2) return current
      return next.replace(/^0+(?=\d)/, '').slice(0, 8)
    })
  }

  function confirm() {
    if (!valid) return
    onConfirm(
      basis === 'percent'
        ? {
            basis: 'percent',
            // Basis points, so a fractional percentage never becomes a float in
            // the money path.
            valueBp: Math.round(numeric * 100),
            valuePaise: null,
            // Resolved against the order by the caller, which is the only place
            // that knows the subtotal.
            amountPaise: 0,
          }
        : { basis: 'amount', valueBp: null, valuePaise: rupeesToPaise(numeric), amountPaise: 0 },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label={editing ? 'Edit discount' : 'Add discount'}
      className="m-auto w-[min(94vw,30rem)] rounded-2xl p-4"
    >
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-black text-content outline-none">
        {editing ? 'Edit discount' : 'Add discount'}
      </h2>

      {/*
        The tender dialog's own two columns, to the pixel: what is being decided
        on the left, the keypad in its own 7rem column on the right. Stacking
        them instead made the panel a tall list of unrelated rows, where the
        presets and the unit toggle read as more keypad. Same grid, same gap,
        same key sizing — the counter learns one shape and uses it twice.
      */}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div>
          <div
            className="mb-2 rounded-xl border border-border bg-surface-raised p-3 text-center"
            data-testid="discount-readout"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-content-muted">Discount</p>
            <span data-numeric="" className="font-display text-3xl leading-none text-content">
              {basis === 'percent' ? `${typed || '0'}%` : `₹${typed || '0'}`}
            </span>
          </div>

          {presets.length > 0 && (
            <div
              className="mb-2 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}
              role="group"
              aria-label="Discount presets"
            >
              {presets.map((preset) => (
                <Button
                  key={`${preset.basis}-${preset.value}`}
                  variant="secondary"
                  size="phone"
                  className="min-w-0 px-0"
                  data-testid={`discount-preset-${preset.basis}-${preset.value}`}
                  // A preset carries its unit, so tapping one sets both — a
                  // rupee preset that landed in the percent field would be a
                  // hundredfold mistake in the customer's favour.
                  onClick={() => {
                    setBasis(preset.basis)
                    setTyped(String(preset.value / 100))
                  }}
                >
                  {preset.basis === 'percent'
                    ? `${preset.value / 100}%`
                    : formatPaise(preset.value)}
                </Button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Discount unit">
            {(['percent', 'amount'] as const).map((option) => (
              <Button
                key={option}
                variant={basis === option ? 'primary' : 'secondary'}
                size="phone"
                aria-pressed={basis === option}
                data-testid={`discount-unit-${option}`}
                // Switching keeps whatever is typed: deciding between the two
                // after entering the number is the ordinary way round.
                onClick={() => setBasis(option)}
              >
                {option === 'percent' ? '%' : '₹'}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1" aria-label="Discount keypad">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="phone"
              className="min-w-0 px-0 text-lg"
              onClick={() => append(key)}
            >
              {key}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0 text-lg"
            aria-label="Decimal point"
            onClick={() => append('.')}
          >
            .
          </Button>
          {/* Nought stays centre, so the pad reads as a keypad and not a calculator. */}
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0 text-lg"
            onClick={() => append('0')}
          >
            0
          </Button>
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0"
            aria-label="Delete last digit"
            disabled={!typed}
            onClick={() => setTyped((current) => current.slice(0, -1))}
          >
            <Delete aria-hidden size={18} />
          </Button>
        </div>
      </div>

      {basis === 'percent' && numeric > 100 && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          A discount cannot be more than 100%.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="control" onClick={onClose}>
          Back
        </Button>
        <Button
          size="control"
          disabled={busy || !valid}
          data-testid="apply-discount"
          onClick={confirm}
        >
          Apply
        </Button>
      </div>
    </Modal>
  )
}
