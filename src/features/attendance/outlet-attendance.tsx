import { CalendarCheck, ChevronLeft, ChevronRight, PencilLine, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { FormSheet } from '@/components/layout/form-sheet'
import { useAdapters, type Tables } from '@/data-access'
import type { AccountSummary, AttendanceRecord, WaitingCount } from '@/data-access/adapters'
import { AttendanceActionError, worksAt } from '@/data-access/adapters'
import {
  evaluateFence,
  formatBusinessDate,
  instantOnBusinessDay,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { readPosition, type PositionReading } from '@/lib/geolocation'
import { useSession } from '@/session/context'
import { holdsRole } from '@/session/session'
import { useOutletScope } from '@/features/outlet-scope'

import { isLate, readDay, tallyDays, type DayReading } from './attendance-record'
import { assembleRange, monthRange, type DateRange, type DayRow } from './attendance-range'
import { RangeDayList, TallySummary } from './day-range-list'
import { ApprovalNote, DayVerdict, DerivedVerdict, EventEvidence } from './evidence'
import { RangePicker } from './range-picker'

/**
 * The outlet's attendance, along two axes (docs/SCREENS.md).
 *
 * **By day** is the roll-call: who arrived, when, from where, whether they were
 * late, and which days are still waiting for a decision — with the approval and
 * the manual entry made from here. Every current staff member appears, including
 * those with nothing recorded and those whose account is deactivated; cutting
 * access does not falsify the day. A view that listed only the rows that exist
 * would quietly hide the people who never turned up, which is the one thing a
 * manager most needs to see.
 *
 * **By person** is the pattern: one staff member over a range of dates, with the
 * counts. A pattern is what tells a manager something, and reading it one day at
 * a time is not reading it at all.
 *
 * Departed people (`left_on` set) are not offered for new days; their recorded
 * rows remain readable through the person view over a range that covers them.
 */
export function OutletAttendance() {
  const { outlets, accounts } = useAdapters()

  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [people, setPeople] = useState<AccountSummary[]>([])
  const [axis, setAxis] = useState<'day' | 'person'>('day')
  const [error, setError] = useState<string | null>(null)

  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, selector: outletSelector, choose } = useOutletScope()

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
            // Everybody live at THIS outlet, whether or not they also work at
            // another. Their other outlet's assignment is not visible here, and
            // should not be — it is the other outlet's business.
            .filter((account) => worksAt(account, outletId))
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
        )
      })
      .catch(() => {
        if (active) setError('Could not load this outlet. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outletId, outlets, accounts])

  if (!outletId) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Attendance" />
        <EmptyState icon={CalendarCheck} title="This account is not assigned to an outlet." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Attendance"
        subtitle={outlet ? `${outlet.name} — who was here, and where they were.` : undefined}
      />

      <StrandedDays currentOutletId={outletId} onChoose={choose} />

      <div className="mb-3 flex gap-2" role="tablist" aria-label="Read attendance by">
        <Button
          role="tab"
          aria-selected={axis === 'day'}
          variant={axis === 'day' ? 'primary' : 'secondary'}
          size="phone"
          data-testid="axis-day"
          onClick={() => setAxis('day')}
        >
          By day
        </Button>
        <Button
          role="tab"
          aria-selected={axis === 'person'}
          variant={axis === 'person' ? 'primary' : 'secondary'}
          size="phone"
          data-testid="axis-person"
          onClick={() => setAxis('person')}
        >
          By person
        </Button>
      </div>

      {outlet?.latitude === null && (
        <p className="mb-3 rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This outlet has no captured position, so no check-in here can be measured against a
          geofence and no approval here can show that a manager was on site. The owner captures it
          standing at the counter.
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

      {outlet &&
        (axis === 'day' ? (
          <DayAxis outlet={outlet} people={people} onError={setError} />
        ) : (
          <PersonAxis outlet={outlet} people={people} onError={setError} />
        ))}
    </div>
  )
}

/**
 * Where days are stranded, across outlets. Shown to the owner only, because they
 * are the one person who cannot notice a forgotten approval by opening their own
 * outlet — and a day nobody settles is invisible until somebody queries their
 * pay.
 *
 * The count here spans every business day, so it is deliberately not the same
 * number as the waiting count on the day below: an outlet can hold nothing today
 * and a week of unsettled days behind it.
 *
 * Choosing another outlet brings the view to it, so noticing and acting are one
 * gesture. The outlet already in scope is stated rather than offered, because
 * there is nowhere to go.
 */
function StrandedDays({
  currentOutletId,
  onChoose,
}: {
  currentOutletId: string | null
  onChoose: (outletId: string) => void
}) {
  const session = useSession()
  const { attendance } = useAdapters()
  const [counts, setCounts] = useState<WaitingCount[] | null>(null)
  const isOwner = holdsRole(session, 'super_admin')

  useEffect(() => {
    if (!isOwner) return
    let active = true
    void attendance
      .countWaitingByOutlet()
      .then((rows) => {
        if (active) setCounts(rows)
      })
      // A count is a convenience, not the surface. Failing to load it must not
      // take the day view down with it.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [attendance, isOwner])

  if (!isOwner || !counts || counts.length === 0) return null

  return (
    <div
      data-testid="stranded-days"
      className="mb-3 rounded-xl border border-warning bg-surface-raised p-2"
    >
      <p className="text-sm font-semibold text-content">Days waiting for a manager</p>
      <ul className="mt-1 space-y-0.5 text-sm text-content-muted">
        {counts.map((count) => {
          const name = count.outletName ?? 'An outlet'
          const tally = `${count.waiting === 1 ? '1 day' : `${count.waiting} days`}, oldest ${formatBusinessDate(count.oldest)}`

          if (count.outletId === currentOutletId) {
            return (
              <li key={count.outletId} data-testid={`stranded-${count.outletId}`}>
                <span className="font-semibold text-content">{name}</span> (this outlet): {tally}
              </li>
            )
          }

          return (
            <li key={count.outletId}>
              <button
                type="button"
                data-testid={`stranded-${count.outletId}`}
                onClick={() => onChoose(count.outletId)}
                className="rounded text-left underline decoration-dotted underline-offset-2 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="font-semibold text-content">{name}</span>: {tally}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * How long a position reading may be reused across approvals (design D11).
 *
 * The approver's position is evidence written to each row, so this window is
 * exactly how stale that evidence is allowed to be. It is also the abuse bound:
 * longer would let a manager take one reading inside the fence, walk away, and
 * keep collecting one-tap no-reason approvals against it.
 */
const POSITION_CACHE_MS = 60_000

/** Rank a day by how much it wants somebody's attention (design D12). */
const READING_RANK: Record<DayReading['kind'], number> = {
  waiting: 0,
  'not-yet-arrived': 1,
  absent: 2,
  recorded: 3,
}

/** What an approval is waiting on, once the manager's position is known. */
type ApprovalFlow =
  | { kind: 'idle' }
  | { kind: 'locating'; ids: string[] }
  /** The rule wants a reason. `why` is what the sheet explains. */
  | {
      kind: 'reason'
      ids: string[]
      reading: PositionReading | null
      why: 'away' | 'no-position' | 'closed-day'
    }
  | { kind: 'saving' }

function DayAxis({
  outlet,
  people,
  onError,
}: {
  outlet: Tables<'outlets'>
  people: AccountSummary[]
  onError: (message: string | null) => void
}) {
  const session = useSession()
  const { attendance } = useAdapters()

  const today = resolveBusinessDate(new Date(), outlet.business_day_cutover)
  const [businessDate, setBusinessDate] = useState(today)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loadedDate, setLoadedDate] = useState<string | null>(null)
  const [flow, setFlow] = useState<ApprovalFlow>({ kind: 'idle' })
  const [manualFor, setManualFor] = useState<AccountSummary | null>(null)

  // A position reading, reused for a minute so approving one at a time is not one
  // GPS read per person (design D11). In memory only, so a reload asks again.
  const cachedPosition = useRef<{ reading: PositionReading; at: number } | null>(null)

  // The day exactly as it loaded, kept beside the live records purely to order the
  // roll-call (design D12). Approvals update `records` and never this, so settling
  // a row cannot move the list; reloading the day replaces it and re-sorts.
  const [orderSeed, setOrderSeed] = useState<{
    records: readonly AttendanceRecord[]
    at: Date
  } | null>(null)

  // A reading taken at one outlet says nothing about standing at another.
  useEffect(() => {
    cachedPosition.current = null
  }, [outlet.id])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const rows = await attendance.listOutletDay(outlet.id, businessDate)
        if (!active) return
        setRecords(rows)
        setOrderSeed({ records: rows, at: new Date() })
        onError(null)
      } catch {
        if (active) onError('Could not load that day. Try again in a moment.')
      } finally {
        if (active) setLoadedDate(businessDate)
      }
    })()
    return () => {
      active = false
    }
    // `onError` is a setState updater and stable; listing it would re-fetch the
    // day every time the parent re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, outlet.id, businessDate])

  const loading = loadedDate !== businessDate

  function upsert(updated: readonly AttendanceRecord[]) {
    setRecords((current) => {
      const byId = new Map(current.map((record) => [record.id, record]))
      for (const record of updated) byId.set(record.id, record)
      return [...byId.values()]
    })
  }

  /**
   * Read the manager's position once, then decide whether the rule wants a
   * reason. Inside the fence on the row's own business day is one tap; anywhere
   * or any day else costs a sentence, and the database refuses the write without
   * one whatever this decides.
   */
  async function beginApprove(ids: string[]) {
    if (ids.length === 0) return

    // A reading from the last minute stands in for a fresh one; anything older is
    // no longer a claim about where this manager is now.
    const cached = cachedPosition.current
    const fresh = cached !== null && Date.now() - cached.at < POSITION_CACHE_MS
    if (fresh) return decideApproval(ids, cached.reading)

    setFlow({ kind: 'locating', ids })
    const result = await readPosition()
    const reading = result.ok ? result.reading : null
    // Only a real reading is worth keeping. A failure is not cached, so the next
    // approval asks again rather than inheriting a silence.
    cachedPosition.current = reading === null ? null : { reading, at: Date.now() }
    return decideApproval(ids, reading)
  }

  /**
   * Decide what an approval costs, given a position reading that may have just
   * been taken or may be up to a minute old.
   */
  async function decideApproval(ids: string[], reading: PositionReading | null) {
    const inside =
      reading !== null &&
      evaluateFence(
        {
          latitude: outlet.latitude,
          longitude: outlet.longitude,
          radiusMetres: outlet.geofence_radius_m,
        },
        reading,
      ).kind === 'inside'
    const sameDay = businessDate === today

    if (inside && sameDay) {
      await submitApproval(ids, null, reading)
      return
    }
    setFlow({
      kind: 'reason',
      ids,
      reading,
      why: !sameDay ? 'closed-day' : reading === null ? 'no-position' : 'away',
    })
  }

  async function submitApproval(
    ids: readonly string[],
    reason: string | null,
    reading: PositionReading | null,
  ) {
    setFlow({ kind: 'saving' })
    try {
      upsert(
        await attendance.approve(ids, {
          reason,
          reading,
          approverId: session.userId,
        }),
      )
      setFlow({ kind: 'idle' })
      onError(null)
    } catch (cause) {
      setFlow({ kind: 'idle' })
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  async function recordManual(person: AccountSummary, at: string) {
    try {
      upsert([
        await attendance.recordManualEntry({
          personId: person.id,
          outletId: outlet.id,
          businessDate,
          at,
          enteredBy: session.userId,
        }),
      ])
      setManualFor(null)
      onError(null)
    } catch (cause) {
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  const radius = outlet.geofence_radius_m
  // Manual entries belong to the current business day — the database refuses
  // anything else, so a past day simply does not offer the action.
  const manualDay = businessDate === today
  const unordered = people.map((person) => {
    const record = records.find((candidate) => candidate.personId === person.id) ?? null
    return {
      person,
      record,
      reading: readDay(record, outlet, businessDate),
      late: record !== null && isLate(record, outlet.business_day_cutover),
    }
  })

  // Put the waiting arrivals first. Ranked against the day as it loaded rather
  // than as it now stands, so approving a row cannot drop it down the list and
  // slide the next person's Approve button under a moving thumb (design D12).
  // The sort is stable, so `people`'s alphabetical order survives inside each rank.
  const rankAtLoad = (personId: string): number => {
    if (orderSeed === null) return READING_RANK.recorded
    const asLoaded = orderSeed.records.find((row) => row.personId === personId) ?? null
    return READING_RANK[readDay(asLoaded, outlet, businessDate, orderSeed.at).kind]
  }
  const rows =
    orderSeed === null
      ? unordered
      : [...unordered].sort((a, b) => rankAtLoad(a.person.id) - rankAtLoad(b.person.id))
  const waitingIds = rows
    .filter((row) => row.reading.kind === 'waiting')
    .map((row) => row.record?.id)
    .filter((id): id is string => id !== undefined)
  const busy = flow.kind === 'locating' || flow.kind === 'saving'

  return (
    <>
      <DayPicker
        businessDate={businessDate}
        onChange={setBusinessDate}
        cutover={outlet.business_day_cutover}
      />

      {waitingIds.length > 0 && (
        <div
          data-testid="awaiting-count"
          className="mb-3 rounded-lg border border-warning bg-surface-raised p-2"
        >
          <p className="text-sm font-semibold text-content">
            {waitingIds.length === 1
              ? '1 arrival is waiting for your approval.'
              : `${waitingIds.length} arrivals are waiting for your approval.`}
          </p>
          {/*
            No approve-all here, deliberately (design D8). Approving is meant to be
            the moment somebody remembers this person turning up for this shift,
            and one button settling the lot is how an unseen arrival gets counted.
          */}
          <p className="mt-0.5 text-xs text-content-muted">
            {waitingIds.length === 1
              ? 'Listed first below. Approve it against what you remember of the shift.'
              : 'Listed first below. Each one is approved on its own, against what you remember of the shift.'}
          </p>
        </div>
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
          {rows.map(({ person, record, reading, late }) => (
            <PersonDay
              key={person.id}
              person={person}
              record={record}
              reading={reading}
              late={late}
              radiusMetres={radius}
              busy={busy}
              offerManual={manualDay && record?.checkIn == null}
              onApprove={() => record && void beginApprove([record.id])}
              onManual={() => setManualFor(person)}
            />
          ))}
        </div>
      )}

      <ReasonSheet
        key={flow.kind === 'reason' ? flow.ids.join(',') : 'no-reason'}
        flow={flow}
        count={flow.kind === 'reason' ? flow.ids.length : 0}
        onClose={() => setFlow({ kind: 'idle' })}
        onApprove={(reason) => {
          if (flow.kind === 'reason') void submitApproval(flow.ids, reason, flow.reading)
        }}
      />

      <ManualEntrySheet
        key={manualFor?.id ?? 'no-manual'}
        person={manualFor}
        cutover={outlet.business_day_cutover}
        businessDate={businessDate}
        onClose={() => setManualFor(null)}
        onRecord={(at) => {
          if (manualFor) void recordManual(manualFor, at)
        }}
      />
    </>
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

function PersonDay({
  person,
  record,
  reading,
  late,
  radiusMetres,
  busy,
  offerManual,
  onApprove,
  onManual,
}: {
  person: AccountSummary
  record: AttendanceRecord | null
  reading: DayReading
  late: boolean
  radiusMetres: number
  busy: boolean
  /** Can an arrival still be typed in for this person on this day? */
  offerManual: boolean
  onApprove: () => void
  onManual: () => void
}) {
  const waiting = reading.kind === 'waiting'

  return (
    <Card
      data-testid={`day-${person.id}`}
      className={waiting ? 'space-y-2 border-warning' : 'space-y-2'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">
          {person.fullName}{' '}
          <span className="font-normal text-content-muted">
            {person.roleTitle}
            {person.isActive ? '' : ' · account deactivated'}
          </span>
        </h2>
        <span className="text-sm">
          {record ? (
            <DayVerdict record={record} late={late} />
          ) : (
            <DerivedVerdict reading={reading} />
          )}
        </span>
      </div>

      {record && (
        <>
          <EventEvidence label="In" event={record.checkIn} radiusMetres={radiusMetres} />
          <ApprovalNote record={record} radiusMetres={radiusMetres} />
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {waiting && (
          <Button
            size="phone"
            disabled={busy}
            onClick={onApprove}
            data-testid={`approve-${person.id}`}
          >
            <ShieldCheck aria-hidden size={14} />
            Approve
          </Button>
        )}
        {offerManual && (
          <Button
            variant="secondary"
            size="phone"
            onClick={onManual}
            data-testid={`manual-${person.id}`}
          >
            <PencilLine aria-hidden size={14} />
            Record arrival
          </Button>
        )}
      </div>
    </Card>
  )
}

const WHY_COPY = {
  away: {
    title: 'You are not at the outlet',
    detail:
      'Your position was read away from this outlet, so approving from here needs a reason. Nothing is refused for being elsewhere — it is recorded, and the person the day is about can read it.',
  },
  'no-position': {
    title: 'Your position could not be read',
    detail:
      'With no reading there is nothing to show you were at the outlet, so approving needs a reason. It is recorded on the day and the person it is about can read it.',
  },
  'closed-day': {
    title: 'This business day has already closed',
    detail:
      'Settling a day after it has ended needs a reason, even from inside the outlet — so a day approved a week late says so on the record.',
  },
} as const

/**
 * The reason, asked for only when the rule wants one.
 *
 * Not pre-filled and not defaulted: the point of recording one is that a person
 * decided something, and a placeholder answer would make it a formality. A
 * manager standing at the counter on the day never sees this sheet at all, which
 * is the difference the rule is built around.
 */
function ReasonSheet({
  flow,
  count,
  onClose,
  onApprove,
}: {
  flow: ApprovalFlow
  count: number
  onClose: () => void
  onApprove: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const open = flow.kind === 'reason'
  const copy = flow.kind === 'reason' ? WHY_COPY[flow.why] : null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim()) onApprove(reason)
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={count > 1 ? `Approve ${count} arrivals` : 'Approve this arrival'}
      footer={
        <button
          type="submit"
          form="approve-attendance"
          disabled={!reason.trim()}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          Approve and record my reason
        </button>
      }
    >
      <form id="approve-attendance" onSubmit={submit} className="space-y-4" noValidate>
        {copy && (
          <div data-testid="reason-required">
            <p className="text-sm font-semibold text-content">{copy.title}</p>
            <p className="mt-1 text-sm text-content-muted">{copy.detail}</p>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="approval-reason" className="block text-sm font-semibold">
            Why are you approving this?
          </label>
          <Input
            id="approval-reason"
            required
            value={reason}
            placeholder="e.g. Seen at the counter this morning before I left"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-content-muted">
            This is stored on the record and is visible to the person it is about.
          </p>
        </div>
      </form>
    </FormSheet>
  )
}

/**
 * A manual entry: the escape hatch that keeps a hard arrival rule humane. The
 * phone died, the person forgot — the manager records the arrival at the time it
 * happened, and the row permanently shows who typed it in. Past times only, on
 * today's business day; the database enforces both, and recording it settles the
 * day without a second decision.
 */
function ManualEntrySheet({
  person,
  cutover,
  businessDate,
  onClose,
  onRecord,
}: {
  person: AccountSummary | null
  cutover: string
  businessDate: string
  onClose: () => void
  onRecord: (at: string) => void
}) {
  const [time, setTime] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!time) return
    onRecord(instantOnBusinessDay(businessDate, time, cutover))
  }

  return (
    <FormSheet
      open={person !== null}
      onClose={onClose}
      title="Record an arrival"
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
        {person && (
          <p className="text-sm text-content-muted">
            You are recording an arrival for {person.fullName} on today’s business day. The record
            will permanently show that you entered it — it is not a self check-in, it carries no
            location, and recording it counts the day without a separate approval.
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="manual-time" className="block text-sm font-semibold">
            When did they arrive?
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
 * One person, a range of dates, and the counts.
 *
 * The outlet is passed to the read explicitly rather than resolved from the
 * session (design D7). A Franchise Admin therefore cannot even express "this
 * person's days everywhere", and somebody who works at both shops shows only the
 * days worked here — the other outlet's days are the other outlet's data.
 */
function PersonAxis({
  outlet,
  people,
  onError,
}: {
  outlet: Tables<'outlets'>
  people: AccountSummary[]
  onError: (message: string | null) => void
}) {
  const { attendance } = useAdapters()
  const today = resolveBusinessDate(new Date(), outlet.business_day_cutover)

  const [chosenPersonId, setChosenPersonId] = useState<string>('')
  const [range, setRange] = useState<DateRange>(() => monthRange(today))
  const [loaded, setLoaded] = useState<{ key: string; records: AttendanceRecord[] } | null>(null)

  // Whose days, derived rather than seeded from an effect: "the first person on
  // the list" is a fact about the list, not a choice anybody made, and setting
  // it from an effect cascades a render every time the list arrives.
  const personId = chosenPersonId || (people[0]?.id ?? '')
  const person = people.find((candidate) => candidate.id === personId) ?? null

  // Which read `loaded` actually holds. Loading is derived from it lagging what
  // is being asked for, rather than blanked at the top of the effect — the same
  // shape the day view uses, and for the same reason.
  const key = `${personId}|${outlet.id}|${range.from}|${range.to}`
  const records = loaded?.key === key ? loaded.records : null

  useEffect(() => {
    if (!personId) return
    let active = true
    void attendance
      .listPersonRange(personId, outlet.id, range.from, range.to)
      .then((rows) => {
        if (active) setLoaded({ key, records: rows })
      })
      .catch(() => {
        if (active) onError('Could not load those days. Try again in a moment.')
      })
    return () => {
      active = false
    }
    // `onError` is a stable setState updater; listing it would re-read on every
    // parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, key, personId, outlet.id, range.from, range.to])

  const days: DayRow[] = useMemo(() => {
    if (!records || !person) return []
    return assembleRange({
      records,
      outlet,
      range,
      // Bounded by what this outlet can see of the person's assignments, which
      // for a Franchise Admin is only their own outlet's rows anyway.
      windows: person.assignments
        .filter((assignment) => assignment.outletId === outlet.id)
        .map(({ startedOn, endedOn }) => ({ startedOn, endedOn })),
    })
  }, [records, person, outlet, range])

  if (people.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="Nobody is on this outlet's staff list yet. Add people under People."
      />
    )
  }

  return (
    <div data-testid="attendance-person">
      <label className="mb-3 block text-xs text-content-muted">
        Whose attendance
        <Select
          data-testid="person-picker"
          value={personId}
          onChange={(event) => setChosenPersonId(event.target.value)}
        >
          {people.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.fullName}
            </option>
          ))}
        </Select>
      </label>

      <RangePicker range={range} today={today} onChange={setRange} />

      {records === null ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : (
        <>
          <TallySummary tally={tallyDays(days)} />
          <RangeDayList rows={days} radiusFor={() => outlet.geofence_radius_m} />
        </>
      )}
    </div>
  )
}
