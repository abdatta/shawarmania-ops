import { CalendarCheck, ChevronLeft, ChevronRight, PencilLine } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormSheet } from '@/components/layout/form-sheet'
import { useAdapters, type Tables } from '@/data-access'
import type { AccountSummary, AttendanceRecord } from '@/data-access/adapters'
import { AttendanceActionError, isOutletPerson } from '@/data-access/adapters'
import { formatBusinessDate, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

import { isAwaitingOverride } from './attendance-record'
import { DayVerdict, EventEvidence, OverrideNote } from './evidence'

/**
 * The outlet's attendance by day: who, when, from where, and any flags — with
 * the override decision and manual entries made from here (docs/SCREENS.md).
 *
 * Every current staff member appears, including those with nothing recorded
 * and those whose account is deactivated — cutting access does not falsify
 * the day. A day view that listed only the rows that exist would quietly hide
 * the people who never checked in, which is the one thing a manager most
 * needs to see. Departed people (`left_on` set) are not offered for new days;
 * their recorded rows remain readable through the records themselves.
 */
export function OutletAttendance() {
  const session = useSession()
  const { outlets, accounts, attendance } = useAdapters()

  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [people, setPeople] = useState<AccountSummary[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<AttendanceRecord | null>(null)
  const [manualFor, setManualFor] = useState<{
    person: AccountSummary
    event: 'check-in' | 'check-out'
  } | null>(null)

  const outletId = session.outletId

  // The outlet and its people: fetched once, independent of which day is shown.
  useEffect(() => {
    if (!outletId) return
    let active = true
    void Promise.all([outlets.getOutlet(outletId), accounts.listAccounts()])
      .then(([found, list]) => {
        if (!active || !found) return
        setOutlet(found)
        setPeople(
          list
            .filter((account) => account.outletId === outletId && isOutletPerson(account))
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
        )
        setBusinessDate(resolveBusinessDate(new Date(), found.business_day_cutover))
      })
      .catch(() => {
        if (active) setError('Could not load this outlet. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outletId, outlets, accounts])

  // Which day `records` actually holds. Loading is derived from it lagging the
  // day being shown, rather than set at the top of the effect — that would
  // cascade a render on every day change.
  const [loadedDate, setLoadedDate] = useState<string | null>(null)

  useEffect(() => {
    if (!outletId || !businessDate) return
    let active = true

    void (async () => {
      try {
        const rows = await attendance.listOutletDay(outletId, businessDate)
        if (!active) return
        setRecords(rows)
        setError(null)
      } catch {
        if (active) setError('Could not load that day. Try again in a moment.')
      } finally {
        if (active) setLoadedDate(businessDate)
      }
    })()

    return () => {
      active = false
    }
  }, [attendance, outletId, businessDate])

  const loading = businessDate === null || loadedDate !== businessDate

  function upsertRecord(updated: AttendanceRecord) {
    setRecords((current) => {
      const replaced = current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      )
      return replaced.some((candidate) => candidate.id === updated.id)
        ? replaced
        : [...replaced, updated]
    })
  }

  async function approve(record: AttendanceRecord, reason: string) {
    try {
      const updated = await attendance.approveOverride(record.id, reason, session.userId)
      upsertRecord(updated)
      setPending(null)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  async function recordManual(person: AccountSummary, event: 'check-in' | 'check-out', at: string) {
    if (!outletId || !businessDate) return
    try {
      const updated = await attendance.recordManualEntry({
        personId: person.id,
        outletId,
        businessDate,
        event,
        at,
        enteredBy: session.userId,
      })
      upsertRecord(updated)
      setManualFor(null)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  if (!outletId) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Attendance" />
        <EmptyState icon={CalendarCheck} title="This account is not assigned to an outlet." />
      </div>
    )
  }

  const radius = outlet?.geofence_radius_m ?? 0
  const today = outlet ? resolveBusinessDate(new Date(), outlet.business_day_cutover) : null
  // Manual entries belong to the current business day — the database refuses
  // anything else, so a past day simply does not offer the action.
  const manualDay = businessDate !== null && businessDate === today
  const rows = people
    .filter((person) => person.leftOn === null)
    .map((person) => ({
      person,
      record: records.find((record) => record.personId === person.id) ?? null,
    }))
  const awaiting = rows.filter((row) => row.record && isAwaitingOverride(row.record, radius)).length

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Attendance"
        subtitle={outlet ? `${outlet.name} — who was here, and where they were.` : undefined}
      />

      {businessDate && (
        <DayPicker
          businessDate={businessDate}
          onChange={setBusinessDate}
          cutover={outlet?.business_day_cutover ?? '04:00:00'}
        />
      )}

      {outlet?.latitude === null && (
        <p className="mb-3 rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This outlet has no captured position, so no check-in here can be measured against a
          geofence. The owner captures it standing at the counter.
        </p>
      )}

      {awaiting > 0 && (
        <p
          data-testid="awaiting-count"
          className="mb-3 rounded-lg border border-warning bg-surface-raised p-2 text-sm font-semibold text-content"
        >
          {awaiting === 1
            ? '1 check-in is waiting for your decision.'
            : `${awaiting} check-ins are waiting for your decision.`}
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="attendance-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nobody is on this outlet's staff list yet. Add people under People."
        />
      ) : (
        <div data-testid="attendance-day" className="space-y-3">
          {rows.map(({ person, record }) => (
            <PersonDay
              key={person.id}
              person={person}
              record={record}
              radiusMetres={radius}
              manualEvent={manualDay ? offeredManualEvent(record) : null}
              onApprove={() => setPending(record)}
              onManual={(event) => setManualFor({ person, event })}
            />
          ))}
        </div>
      )}

      {/*
        Keyed by the record so opening it for a different person starts with an
        empty reason — a remount rather than an effect that resets state.
      */}
      <OverrideSheet
        key={pending?.id ?? 'none'}
        record={pending}
        onClose={() => setPending(null)}
        onApprove={(reason) => {
          if (pending) void approve(pending, reason)
        }}
      />

      <ManualEntrySheet
        key={manualFor ? `${manualFor.person.id}-${manualFor.event}` : 'no-manual'}
        target={manualFor}
        cutover={outlet?.business_day_cutover ?? '04:00:00'}
        businessDate={businessDate}
        onClose={() => setManualFor(null)}
        onRecord={(at) => {
          if (manualFor) void recordManual(manualFor.person, manualFor.event, at)
        }}
      />
    </div>
  )
}

/** Which manual event this person's day can accept, if any. */
function offeredManualEvent(record: AttendanceRecord | null): 'check-in' | 'check-out' | null {
  if (!record?.checkIn) return 'check-in'
  if (!record.checkOut) return 'check-out'
  return null
}

function DayPicker({
  businessDate,
  cutover,
  onChange,
}: {
  businessDate: string
  cutover: string
  onChange: (date: string) => void
}) {
  const today = resolveBusinessDate(new Date(), cutover)

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2">
      <Button
        variant="ghost"
        size="phone"
        aria-label="Previous day"
        onClick={() => onChange(shiftBusinessDate(businessDate, -1))}
      >
        <ChevronLeft aria-hidden size={18} />
      </Button>
      <span data-testid="day-label" className="text-sm font-semibold text-content">
        {businessDate === today ? 'Today' : formatBusinessDate(businessDate)}
      </span>
      <Button
        variant="ghost"
        size="phone"
        aria-label="Next day"
        disabled={businessDate >= today}
        onClick={() => onChange(shiftBusinessDate(businessDate, 1))}
      >
        <ChevronRight aria-hidden size={18} />
      </Button>
    </div>
  )
}

function PersonDay({
  person,
  record,
  radiusMetres,
  manualEvent,
  onApprove,
  onManual,
}: {
  person: AccountSummary
  record: AttendanceRecord | null
  radiusMetres: number
  /** Which manual event may be recorded for this person today, if any. */
  manualEvent: 'check-in' | 'check-out' | null
  onApprove: () => void
  onManual: (event: 'check-in' | 'check-out') => void
}) {
  const awaiting = record !== null && isAwaitingOverride(record, radiusMetres)

  return (
    <Card
      data-testid={`day-${person.id}`}
      className={awaiting ? 'space-y-2 border-warning' : 'space-y-2'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">
          {person.fullName}{' '}
          <span className="font-normal text-content-muted">
            {person.staffCode}
            {person.isActive ? '' : ' · account deactivated'}
          </span>
        </h2>
        {record ? (
          <span className="text-sm">
            <DayVerdict record={record} radiusMetres={radiusMetres} />
          </span>
        ) : (
          <span className="text-sm text-content-muted">Nothing recorded</span>
        )}
      </div>

      {record && (
        <>
          <EventEvidence label="In" event={record.checkIn} radiusMetres={radiusMetres} />
          <EventEvidence label="Out" event={record.checkOut} radiusMetres={radiusMetres} />
          <OverrideNote record={record} />
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {awaiting && (
          <Button size="phone" onClick={onApprove} data-testid={`approve-${person.id}`}>
            Review and approve
          </Button>
        )}
        {manualEvent && (
          <Button
            variant="secondary"
            size="phone"
            onClick={() => onManual(manualEvent)}
            data-testid={`manual-${person.id}`}
          >
            <PencilLine aria-hidden size={14} />
            {manualEvent === 'check-in' ? 'Record check-in' : 'Record check-out'}
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * The approval. A reason is required and not pre-filled: the point of recording
 * one is that a person decided something, and a default would make it a
 * formality.
 */
function OverrideSheet({
  record,
  onClose,
  onApprove,
}: {
  record: AttendanceRecord | null
  onClose: () => void
  onApprove: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim()) onApprove(reason)
  }

  return (
    <FormSheet
      open={record !== null}
      onClose={onClose}
      title="Approve this check-in"
      footer={
        <button
          type="submit"
          form="approve-override"
          disabled={!reason.trim()}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          Approve and record my reason
        </button>
      }
    >
      <form id="approve-override" onSubmit={submit} className="space-y-4" noValidate>
        {record && (
          <p className="text-sm text-content-muted">
            {record.personName} checked in away from the outlet. Approving counts the day as present
            and records your name against it.
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="override-reason" className="block text-sm font-semibold">
            Why are you approving this?
          </label>
          <Input
            id="override-reason"
            required
            value={reason}
            placeholder="e.g. Seen at the counter; phone signal poor"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-content-muted">
            This is stored on the record and is visible to the employee it is about.
          </p>
        </div>
      </form>
    </FormSheet>
  )
}

/**
 * A manual entry: the escape hatch that keeps hard geofence blocking humane.
 * The phone died, the person forgot — the manager records the event at the
 * time it happened, and the row permanently shows who typed it in. Past times
 * only, on today's business day; the database enforces both.
 */
function ManualEntrySheet({
  target,
  cutover,
  businessDate,
  onClose,
  onRecord,
}: {
  target: { person: AccountSummary; event: 'check-in' | 'check-out' } | null
  cutover: string
  businessDate: string | null
  onClose: () => void
  onRecord: (at: string) => void
}) {
  const [time, setTime] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!time || !businessDate) return
    onRecord(instantOnBusinessDay(businessDate, time, cutover))
  }

  return (
    <FormSheet
      open={target !== null}
      onClose={onClose}
      title={target?.event === 'check-out' ? 'Record a check-out' : 'Record a check-in'}
      footer={
        <button
          type="submit"
          form="manual-entry"
          disabled={!time}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          Record it under my name
        </button>
      }
    >
      <form id="manual-entry" onSubmit={submit} className="space-y-4" noValidate>
        {target && (
          <p className="text-sm text-content-muted">
            You are recording a {target.event === 'check-out' ? 'check-out' : 'check-in'} for{' '}
            {target.person.fullName} on today’s business day. The record will permanently show that
            you entered it — it is not a self check-in, and it carries no location.
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="manual-time" className="block text-sm font-semibold">
            When did it happen?
          </label>
          <Input
            id="manual-time"
            type="time"
            required
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
          <p className="text-xs text-content-muted">
            A past time on today’s business day. A future time will be refused.
          </p>
        </div>
      </form>
    </FormSheet>
  )
}

/**
 * A wall-clock time on a business day, as an instant. Times before the
 * outlet's cutover belong to the next calendar date — a 01:30 check-out on
 * business day X happened on calendar day X+1, and the database validates
 * exactly that arithmetic.
 */
function instantOnBusinessDay(businessDate: string, time: string, cutover: string): string {
  const calendarDate = `${time}:00` < cutover ? shiftBusinessDate(businessDate, 1) : businessDate
  return new Date(`${calendarDate}T${time}:00+05:30`).toISOString()
}
