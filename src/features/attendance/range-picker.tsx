import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { monthRange, shiftMonthRange, type DateRange } from './attendance-range'

/**
 * Pick the span of days to read.
 *
 * A month at a time is what a manager asks for, so the arrows move by month and
 * the label says which. The two dates underneath are what makes it "any range":
 * a fortnight, a single week, or the eleven days somebody actually worked before
 * they left. One control, both behaviours, and the same one on the manager's
 * person view and on a person's own history — because those two must never
 * disagree about a day.
 */
export function RangePicker({
  range,
  today,
  onChange,
}: {
  range: DateRange
  /** The outlet's own today, so the range cannot be walked into the future. */
  today: string
  onChange: (range: DateRange) => void
}) {
  const thisMonth = monthRange(today)
  const label = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${range.from}T00:00:00Z`))
  // A whole calendar month is what the arrows produce, so the arrows only claim
  // to be showing a month when the dates still say one.
  const wholeMonth = range.from === monthRange(range.from).from && range.to === thisMonthEnd(range)

  return (
    <div
      data-testid="range-picker"
      className="mb-3 space-y-2 rounded-xl border border-border bg-surface p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="phone"
          aria-label="Previous month"
          onClick={() => onChange(shiftMonthRange(range, -1))}
        >
          <ChevronLeft aria-hidden size={18} />
        </Button>
        <span data-testid="range-label" className="text-sm font-semibold text-content">
          {wholeMonth ? label : `${range.from} to ${range.to}`}
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
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs text-content-muted">
          From
          <Input
            type="date"
            aria-label="Range starts"
            value={range.from}
            max={range.to}
            onChange={(event) =>
              event.target.value && onChange({ ...range, from: event.target.value })
            }
          />
        </label>
        <label className="flex-1 text-xs text-content-muted">
          To
          <Input
            type="date"
            aria-label="Range ends"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(event) =>
              event.target.value && onChange({ ...range, to: event.target.value })
            }
          />
        </label>
      </div>
    </div>
  )
}

function thisMonthEnd(range: DateRange): string {
  return monthRange(range.from).to
}
