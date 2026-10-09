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
  onChange: (next: { from: string; to: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const valid = validAnalyticsDate(from) && validAnalyticsDate(to) && to >= from
  const draftValid =
    validAnalyticsDate(draftFrom) &&
    validAnalyticsDate(draftTo) &&
    draftTo >= draftFrom &&
    periodDays(draftFrom, draftTo) <= 92
  return (
    <>
      <PeriodBar
        label="period"
        testIdPrefix="analytics"
        canStepForward={!!today && valid && shiftDate(to, periodDays(from, to)) < today}
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
            setDraftFrom(validAnalyticsDate(from) ? from : shiftDate(today!, -7))
            setDraftTo(validAnalyticsDate(to) ? to : shiftDate(today!, -1))
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
            className={`flex-1 px-2 ${today && to === shiftDate(today, -1) && from === shiftDate(today, -n) ? 'bg-surface-raised text-accent-text' : 'text-content-muted'}`}
            aria-label={`Last ${n} ${n === 1 ? 'day' : 'days'}`}
            aria-pressed={!!today && to === shiftDate(today, -1) && from === shiftDate(today, -n)}
            disabled={!today}
            onClick={() => {
              if (today) onChange({ from: shiftDate(today, -n), to: shiftDate(today, -1) })
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
                onChange={setDraftFrom}
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
                onChange={setDraftTo}
              />
            </div>
          </div>
          <p className="text-xs text-content-muted">1–92 days · Kolkata business dates</p>
          {!draftValid && (
            <p role="alert" className="text-sm text-danger">
              Choose a valid range of 1–92 days.
            </p>
          )}
        </div>
      </FormSheet>
    </>
  )
}
