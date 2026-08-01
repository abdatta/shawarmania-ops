import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { monthRange, shiftMonthRange, type DateRange } from './attendance-range'

/**
 * Which month to read.
 *
 * **A month, and nothing else.** This control used to carry the arrows *and* a
 * pair of date inputs, so the surface held two definitions of "the period". The
 * loose one is the one that had to go, for three reasons that all point the same
 * way: the tally underneath counts days so somebody can work out pay by hand and
 * pay is monthly; every derived absence in the list is computed from the range's
 * bounds, so an arbitrary span produces an arbitrary absence count that reads
 * exactly like a meaningful one; and on the phone this is held on, two date
 * inputs were half the control's height for the rarer use.
 *
 * `DateRange` is unchanged — the type still describes a span and the assembler
 * still walks one. What went is the control that could produce a span that is
 * not a month, so restoring a free range later is re-adding two inputs rather
 * than re-deriving a model.
 *
 * The same control serves the manager's by-staff view and a person's own
 * history, because those two must never disagree about a day.
 */
export function RangePicker({
  range,
  today,
  onChange,
}: {
  range: DateRange
  /** The outlet's own today, so the month cannot be walked into the future. */
  today: string
  onChange: (range: DateRange) => void
}) {
  const thisMonth = monthRange(today)
  const label = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${range.from}T00:00:00Z`))

  return (
    <div
      data-testid="range-picker"
      className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2"
    >
      <Button
        variant="ghost"
        size="phone"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonthRange(range, -1))}
      >
        <ChevronLeft aria-hidden size={18} />
      </Button>
      <span data-testid="range-label" className="text-sm font-semibold text-content">
        {label}
      </span>
      <Button
        variant="ghost"
        size="phone"
        aria-label="Next month"
        disabled={range.to >= thisMonth.to}
        onClick={() => onChange(shiftMonthRange(range, 1))}
      >
        <ChevronRight aria-hidden size={18} />
      </Button>
    </div>
  )
}
