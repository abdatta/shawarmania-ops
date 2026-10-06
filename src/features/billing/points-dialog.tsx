import { Delete } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { formatPaise, POINT_VALUE_PAISE } from '@/domain'

/**
 * Using the customer's points on the order in front of you
 * (a-regular-earns-points-and-gold, #62).
 *
 * The discount panel's own shape — readout and choices on the left, keypad in
 * its 7rem column on the right — so the counter learns one interaction. It
 * **opens on the most allowed** [owner, 2026-09-28]: using as much as the
 * outlet's cap lets is the ordinary case, and the biller lowers it only when
 * the customer asks to keep some.
 *
 * The most allowed is worked out by the counter (`pointsUsableMax`): the
 * balance just read, the outlet's cap over the order after other discounts —
 * the gold cap for a gold member — and never the last rupee. Whole points; one
 * point is one rupee.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function PointsDialog(props: {
  open: boolean
  /** The order after every other discount: what the points are a share of. */
  netPaise: number
  /** The outlet's cap for this customer, as a percentage: 10, or 50 for gold. */
  capPercent: number
  /** Their balance here, as the server just gave it. */
  balance: number
  /** The most this order may take. */
  max: number
  /** Points already on the order, when editing them. */
  current: number | null
  busy?: boolean
  onClose: () => void
  onConfirm: (points: number) => void
}) {
  if (!props.open) return null
  return <OpenPointsDialog {...props} />
}

function OpenPointsDialog({
  netPaise,
  capPercent,
  balance,
  max,
  current,
  busy = false,
  onClose,
  onConfirm,
}: {
  netPaise: number
  capPercent: number
  balance: number
  max: number
  current: number | null
  busy?: boolean
  onClose: () => void
  onConfirm: (points: number) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [typed, setTyped] = useState(() => String(current ?? max))

  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const points = Number(typed || '0')
  const valid = Number.isInteger(points) && points >= 1 && points <= max

  function append(key: string) {
    setTyped((value) => `${value}${key}`.replace(/^0+(?=\d)/, '').slice(0, 6))
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label={current === null ? 'Use points' : 'Change points'}
      className="m-auto w-[min(94vw,30rem)] rounded-2xl p-4"
    >
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-black text-content outline-none">
        {current === null ? 'Use points' : 'Change points'}
      </h2>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div className="space-y-2">
          <div
            className="rounded-xl border border-border bg-surface-raised p-3 text-center"
            data-testid="points-readout"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-content-muted">Points</p>
            <span data-numeric="" className="font-display text-3xl leading-none text-content">
              {typed || '0'}
            </span>
            {/*
              Too many says so here, under the number that is wrong, in place
              of what it would take off [owner, 2026-09-29].
            */}
            {points > max ? (
              <p role="alert" className="mt-1 text-sm font-semibold text-danger">
                At most {max} on this bill
              </p>
            ) : (
              <p className="mt-1 text-sm font-semibold text-content-muted">
                {formatPaise((points || 0) * POINT_VALUE_PAISE)} off
              </p>
            )}
          </div>
          {/*
            Two figures rather than a sentence [owner, 2026-09-29]: what they
            hold, and what this bill can take. Neither is a control: the pad
            opens on the max, and any other number is typed [owner, 2026-09-29,
            after a clickable Max and a one-tap *Use max* were both tried and
            dropped as more than the counter needs].
          */}
          <div className="grid grid-cols-2 gap-2" data-testid="points-limits">
            <div className="rounded-lg bg-surface-raised px-3 py-2">
              <p className="text-xs font-semibold text-content-muted">Balance</p>
              <p className="text-lg font-bold tabular-nums text-content">{balance}</p>
            </div>
            <div className="rounded-lg bg-surface-raised px-3 py-2" data-testid="points-max">
              <p className="text-xs font-semibold text-content-muted">Max this bill</p>
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tabular-nums text-content">{max}</span>
                {netPaise > 0 && (
                  <span className="text-xs font-semibold text-accent-text">
                    {offPercent({ max, balance, capPercent, netPaise })}% off
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1" aria-label="Points keypad">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="phone"
              className="min-w-0 px-0 text-lg"
              data-keypad-key={key}
              onClick={() => append(key)}
            >
              {key}
            </Button>
          ))}
          <span aria-hidden />
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0 text-lg"
            data-keypad-key="0"
            onClick={() => append('0')}
          >
            0
          </Button>
          <Button
            variant="secondary"
            size="phone"
            className="min-w-0 px-0"
            aria-label="Delete last digit"
            data-keypad-key="Backspace"
            disabled={!typed}
            onClick={() => setTyped((value) => value.slice(0, -1))}
          >
            <Delete aria-hidden size={18} />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="control" onClick={onClose}>
          Back
        </Button>
        <Button
          size="control"
          disabled={busy || !valid}
          data-testid="apply-points"
          data-keypad-key="Enter"
          onClick={() => onConfirm(points)}
        >
          Use points
        </Button>
      </div>
    </Modal>
  )
}

/**
 * The percentage beside the most allowed [owner, 2026-09-29]. Where the
 * outlet's cap is what stops it — 10% of ₹139 is ₹13.90, and points are whole
 * rupees, so 13 — it is the cap itself, which is what the biller set and
 * expects to read. Where the balance stops it first, it is the share of the
 * bill the balance actually pays. Never nought while points are used.
 */
function offPercent(input: {
  max: number
  balance: number
  capPercent: number
  netPaise: number
}): number {
  if (input.max < input.balance) return input.capPercent
  const share = Math.round((input.max * POINT_VALUE_PAISE * 100) / input.netPaise)
  return input.max > 0 ? Math.max(1, Math.min(share, input.capPercent)) : 0
}
