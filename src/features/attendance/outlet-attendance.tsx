import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Badge, BadgeDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { LoadingBlock, LoadingList } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { FormSheet } from '@/components/layout/form-sheet'
import { useAdapters, type Tables } from '@/data-access'
import type {
  AccountSummary,
  AttendanceCorrectionAction,
  AttendanceRecord,
  WaitingCount,
} from '@/data-access/adapters'
import { AttendanceActionError, isStaffAt } from '@/data-access/adapters'
import { attentionChanged } from '@/features/attention/attention'
import {
  evaluateFence,
  formatBusinessDate,
  instantOnBusinessDay,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { readPosition, type PositionReading } from '@/lib/geolocation'
import { useSession } from '@/session/context'
import { holdsRole, sessionOutlets } from '@/session/session'
import { useOutletScope } from '@/features/outlet-scope'

import { AttendanceCard } from './attendance-card'
import {
  isLate,
  isOutOfFence,
  isUnverifiable,
  readDay,
  tallyDays,
  type DayReading,
} from './attendance-record'
import { assembleRange, monthRange, type DateRange, type DayRow } from './attendance-range'
import { RangeDayList, TallySummary } from './day-range-list'
import {
  ApprovalNote,
  AttendanceHistory,
  DayVerdict,
  DerivedVerdict,
  EventEvidence,
} from './evidence'
import { RangePicker } from './range-picker'
import { useWaitingCounts, waitingAt, waitingLabel } from './waiting-counts'

/**
 * Attendance, along two axes (docs/SCREENS.md).
 *
 * **By outlet** is the roll-call: who arrived, when, from where, whether they
 * were late, and which days are still waiting for a decision — with the approval
 * and the manual entry made from here. Every current staff member appears,
 * including those with nothing recorded and those whose account is deactivated;
 * cutting access does not falsify the day. A view that listed only the rows that
 * exist would quietly hide the people who never turned up, which is the one
 * thing a manager most needs to see.
 *
 * **By staff** is the pattern: one person over a range of dates, with the counts.
 * A pattern is what tells a manager something, and reading it one day at a time
 * is not reading it at all. The counts exist so somebody can work out pay by
 * hand, which is why each business date counts once.
 *
 * **The axis is chosen before the outlet** (attendance-one-day-per-person). It
 * used to be the other way round, which made the owner's actual question —
 * "how many days did this person work in August" — impossible to ask, because
 * every read started by naming one shop. The outlet choice now belongs to the
 * by-outlet axis alone, and it selects as many as the reader may see. By staff
 * takes its scope from the database instead (design D4).
 *
 * **So the load is not scoped by the selection, and the axes narrow it
 * differently.** One read of `listOutlets` and one of `listAccounts`, neither
 * naming an outlet, both already scoped by policy: what comes back is exactly
 * every outlet this reader may see and everybody they may see. By outlet
 * intersects that with the selection. **By staff does not** — filtering its
 * person picker by the outlet chips is the very thing splitting the axes was
 * meant to stop, and it hid a whole shop's people from a view that is not about
 * shops.
 *
 * Departed people (`left_on` set) are not offered for new days; their recorded
 * rows remain readable through the by-staff axis over a range that covers them.
 */
export function OutletAttendance() {
  const { outlets: outletsAdapter, accounts } = useAdapters()
  const session = useSession()

  const [axis, setAxis] = useState<'outlet' | 'staff'>('outlet')
  const [error, setError] = useState<string | null>(null)

  // Who may see what, applied the same way `useOutletScope` applies it: the
  // owner reads every outlet, everybody else reads the ones they are assigned
  // to. The policies are the boundary; this is the client agreeing with them
  // rather than discovering them by being refused.
  const isOwner = holdsRole(session, 'super_admin')
  const mine = useMemo(() => sessionOutlets(session), [session])

  // Shared with the navigation badge and the day controls, so all three agree
  // and one read serves them. A failed read keeps the last known counts.
  const { counts } = useWaitingCounts()

  // Which outlets this surface is about. One for nearly everybody; several for
  // somebody who may see several, which confers nothing — the database decides
  // every read and every write from the assignment (multi-outlet-people, D6).
  //
  // Each chip carries its own outlet's unsettled days. That used to be a second
  // row of chips above this one, naming the same outlets in the same shape; the
  // count belongs on the control that acts, so noticing a backlog and reaching
  // it are one gesture on one chip.
  const { outletIds, selector: outletSelector } = useOutletScope({
    multiple: true,
    badgeFor: (outletId, selected) => (
      <WaitingChipBadge counts={counts} outletId={outletId} selected={selected} />
    ),
  })

  // Everything the reader may see. Not keyed by the selection, because it does
  // not depend on it.
  const [loaded, setLoaded] = useState<{
    outlets: Tables<'outlets'>[]
    people: AccountSummary[]
  } | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([outletsAdapter.listOutlets(), accounts.listAccounts()])
      .then(([all, list]) => {
        if (!active) return
        const outlets = isOwner ? all : all.filter((outlet) => mine.includes(outlet.id))
        setLoaded({
          outlets,
          // Everybody on some readable outlet's staff list — the people whose
          // arrival an outlet tracks (design D3) — listed once however many of
          // them they work at.
          people: list
            .filter((account) => outlets.some((outlet) => isStaffAt(account, outlet.id)))
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
        })
        setError(null)
      })
      .catch(() => {
        if (active) setError('Could not load these outlets. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outletsAdapter, accounts, isOwner, mine])

  // The by-outlet axis's narrower view of the same two lists.
  //
  // Memoised on the scope **string**, never on `outletIds` itself: a
  // single-outlet reader gets a fresh array from `useOutletScope` on every
  // render, so keying on its identity would hand the day view a new outlet list
  // each time, re-read the day, and re-rank a roll-call that is supposed to hold
  // still while somebody is approving down it.
  const scopeKey = [...outletIds].sort().join(',')
  const selectedOutlets = useMemo(
    () => loaded?.outlets.filter((outlet) => scopeKey.split(',').includes(outlet.id)) ?? [],
    [loaded, scopeKey],
  )
  const selectedPeople = useMemo(
    () =>
      loaded?.people.filter((person) => scopeKey.split(',').some((id) => isStaffAt(person, id))) ??
      [],
    [loaded, scopeKey],
  )

  if (outletIds.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Attendance" />
        <EmptyState icon={CalendarCheck} title="This account is not assigned to an outlet." />
      </div>
    )
  }

  const unsurveyed = selectedOutlets.filter((outlet) => outlet.latitude === null)
  // A selection that names outlets the list has not produced yet is a moment
  // between reads, not an empty day.
  const ready = loaded !== null && (axis === 'staff' || selectedOutlets.length > 0)

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Attendance" subtitle="Who was here, and where they were." />

      {/*
        The axis first, then what it needs. By outlet needs to know which shops;
        by staff does not, because the database already knows which shops this
        reader may see and that is exactly the right answer (design D4).
      */}
      <div className="mb-3 flex gap-2" role="tablist" aria-label="Read attendance by">
        <Button
          role="tab"
          aria-selected={axis === 'outlet'}
          variant={axis === 'outlet' ? 'primary' : 'secondary'}
          size="phone"
          data-testid="axis-outlet"
          onClick={() => setAxis('outlet')}
        >
          By outlet
        </Button>
        <Button
          role="tab"
          aria-selected={axis === 'staff'}
          variant={axis === 'staff' ? 'primary' : 'secondary'}
          size="phone"
          data-testid="axis-staff"
          onClick={() => setAxis('staff')}
        >
          By staff
        </Button>
      </div>

      {axis === 'outlet' && outletSelector && <div className="mb-3">{outletSelector}</div>}

      {unsurveyed.length > 0 && (
        <p className="mb-3 rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          {unsurveyed.map((outlet) => outlet.name).join(' and ')} has no captured position, so no
          check-in there can be measured against a geofence and no approval there can show that a
          manager was on site. The owner captures it standing at the counter.
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

      {!ready || loaded === null ? (
        <LoadingList label="attendance" data-testid="attendance-loading" />
      ) : axis === 'outlet' ? (
        <OutletAxis
          key={scopeKey}
          outlets={selectedOutlets}
          people={selectedPeople}
          onError={setError}
        />
      ) : (
        <StaffAxis outlets={loaded.outlets} people={loaded.people} onError={setError} />
      )}
    </div>
  )
}

/**
 * One outlet's unsettled days, on its own chip in the selector.
 *
 * This used to be a separate row above the selector, shown to the owner alone,
 * naming the same outlets in the same shape. Two controls for one question is
 * one too many, and the count belongs on the one that acts: noticing a backlog
 * and reaching it are then a single gesture on a single chip, and the row of
 * outlets stays in the same place whatever the database holds.
 *
 * It is no longer owner-only, because `countWaitingByOutlet` carries no owner
 * branch — it is scoped by the attendance policies, so a Franchise Admin running
 * two shops gets counts for exactly their two, which is the same problem the
 * separate row was built for. Somebody with one outlet has no selector and so no
 * chip, and loses nothing: with one outlet the day's own badge and the
 * earlier/later marks already say everything a per-outlet count could.
 *
 * The count spans every business day, so it is deliberately not the same number
 * as the day's own badge: an outlet can hold nothing today and a week of
 * unsettled days behind it.
 *
 * A selected chip is filled with `--primary`, so the badge's usual `--primary`
 * would vanish into it. On those it inverts to the same asserted pair the other
 * way round, which is the contrast the validator already checks.
 */
function WaitingChipBadge({
  counts,
  outletId,
  selected,
}: {
  counts: readonly WaitingCount[] | null
  outletId: string
  selected: boolean
}) {
  const waiting = counts?.find((count) => count.outletId === outletId)?.waiting ?? 0
  if (waiting <= 0) return null

  return (
    <Badge
      data-testid={`outlet-waiting-${outletId}`}
      count={waiting}
      // The chip already names the outlet, so the label does not repeat it.
      label={waitingLabel(waiting)}
      className={selected ? 'bg-on-primary text-primary' : ''}
    />
  )
}

/**
 * How long a position reading may be reused across approvals (design D11).
 *
 * The approver's position is evidence written to each row, so this window is
 * exactly how stale that evidence is allowed to be. It is also the abuse bound:
 * longer would let a manager take one reading inside the fence, walk away, and
 * keep collecting one-tap no-reason approvals against it.
 *
 * **Keyed per outlet** since the view stopped being about one
 * (attendance-one-day-per-person, design D6). One reading cannot vouch for
 * standing in two places, so reusing it across outlets would be writing evidence
 * that says somebody was somewhere they were not.
 */
const POSITION_CACHE_MS = 60_000

/** Rank a day by how much it wants somebody's attention (design D12). */
const READING_RANK: Record<DayReading['kind'], number> = {
  waiting: 0,
  'not-yet-arrived': 1,
  absent: 2,
  elsewhere: 3,
  recorded: 4,
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

/** One person on the roll-call, and everything the row needs about them. */
interface RollCallRow {
  person: RollCallPerson
  record: AttendanceRecord | null
  reading: DayReading
  late: boolean
  /** The outlet this row is judged against: where they worked, or where they are staff. */
  outlet: Tables<'outlets'> | null
}

function OutletAxis({
  outlets,
  people,
  onError,
}: {
  outlets: readonly Tables<'outlets'>[]
  people: AccountSummary[]
  onError: (message: string | null) => void
}) {
  const session = useSession()
  const { attendance } = useAdapters()
  // The same counts the navigation badge and the owner's chips read, so all
  // three agree and the read is made once (design D4).
  const { counts } = useWaitingCounts()

  // Today as each selected outlet reckons it. Where the cutovers disagree the
  // later one is used, so a day that has started somewhere is openable rather
  // than hidden behind a disabled arrow (design D7).
  const today = outlets
    .map((outlet) => resolveBusinessDate(new Date(), outlet.business_day_cutover))
    .reduce((latest, candidate) => (candidate > latest ? candidate : latest), '')

  const [businessDate, setBusinessDate] = useState(today)
  const [flow, setFlow] = useState<ApprovalFlow>({ kind: 'idle' })
  const [manualFor, setManualFor] = useState<AccountSummary | null>(null)
  const [denyFor, setDenyFor] = useState<AttendanceRecord | null>(null)
  const [correctFor, setCorrectFor] = useState<AttendanceRecord | null>(null)

  const outletIds = useMemo(() => outlets.map((outlet) => outlet.id), [outlets])
  const scopeKey = `${[...outletIds].sort().join(',')}|${businessDate}`

  /**
   * The day, and who the database says is accounted for out of sight, keyed by
   * the scope that produced them. Loading is derived from that key lagging what
   * is being asked for rather than blanked in the effect, which is what stops
   * the previous selection's rows rendering under the new one (design D8).
   */
  const [loaded, setLoaded] = useState<{
    key: string
    records: AttendanceRecord[]
    elsewhere: string[]
    /**
     * The day exactly as it arrived, kept beside the live records purely to
     * order the roll-call (design D12). Approvals update `records` and never
     * this, so settling a row cannot move the list; reloading the day replaces
     * both and re-sorts.
     */
    seed: readonly AttendanceRecord[]
    at: Date
  } | null>(null)

  // Position readings, one per outlet. A reading taken at one says nothing about
  // standing at another, so they never share a slot (design D6).
  const cachedPositions = useRef(new Map<string, { reading: PositionReading; at: number }>())
  useEffect(() => {
    cachedPositions.current.clear()
  }, [scopeKey])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [rows, away] = await Promise.all([
          attendance.listOutletDay(outletIds, businessDate),
          attendance.listElsewhere(outletIds, businessDate),
        ])
        if (!active) return
        setLoaded({ key: scopeKey, records: rows, elsewhere: away, seed: rows, at: new Date() })
        onError(null)
      } catch {
        if (active) onError('Could not load that day. Try again in a moment.')
      }
    })()
    return () => {
      active = false
    }
    // `onError` is a setState updater and stable; listing it would re-fetch the
    // day every time the parent re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, scopeKey, outletIds, businessDate])

  const day = loaded?.key === scopeKey ? loaded : null
  const records = day?.records ?? []

  function upsert(updated: readonly AttendanceRecord[]) {
    setLoaded((current) => {
      if (current === null) return current
      const byId = new Map(current.records.map((record) => [record.id, record]))
      for (const record of updated) byId.set(record.id, record)
      return { ...current, records: [...byId.values()] }
    })
  }

  const outletOf = (outletId: string | null) =>
    outlets.find((outlet) => outlet.id === outletId) ?? null

  /**
   * Read the manager's position once **per outlet**, then decide whether the
   * rule wants a reason. Inside that outlet's fence on the row's own business
   * day is one tap; anywhere or any day else costs a sentence, and the database
   * refuses the write without one whatever this decides.
   */
  async function beginApprove(ids: string[], outlet: Tables<'outlets'>) {
    if (ids.length === 0) return

    // A reading from the last minute stands in for a fresh one; anything older is
    // no longer a claim about where this manager is now.
    const cached = cachedPositions.current.get(outlet.id)
    if (cached && Date.now() - cached.at < POSITION_CACHE_MS) {
      return decideApproval(ids, outlet, cached.reading)
    }

    setFlow({ kind: 'locating', ids })
    const result = await readPosition()
    const reading = result.ok ? result.reading : null
    // Only a real reading is worth keeping. A failure is not cached, so the next
    // approval asks again rather than inheriting a silence.
    if (reading === null) cachedPositions.current.delete(outlet.id)
    else cachedPositions.current.set(outlet.id, { reading, at: Date.now() })
    return decideApproval(ids, outlet, reading)
  }

  /**
   * Decide what an approval costs, given a position reading that may have just
   * been taken or may be up to a minute old, judged against **the row's own**
   * outlet's fence and clock (design D6, D7).
   */
  async function decideApproval(
    ids: string[],
    outlet: Tables<'outlets'>,
    reading: PositionReading | null,
  ) {
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
    const sameDay = businessDate === resolveBusinessDate(new Date(), outlet.business_day_cutover)

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
      // The badge that pointed here has to go when the work is done, and it is
      // usually somewhere else on screen from the button that did it.
      attentionChanged()
    } catch (cause) {
      setFlow({ kind: 'idle' })
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  async function recordManual(person: AccountSummary, outletId: string, at: string) {
    try {
      upsert([
        await attendance.recordManualEntry({
          personId: person.id,
          outletId,
          businessDate,
          at,
          enteredBy: session.userId,
        }),
      ])
      setManualFor(null)
      onError(null)
      // A manual entry settles the day too, so it can only shrink a backlog.
      attentionChanged()
    } catch (cause) {
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  async function deny(record: AttendanceRecord, reason: string, preventRetry: boolean) {
    if (!record.currentAttemptId) return
    try {
      upsert([
        await attendance.deny({
          attendanceId: record.id,
          expectedAttemptId: record.currentAttemptId,
          expectedVersion: record.stateVersion,
          reason,
          preventRetry,
        }),
      ])
      setDenyFor(null)
      onError(null)
      attentionChanged()
    } catch (cause) {
      setDenyFor(null)
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  async function correct(
    record: AttendanceRecord,
    action: AttendanceCorrectionAction,
    reason: string,
    correctedAt: string | null,
  ) {
    try {
      const position = action === 'present' ? await readPosition() : null
      const reading = position?.ok ? position.reading : null
      upsert([
        await attendance.correct({
          attendanceId: record.id,
          expectedVersion: record.stateVersion,
          action,
          reason,
          reading,
          correctedAt,
        }),
      ])
      setCorrectFor(null)
      onError(null)
      attentionChanged()
    } catch (cause) {
      setCorrectFor(null)
      onError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    }
  }

  const onStaff: RollCallRow[] = people.map((person) => {
    const record = records.find((candidate) => candidate.personId === person.id) ?? null
    // Only the selected outlets this person is actually staff at get to decide
    // whether they are late arriving. Their day is judged against those clocks
    // and no others (design D7).
    const theirs = outlets.filter((outlet) => isStaffAt(person, outlet.id))
    const worked = outletOf(record?.outletId ?? null)
    return {
      person: {
        id: person.id,
        fullName: person.fullName,
        note: person.roleTitle,
        deactivated: !person.isActive,
        offList: false,
      },
      record,
      reading: readDay(record, theirs, businessDate, {
        accountedForElsewhere: day?.elsewhere.includes(person.id) ?? false,
      }),
      late: record !== null && worked !== null && isLate(record, worked.business_day_cutover),
      outlet: worked ?? theirs[0] ?? null,
    }
  })

  /**
   * Anybody carrying a record on this day who is not on a selected outlet's
   * staff list (design D4).
   *
   * Waiting counts are computed from rows, not from this list, so narrowing the
   * roll-call alone would leave a manager's own recorded row inside the count and
   * outside the screen — a badge nobody could ever clear. It costs nothing: the
   * day's records are already loaded and each one carries its person's name, so
   * the row renders from itself with no extra read.
   */
  const offList: RollCallRow[] = records
    .filter((record) => !people.some((person) => person.id === record.personId))
    .map((record) => {
      const worked = outletOf(record.outletId)
      return {
        person: {
          id: record.personId,
          fullName: record.personName,
          note: 'not on this outlet’s staff list',
          deactivated: false,
          offList: true,
        },
        record,
        reading: readDay(record, worked ? [worked] : [], businessDate),
        late: worked !== null && isLate(record, worked.business_day_cutover),
        outlet: worked,
      }
    })
    .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName))

  const unordered = [...onStaff, ...offList]

  // Put the waiting arrivals first. Ranked against the day as it loaded rather
  // than as it now stands, so approving a row cannot drop it down the list and
  // slide the next person's Approve button under a moving thumb (design D12).
  // The sort is stable, so `people`'s alphabetical order survives inside each rank.
  const rankAtLoad = (row: RollCallRow): number => {
    if (day === null) return READING_RANK.recorded
    const asLoaded = day.seed.find((record) => record.personId === row.person.id) ?? null
    return READING_RANK[
      readDay(asLoaded, row.outlet ? [row.outlet] : [], businessDate, {
        now: day.at,
        accountedForElsewhere: day.elsewhere.includes(row.person.id),
      }).kind
    ]
  }
  const rows =
    day === null ? unordered : [...unordered].sort((a, b) => rankAtLoad(a) - rankAtLoad(b))
  const waitingIds = rows
    .filter((row) => row.reading.kind === 'waiting')
    .map((row) => row.record?.id)
    .filter((id): id is string => id !== undefined)
  const busy = flow.kind === 'locating' || flow.kind === 'saving'

  // Whether the outlets IN SCOPE hold unsettled arrivals on days other than the
  // one on screen — the two extremes of their waiting dates, against the day
  // shown. Read from the entries for the selection only, so an outlet nobody
  // selected cannot mark these controls (design D3).
  //
  // There is no approve-all above the list, deliberately (design D8). Approving
  // is meant to be the moment somebody remembers this person turning up for this
  // shift, and one button settling the lot is how an unseen arrival gets counted.
  const scoped = waitingAt(counts, outletIds)
  const named = outlets.length > 1

  return (
    <>
      <DayPicker
        businessDate={businessDate}
        today={today}
        onChange={setBusinessDate}
        waiting={waitingIds.length}
        earlier={scoped !== null && scoped.oldest < businessDate}
        later={scoped !== null && scoped.newest > businessDate}
      />

      {day === null ? (
        <LoadingList label="this day’s roll-call" data-testid="day-loading" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nobody is on these outlets' staff lists yet. Add people under People."
        />
      ) : (
        <div data-testid="attendance-day" className="space-y-2">
          {rows.map((row) => (
            <PersonDay
              key={row.person.id}
              person={row.person}
              record={row.record}
              reading={row.reading}
              late={row.late}
              radiusMetres={row.outlet?.geofence_radius_m ?? 0}
              outletName={named ? (row.outlet?.name ?? null) : null}
              busy={busy}
              // Never for somebody listed only because a row exists: they have
              // the one thing this action would create. Nor for somebody
              // accounted for elsewhere: their day is taken, and the database
              // would refuse a second one.
              offerManual={
                businessDate === today &&
                !row.person.offList &&
                row.record?.checkIn == null &&
                row.reading.kind !== 'elsewhere'
              }
              onApprove={() => {
                const outlet = outletOf(row.record?.outletId ?? null)
                if (row.record && outlet) void beginApprove([row.record.id], outlet)
              }}
              onDeny={() => {
                if (row.record) setDenyFor(row.record)
              }}
              onCorrect={() => {
                if (row.record) setCorrectFor(row.record)
              }}
              onManual={() => {
                const staff = people.find((candidate) => candidate.id === row.person.id)
                if (staff) setManualFor(staff)
              }}
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
        // Only the selected outlets they are staff at: with one of those the
        // target is resolved and nothing is asked (design D10).
        outlets={manualFor ? outlets.filter((outlet) => isStaffAt(manualFor, outlet.id)) : []}
        businessDate={businessDate}
        onClose={() => setManualFor(null)}
        onRecord={(outletId, at) => {
          if (manualFor) void recordManual(manualFor, outletId, at)
        }}
      />

      <DenialSheet
        key={denyFor?.id ?? 'no-denial'}
        record={denyFor}
        radiusMetres={denyFor ? (outletOf(denyFor.outletId)?.geofence_radius_m ?? 0) : 0}
        onClose={() => setDenyFor(null)}
        onDeny={(reason, preventRetry) => {
          if (denyFor) void deny(denyFor, reason, preventRetry)
        }}
      />

      <CorrectionSheet
        key={correctFor?.id ?? 'no-correction'}
        record={correctFor}
        outlet={correctFor ? outletOf(correctFor.outletId) : null}
        onClose={() => setCorrectFor(null)}
        onCorrect={(action, reason, correctedAt) => {
          if (correctFor) void correct(correctFor, action, reason, correctedAt)
        }}
      />
    </>
  )
}

/**
 * Which day, and where else the work is.
 *
 * Three badges, all about the outlets in scope. The day's own count sits beside
 * its name, from the rows already on screen. The two arrows carry a bare dot
 * when the selection has unapproved arrivals before or after the day shown — a
 * number there would be a number about a day nobody is looking at, and the only
 * thing worth saying is "there is something that way".
 */
function DayPicker({
  businessDate,
  today,
  onChange,
  waiting,
  earlier,
  later,
}: {
  businessDate: string
  /** Today as the selection reckons it — the latest, where cutovers disagree. */
  today: string
  onChange: (date: string) => void
  /** Arrivals waiting for approval on the day shown. */
  waiting: number
  /** The selection holds unapproved arrivals on some earlier business day. */
  earlier: boolean
  /** …and on some later one. */
  later: boolean
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2">
      <span className="relative inline-flex">
        <Button
          variant="ghost"
          size="phone"
          aria-label="Previous day"
          onClick={() => onChange(shiftBusinessDate(businessDate, -1))}
        >
          <ChevronLeft aria-hidden size={18} />
        </Button>
        {earlier && (
          <span className="pointer-events-none absolute right-1 top-1">
            <BadgeDot
              data-testid="earlier-days-waiting"
              label="Earlier days hold arrivals waiting for approval"
            />
          </span>
        )}
      </span>

      <span className="inline-flex items-center gap-2">
        <span data-testid="day-label" className="text-sm font-semibold text-content">
          {businessDate === today ? 'Today' : formatBusinessDate(businessDate)}
        </span>
        <Badge
          data-testid="day-waiting"
          count={waiting}
          label={`${waitingLabel(waiting)} on this day`}
        />
      </span>

      <span className="relative inline-flex">
        <Button
          variant="ghost"
          size="phone"
          aria-label="Next day"
          disabled={businessDate >= today}
          onClick={() => onChange(shiftBusinessDate(businessDate, 1))}
        >
          <ChevronRight aria-hidden size={18} />
        </Button>
        {later && (
          <span className="pointer-events-none absolute right-1 top-1">
            <BadgeDot
              data-testid="later-days-waiting"
              label="Later days hold arrivals waiting for approval"
            />
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * One row of the roll-call. Deliberately not an `AccountSummary`: a person listed
 * only because they carry a record on this day (design D4) has no account behind
 * them here, and the row renders from the record itself.
 */
interface RollCallPerson {
  id: string
  fullName: string
  /** The job title, or why somebody off the staff list is on this day. */
  note: string | null
  deactivated: boolean
  /** Listed because a record exists rather than because they are staff here. */
  offList: boolean
}

function PersonDay({
  person,
  record,
  reading,
  late,
  radiusMetres,
  outletName,
  busy,
  offerManual,
  onApprove,
  onDeny,
  onCorrect,
  onManual,
}: {
  person: RollCallPerson
  record: AttendanceRecord | null
  reading: DayReading
  late: boolean
  radiusMetres: number
  /** Which shop this row belongs to. Null while only one is in scope. */
  outletName: string | null
  busy: boolean
  /** Can an arrival still be typed in for this person on this day? */
  offerManual: boolean
  onApprove: () => void
  onDeny: () => void
  onCorrect: () => void
  onManual: () => void
}) {
  const waiting = reading.kind === 'waiting'

  const actions =
    waiting || offerManual ? (
      <div className="flex flex-wrap gap-2 pt-0.5">
        {waiting && (
          <>
            <Button
              size="phone"
              disabled={busy}
              onClick={onApprove}
              data-testid={`approve-${person.id}`}
            >
              <ShieldCheck aria-hidden size={14} />
              Approve
            </Button>
            <Button
              variant="secondary"
              size="phone"
              disabled={busy}
              onClick={onDeny}
              data-testid={`deny-${person.id}`}
            >
              <XCircle aria-hidden size={14} />
              Deny
            </Button>
          </>
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
    ) : null

  /*
    The outlet sits with the person's job title rather than with the evidence,
    because the header is the one line a collapsed row shows and "which shop"
    is a question a manager scanning a two-outlet roll-call is asking. It stays
    a fact about the day rather than about the person: somebody staffed at two
    shops is not "a Kalyani person", they worked at Kalyani that day.
  */
  const notes: ReactNode[] = []
  if (person.note) notes.push(person.note)
  if (outletName)
    notes.push(
      <span key="outlet" data-testid="outlet-chip">
        {outletName}
      </span>,
    )
  if (person.deactivated) notes.push('deactivated')

  return (
    <AttendanceCard
      testId={`day-${person.id}`}
      toggleTestId={`expand-${person.id}`}
      waiting={waiting}
      defaultOpen={waiting}
      title={
        <span>
          {person.fullName}
          {notes.length > 0 && (
            <span className="ml-2 text-xs font-normal text-content-muted">
              {notes.map((note, index) => (
                <Fragment key={index}>
                  {index > 0 && ' · '}
                  {note}
                </Fragment>
              ))}
            </span>
          )}
        </span>
      }
      verdict={
        record ? <DayVerdict record={record} late={late} /> : <DerivedVerdict reading={reading} />
      }
      details={
        record || actions ? (
          <>
            {record && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <EventEvidence
                    label="Arrived"
                    event={record.checkIn}
                    radiusMetres={radiusMetres}
                  />
                </div>
                <ApprovalNote record={record} radiusMetres={radiusMetres} />
                <AttendanceHistory record={record} />
              </>
            )}
            {actions}
            {record && !waiting && record.attempts.length > 0 && (
              <Button
                variant="ghost"
                size="phone"
                onClick={onCorrect}
                data-testid={`correct-${person.id}`}
              >
                <RotateCcw aria-hidden size={14} />
                Correct attendance
              </Button>
            )}
          </>
        ) : null
      }
    />
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

/** Denial has exactly two manager inputs. The retry lock is always opt-in. */
function DenialSheet({
  record,
  radiusMetres,
  onClose,
  onDeny,
}: {
  record: AttendanceRecord | null
  radiusMetres: number
  onClose: () => void
  onDeny: (reason: string, preventRetry: boolean) => void
}) {
  const current = record?.attempts.find((attempt) => attempt.id === record.currentAttemptId) ?? null
  const initialReason = isOutOfFence(current, radiusMetres)
    ? 'Not at outlet'
    : isUnverifiable(current)
      ? 'Location could not be verified'
      : ''
  const [reason, setReason] = useState(initialReason)
  const [preventRetry, setPreventRetry] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim()) onDeny(reason.trim(), preventRetry)
  }

  return (
    <FormSheet
      open={record !== null}
      onClose={onClose}
      title="Deny this check-in"
      footer={
        <button
          type="submit"
          form="deny-attendance"
          disabled={!reason.trim()}
          className={`${buttonVariants({ variant: 'danger', size: 'phone' })} w-full`}
        >
          Deny check-in
        </button>
      }
    >
      <form id="deny-attendance" onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <label htmlFor="denial-reason" className="block text-sm font-semibold">
            Reason
          </label>
          <Input
            id="denial-reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="denial-reason"
          />
          <p className="text-xs text-content-muted">
            Denial marks this day absent. The reason is saved in the attendance history.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm text-content">
          <input
            type="checkbox"
            checked={preventRetry}
            onChange={(event) => setPreventRetry(event.target.checked)}
            data-testid="prevent-retry"
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-semibold">Prevent another check-in today</span>
            <span className="block text-xs text-content-muted">
              Leave unchecked to let the employee correct an outside or wrong-outlet check-in.
            </span>
          </span>
        </label>
      </form>
    </FormSheet>
  )
}

function correctionOptions(record: AttendanceRecord): {
  value: AttendanceCorrectionAction
  label: string
}[] {
  if (record.status === 'present') {
    return [
      { value: 'absent', label: 'Mark absent' },
      { value: 'absent_allow_retry', label: 'Mark absent and allow another check-in' },
      ...(record.checkIn ? [{ value: 'time' as const, label: 'Change check-in time' }] : []),
    ]
  }
  if (record.status === 'absent') {
    return [
      { value: 'present', label: 'Mark present' },
      record.retry.allowed
        ? { value: 'absent', label: 'Keep absent and prevent another check-in' }
        : { value: 'allow_retry', label: 'Allow another check-in' },
      ...(record.checkIn ? [{ value: 'time' as const, label: 'Change check-in time' }] : []),
    ]
  }
  return [
    { value: 'present', label: 'Mark present' },
    { value: 'absent', label: 'Mark absent' },
    ...(record.checkIn ? [{ value: 'time' as const, label: 'Change check-in time' }] : []),
  ]
}

/** One compact correction entry; opening it reveals only valid actions. */
function CorrectionSheet({
  record,
  outlet,
  onClose,
  onCorrect,
}: {
  record: AttendanceRecord | null
  outlet: Tables<'outlets'> | null
  onClose: () => void
  onCorrect: (
    action: AttendanceCorrectionAction,
    reason: string,
    correctedAt: string | null,
  ) => void
}) {
  const options = record ? correctionOptions(record) : []
  const [action, setAction] = useState<AttendanceCorrectionAction>(options[0]?.value ?? 'present')
  const [reason, setReason] = useState('')
  const [time, setTime] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!reason.trim() || (action === 'time' && (!time || !record || !outlet))) return
    const correctedAt =
      action === 'time'
        ? instantOnBusinessDay(record!.businessDate, time, outlet!.business_day_cutover)
        : null
    onCorrect(action, reason.trim(), correctedAt)
  }

  return (
    <FormSheet
      open={record !== null}
      onClose={onClose}
      title="Correct attendance"
      footer={
        <button
          type="submit"
          form="correct-attendance"
          disabled={!reason.trim() || (action === 'time' && !time)}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          Save correction
        </button>
      }
    >
      <form id="correct-attendance" onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <label htmlFor="correction-action" className="block text-sm font-semibold">
            Correction
          </label>
          <Select
            id="correction-action"
            value={action}
            onChange={(event) => setAction(event.target.value as AttendanceCorrectionAction)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {action === 'time' && (
          <div className="space-y-1">
            <label htmlFor="corrected-check-in-time" className="block text-sm font-semibold">
              Corrected check-in time
            </label>
            <Input
              id="corrected-check-in-time"
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <p className="text-xs text-content-muted">
              It must remain on this attendance day and cannot be in the future.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="correction-reason" className="block text-sm font-semibold">
            Reason
          </label>
          <Input
            id="correction-reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-content-muted">
            Every correction is appended to history. Marking present reads your current position;
            other corrections do not.
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
 *
 * **Which outlet is asked only when it is genuinely ambiguous** (design D10):
 * more than one selected outlet where this person is staff. With one, it is
 * resolved and nothing is asked.
 */
function ManualEntrySheet({
  person,
  outlets,
  businessDate,
  onClose,
  onRecord,
}: {
  person: AccountSummary | null
  /** The selected outlets this person is staff at. */
  outlets: readonly Tables<'outlets'>[]
  businessDate: string
  onClose: () => void
  onRecord: (outletId: string, at: string) => void
}) {
  const [time, setTime] = useState('')
  const [chosen, setChosen] = useState('')
  const outletId = chosen || (outlets[0]?.id ?? '')
  const outlet = outlets.find((candidate) => candidate.id === outletId) ?? null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!time || !outlet) return
    onRecord(outlet.id, instantOnBusinessDay(businessDate, time, outlet.business_day_cutover))
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
          disabled={!time || !outlet}
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
        {outlets.length > 1 && (
          <label className="block text-sm font-semibold">
            Which outlet were they at?
            <Select
              data-testid="manual-outlet"
              value={outletId}
              onChange={(event) => setChosen(event.target.value)}
            >
              {outlets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs font-normal text-content-muted">
              They are staff at both, and one day belongs to one outlet.
            </span>
          </label>
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
 * **No outlet picker on this axis** (attendance-one-day-per-person, design D4).
 * The read names no outlet at all, so what comes back is every outlet the reader
 * may see, resolved in the database from their own live assignments: one outlet
 * for a single-outlet Franchise Admin, their own for a multi-outlet one, all of
 * them for the owner. That is the question this axis exists to answer — how many
 * days did this person work — and a filter here could only ever make the answer
 * wrong.
 *
 * This revisits #28's D7, which pinned an explicit outlet on the read. That was
 * right while the intended meaning was one outlet. It is not the meaning now.
 *
 * **And no outlet filter either.** The surface used to hand this axis the people
 * and outlets narrowed to the by-outlet selection, so deselecting a shop above
 * emptied a picker that has nothing to do with shops — the exact confusion
 * splitting the axes was meant to end. `outlets` and `people` here are
 * everything the reader may see, whatever the chips say.
 */
function StaffAxis({
  outlets,
  people,
  onError,
}: {
  /** Every outlet the reader may see — never the selection. */
  outlets: readonly Tables<'outlets'>[]
  /** Everybody staffed at one of them — never the selection. */
  people: AccountSummary[]
  onError: (message: string | null) => void
}) {
  const { attendance } = useAdapters()
  const today = outlets
    .map((outlet) => resolveBusinessDate(new Date(), outlet.business_day_cutover))
    .reduce((latest, candidate) => (candidate > latest ? candidate : latest), '')

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
  const key = `${personId}|${range.from}|${range.to}`
  const records = loaded?.key === key ? loaded.records : null

  useEffect(() => {
    if (!personId) return
    let active = true
    void attendance
      .listPersonRange(personId, range.from, range.to)
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
  }, [attendance, key, personId, range.from, range.to])

  const days: DayRow[] = useMemo(() => {
    if (!records || !person) return []
    return assembleRange({
      records,
      outlets,
      range,
      // Every outlet this reader may see, so a person who moved between two of
      // them has one continuous month rather than two half ones.
      windows: person.assignments
        .filter((assignment) => assignment.outletId !== null)
        .map(({ outletId, startedOn, endedOn }) => ({
          outletId: outletId as string,
          startedOn,
          endedOn,
        })),
    })
  }, [records, person, outlets, range])

  if (people.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="Nobody is on these outlets' staff lists yet. Add people under People."
      />
    )
  }

  const radiusFor = (row: DayRow) =>
    outlets.find((outlet) => outlet.id === row.outletId)?.geofence_radius_m ?? 0

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
        <>
          <LoadingBlock label="the summary" className="mb-3" />
          <LoadingList label="this person’s days" data-testid="range-loading" />
        </>
      ) : (
        <>
          <TallySummary tally={tallyDays(days)} />
          <RangeDayList rows={days} radiusFor={radiusFor} showOutlet={outlets.length > 1} />
        </>
      )}
    </div>
  )
}
