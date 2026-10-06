import { Delete, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { isTableNumber, MAX_TABLE_NUMBER, tableLabel } from '@/domain'

/** A table somebody is already sitting at, as the pad needs to know it. */
export interface BusyTable {
  /** The open order on that table, for opening it from the refusal. */
  orderId: string
  /** The other tablet's label, where it could be read. */
  tillLabel: string | null
  /** Whether this tablet took that order. */
  ownedHere: boolean
}

/** Digits, then nought centred beneath them, as the customer keypad has it. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** Three digits: 1 to 999 [owner, 2026-09-27]. */
const TABLE_DIGITS = String(MAX_TABLE_NUMBER).length

/**
 * Which table: a number pad, opened the way the customer keypad opens
 * [owner, 2026-09-27].
 *
 * **Any number, keyed.** There is no count of tables to keep up to date as the
 * floor changes, and no grid of buttons to hunt along: the biller keys the
 * number on the table, one to three digits, with no decimal point and no `00`.
 *
 * **A table that already has an open order is refused, in red**, the way an
 * invalid mobile number is: the number itself turns red and one line says why.
 * More food for that table goes on its order, and *Edit here.* beside the refusal
 * opens it exactly as its card's Edit does [owner, 2026-09-27]: the bill in
 * progress is set aside and comes back afterwards. Busy is what the
 * tablet can see — the live pipeline, or the one it remembers offline — so two
 * tablets may still seat one table without seeing each other; the database
 * records both and the rail marks them *1 of 2*, *2 of 2* (design D5).
 *
 * *No table* keeps the order dine-in without one.
 */
export function TableDialog(props: {
  open: boolean
  /** The table this order has now, if any. Never refused as busy. */
  currentTable: number | null
  busy: ReadonlyMap<number, BusyTable>
  onChoose: (table: number) => void
  onNoTable: () => void
  /**
   * Open the busy table's order for editing. Absent while another order is
   * being edited — opening a second would abandon the first — and then the
   * line says what to do rather than offering to do it.
   */
  onOpenOrder?: ((orderId: string) => void) | undefined
  onClose: () => void
}) {
  if (!props.open) return null
  return <OpenTableDialog {...props} />
}

function OpenTableDialog({
  currentTable,
  busy,
  onChoose,
  onNoTable,
  onOpenOrder,
  onClose,
}: {
  currentTable: number | null
  busy: ReadonlyMap<number, BusyTable>
  onChoose: (table: number) => void
  onNoTable: () => void
  onOpenOrder?: ((orderId: string) => void) | undefined
  onClose: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [digits, setDigits] = useState(currentTable === null ? '' : String(currentTable))

  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const table = digits === '' ? null : Number(digits)
  const occupant = table !== null && table !== currentTable ? busy.get(table) : undefined
  const refused = occupant !== undefined
  const canConfirm = table !== null && isTableNumber(table) && !refused

  function append(key: string) {
    setDigits((current) => {
      // Never a leading nought: table 0 does not exist, and `07` is table 7.
      if (current === '' && key === '0') return current
      return current.length >= TABLE_DIGITS ? current : `${current}${key}`
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label="Which table"
      className="m-auto w-[min(94vw,22rem)] rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-black text-content outline-none">
          Which table?
        </h2>
        <Button
          variant="ghost"
          size="phone"
          className="-mr-2 -mt-1 w-10 shrink-0 px-0"
          aria-label="Close without choosing"
          data-testid="table-dismiss"
          onClick={onClose}
        >
          <X aria-hidden size={18} />
        </Button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canConfirm && table !== null) onChoose(table)
        }}
      >
        <p
          className="mt-2 text-center text-3xl font-black tabular-nums text-content"
          data-testid="table-readout"
        >
          {/* The word stands in for a placeholder, as +91 does on the phone pad. */}
          <span className="text-content-muted">Table</span>{' '}
          <span className={refused ? 'text-danger' : undefined}>{digits}</span>
        </p>

        {/* A line tall, so the pad does not jump when a refusal appears. */}
        <div className="mt-2 min-h-6" data-testid="table-resolution">
          {refused && table !== null && (
            /*
              One line, read in a glance at a busy counter [owner, 2026-09-27]:
              what is wrong, in red, and — where this tablet can act on it — a
              way to that table's order. More food for an open table goes on it.
            */
            <p
              role="alert"
              data-testid="table-busy"
              className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm font-bold"
            >
              <span className="flex items-center gap-1.5 text-danger">
                <TriangleAlert aria-hidden size={16} className="shrink-0" />
                {occupant.ownedHere
                  ? `${tableLabel(table)} is already open.`
                  : `${tableLabel(table)} is open on ${occupant.tillLabel ?? 'another tablet'}.`}
              </span>{' '}
              {occupant.ownedHere && onOpenOrder && (
                <button
                  type="button"
                  data-testid="table-open-order"
                  onClick={() => onOpenOrder(occupant.orderId)}
                  className="cursor-pointer rounded-sm text-accent-text underline underline-offset-2 focus-visible:focus-ring"
                >
                  Edit here.
                </button>
              )}
            </p>
          )}
        </div>

        <div className="mx-auto mt-2 grid w-[13rem] grid-cols-3 gap-2" aria-label="Table keypad">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="control"
              className="min-w-0 px-0 text-lg"
              disabled={digits.length >= TABLE_DIGITS}
              data-keypad-key={key}
              onClick={() => append(key)}
            >
              {key}
            </Button>
          ))}
          {/* An empty cell keeps nought centred: there is no `00` or `.` here. */}
          <span aria-hidden />
          <Button
            variant="secondary"
            size="control"
            className="min-w-0 px-0 text-lg"
            disabled={digits === '' || digits.length >= TABLE_DIGITS}
            data-keypad-key="0"
            onClick={() => append('0')}
          >
            0
          </Button>
          <Button
            variant="secondary"
            size="control"
            className="min-w-0 px-0"
            aria-label="Delete last digit"
            data-keypad-key="Backspace"
            disabled={digits === ''}
            onClick={() => setDigits((current) => current.slice(0, -1))}
          >
            <Delete aria-hidden size={18} />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="control" data-testid="table-none" onClick={onNoTable}>
            No table
          </Button>
          <Button
            type="submit"
            size="control"
            disabled={!canConfirm}
            data-testid="table-confirm"
            data-keypad-key="Enter"
          >
            Done
          </Button>
        </div>
      </form>
    </Modal>
  )
}
