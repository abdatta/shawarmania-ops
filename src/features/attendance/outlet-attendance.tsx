import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormSheet } from '@/components/layout/form-sheet'
import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord, EmployeeSummary } from '@/data-access/adapters'
import { AttendanceActionError } from '@/data-access/adapters'
import { formatBusinessDate, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

import { isAwaitingOverride } from './attendance-record'
import { DayVerdict, EventEvidence, OverrideNote } from './evidence'

/**
 * The outlet's attendance by day: who, when, from where, and any flags — with
 * the override decision made from here (docs/SCREENS.md).
 *
 * Every roster employee appears, including those with nothing recorded. A day
 * view that listed only the rows that exist would quietly hide the people who
 * never checked in, which is the one thing a manager most needs to see.
 */
export function OutletAttendance() {
  const session = useSession()
  const { outlets, employees, attendance } = useAdapters()

  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [roster, setRoster] = useState<EmployeeSummary[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<AttendanceRecord | null>(null)

  const outletId = session.outletId

  // The outlet and its roster: fetched once, independent of which day is shown.
  useEffect(() => {
    if (!outletId) return
    let active = true
    void Promise.all([outlets.getOutlet(outletId), employees.listEmployees(outletId)])
      .then(([found, list]) => {
        if (!active || !found) return
        setOutlet(found)
        setRoster(list)
        setBusinessDate(resolveBusinessDate(new Date(), found.business_day_cutover))
      })
      .catch(() => {
        if (active) setError('Could not load this outlet. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outletId, outlets, employees])

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

  async function approve(record: AttendanceRecord, reason: string) {
    try {
      const updated = await attendance.approveOverride(record.id, reason, session.userId)
      setRecords((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      )
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

  if (!outletId) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Attendance" />
        <EmptyState icon={CalendarCheck} title="This account is not assigned to an outlet." />
      </div>
    )
  }

  const radius = outlet?.geofence_radius_m ?? 0
  const rows = roster
    .filter((employee) => employee.employmentStatus === 'active')
    .map((employee) => ({
      employee,
      record: records.find((record) => record.employeeId === employee.id) ?? null,
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
          title="Nobody is on this outlet's staff list yet. Add people under Staff."
        />
      ) : (
        <div data-testid="attendance-day" className="space-y-3">
          {rows.map(({ employee, record }) => (
            <EmployeeDay
              key={employee.id}
              employee={employee}
              record={record}
              radiusMetres={radius}
              onApprove={() => setPending(record)}
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
    </div>
  )
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

function EmployeeDay({
  employee,
  record,
  radiusMetres,
  onApprove,
}: {
  employee: EmployeeSummary
  record: AttendanceRecord | null
  radiusMetres: number
  onApprove: () => void
}) {
  const awaiting = record !== null && isAwaitingOverride(record, radiusMetres)

  return (
    <Card
      data-testid={`day-${employee.id}`}
      className={awaiting ? 'space-y-2 border-warning' : 'space-y-2'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">
          {employee.fullName}{' '}
          <span className="font-normal text-content-muted">{employee.employeeCode}</span>
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

      {awaiting && (
        <Button size="phone" onClick={onApprove} data-testid={`approve-${employee.id}`}>
          Review and approve
        </Button>
      )}
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
            {record.employeeName} checked in away from the outlet. Approving counts the day as
            present and records your name against it.
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
