import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { periodDays, shiftDate, validAnalyticsDate } from '@/domain/sales-analytics'
import { shortDate } from './analytics-utils'

export function AnalyticsRange({
  from,
  to,
  today,
  onChange,
}: {
  from: string
  to: string
  today: string | null
  onChange: (next: { from: string; to: string; grain?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [anchor, setAnchor] = useState<'from' | 'to' | 'custom' | null>(null)
  const [span, setSpan] = useState(7)
  const valid = validAnalyticsDate(from) && validAnalyticsDate(to) && to >= from
  const draftValid =
    validAnalyticsDate(draftFrom) &&
    validAnalyticsDate(draftTo) &&
    draftTo >= draftFrom &&
    !!today &&
    draftTo <= today &&
    periodDays(draftFrom, draftTo) <= 92
  function editDate(field: 'from' | 'to', date: string) {
    if (date === (field === 'from' ? draftFrom : draftTo)) return
    if (field === 'from') setDraftFrom(date)
    else setDraftTo(date)
    if (anchor === null || anchor === field) {
      setAnchor(field)
      if (field === 'from') setDraftTo(shiftDate(date, span - 1))
      else setDraftFrom(shiftDate(date, 1 - span))
    } else setAnchor('custom')
  }
  return (
    <>
      <PeriodBar
        label="period"
        testIdPrefix="analytics"
        canStepForward={!!today && valid && shiftDate(to, periodDays(from, to)) <= today}
        onStep={(by) => {
          if (valid) {
            const step = by * periodDays(from, to)
            onChange({ from: shiftDate(from, step), to: shiftDate(to, step) })
          }
        }}
      >
        <Button
          variant="ghost"
          size="phone"
          className="min-w-0 flex-1 px-1"
          aria-label="Choose dates"
          disabled={!today}
          onClick={() => {
            const useRange = valid && periodDays(from, to) <= 92 && to <= today!
            setDraftFrom(useRange ? from : shiftDate(today!, -6))
            setDraftTo(useRange ? to : today!)
            setSpan(useRange ? periodDays(from, to) : 7)
            setAnchor(null)
            setOpen(true)
          }}
        >
          <CalendarDays size={16} aria-hidden />
          <span>
            {shortDate(from)} – {shortDate(to)}
          </span>
        </Button>
      </PeriodBar>
      <div className="flex items-center gap-1" role="group" aria-label="Date shortcuts">
        {[1, 7, 30].map((n) => (
          <Button
            key={n}
            size="phone"
            variant="ghost"
            className={`flex-1 px-2 ${today && to === today && from === shiftDate(today, 1 - n) ? 'bg-surface-raised text-accent-text' : 'text-content-muted'}`}
            aria-label={`Last ${n} ${n === 1 ? 'day' : 'days'}`}
            aria-pressed={!!today && to === today && from === shiftDate(today, 1 - n)}
            disabled={!today}
            onClick={() => {
              // A day reads best by hour, a week or a month by day [owner, 2026-10-10].
              if (today)
                onChange({
                  from: shiftDate(today, 1 - n),
                  to: today,
                  grain: n === 1 ? 'hour' : 'day',
                })
            }}
          >
            {n}d
          </Button>
        ))}
      </div>
      <FormSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Dates"
        footer={
          <Button
            className="w-full"
            disabled={!draftValid}
            onClick={() => {
              onChange({ from: draftFrom, to: draftTo })
              setOpen(false)
            }}
          >
            Apply dates
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm text-content-muted">From</p>
            <div className="rounded-xl border border-border">
              <DayField
                businessDate={draftFrom}
                today={today ?? ''}
                earliest="0001-01-01"
                testIdPrefix="analytics-from"
                onChange={(date) => editDate('from', date)}
              />
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm text-content-muted">To</p>
            <div className="rounded-xl border border-border">
              <DayField
                businessDate={draftTo}
                today={today ?? ''}
                earliest="0001-01-01"
                testIdPrefix="analytics-to"
                onChange={(date) => editDate('to', date)}
              />
            </div>
          </div>
          <p className="text-xs text-content-muted">1–92 days · Kolkata business dates</p>
          {!draftValid && (
            <p role="alert" className="text-sm text-danger">
              Choose a valid range of 1–92 days ending on or before today.
            </p>
          )}
        </div>
      </FormSheet>
    </>
  )
}
