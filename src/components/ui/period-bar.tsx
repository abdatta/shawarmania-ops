import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { formatBusinessDate } from '@/domain'

/**
 * Which period a surface is about, and the steps either side of it.
 *
 * Built for the manual ledger and moved here when billing history wanted the
 * same bar. The move is the point, and it paid off: `features/manual-ledger` was
 * a stopgap, its whole folder went when `retire-the-manual-ledger` (#12) landed,
 * and the surfaces that outlived it kept this control because it had already
 * stopped living there.
 *
 * The shape is the attendance range picker's, deliberately: a bordered strip, a
 * step at each end, and the period itself in the middle. Surfaces that ask
 * "which day" should look like each other, because they are asking the same
 * question and a second idiom for it would be a second thing to learn.
 *
 * Forward stops where the caller says it does. Every caller so far stops at the
 * outlet's own today, because the database refuses a future business date and a
 * control that offers one is offering a failure.
 */
export function PeriodBar({
  label,
  testIdPrefix,
  onStep,
  canStepForward,
  children,
}: {
  label: string
  /**
   * Names this bar's test ids — `<prefix>-period`, `<prefix>-step-back`,
   * `<prefix>-step-forward`. The surface owns the names rather than the
   * component, so two surfaces can hold one of these each and both stay
   * addressable.
   */
  testIdPrefix: string
  onStep: (by: number) => void
  canStepForward: boolean
  children: ReactNode
}) {
  const what = label.toLowerCase()
  return (
    <div
      data-testid={`${testIdPrefix}-period`}
      className="flex items-center justify-between gap-1 rounded-xl border border-border bg-surface p-1"
    >
      <Button
        variant="ghost"
        size="phone"
        aria-label={`Previous ${what}`}
        data-testid={`${testIdPrefix}-step-back`}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft aria-hidden size={18} />
      </Button>
      {children}
      <Button
        variant="ghost"
        size="phone"
        aria-label={`Next ${what}`}
        disabled={!canStepForward}
        data-testid={`${testIdPrefix}-step-forward`}
        onClick={() => onStep(1)}
      >
        <ChevronRight aria-hidden size={18} />
      </Button>
    </div>
  )
}

/**
 * The day, written the way every other surface writes a day, and changed only by
 * the calendar or by the steps either side of it.
 *
 * A bare `input type="date"` was wrong on three counts: it prints the browser's
 * locale format (`03-08-2026`) where the rest of the app writes `03 Aug 2026`, it
 * carries its own calendar glyph beside two step buttons that already say what this
 * control does, and it invites typing — and a date half-typed into a control that
 * reloads a day on every change is a reload per keystroke.
 *
 * So the visible control is a button and the native input sits behind it,
 * unfocusable and hidden from the accessibility tree, purely to own the platform
 * calendar. `showPicker()` needs the click that called it, which is exactly what it
 * gets. Where it does not exist — jsdom, an old browser — the steps and the
 * keyboard still reach every day the control admits.
 */
export function DayField({
  businessDate,
  today,
  earliest,
  testIdPrefix,
  onChange,
}: {
  businessDate: string
  today: string
  earliest: string
  /** Names `<prefix>-day-open` and `<prefix>-day-picker`. See `PeriodBar`. */
  testIdPrefix: string
  onChange: (businessDate: string) => void
}) {
  const native = useRef<HTMLInputElement>(null)
  // "Today" rather than the date, as the attendance day heading does it. The card
  // below always carries the full date, so nothing is hidden by the shorthand.
  const label = businessDate === today ? 'Today' : formatBusinessDate(businessDate)

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={`Day — ${formatBusinessDate(businessDate)}. Opens a calendar.`}
        data-testid={`${testIdPrefix}-day-open`}
        onClick={() => native.current?.showPicker?.()}
        className="h-[var(--size-control-phone)] w-full truncate rounded-lg px-2 font-semibold text-content hover:bg-surface-raised focus-visible:focus-ring"
      >
        {label}
      </button>
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        data-testid={`${testIdPrefix}-day-picker`}
        value={businessDate}
        min={earliest}
        // The outlet's own today, through its cutover: the database refuses a
        // future business date, so the calendar must not offer one.
        max={today}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
        // Rendered rather than `display: none`, because `showPicker()` on an
        // unrendered input throws — and invisible and untappable, because the
        // button above it is the control.
        className="pointer-events-none absolute inset-0 size-full opacity-0"
      />
    </div>
  )
}
