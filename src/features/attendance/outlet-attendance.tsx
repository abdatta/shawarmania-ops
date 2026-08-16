import {
  CalendarCheck,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

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
import { AttendanceActionError, isRecoverableSetRefusal, isStaffAt } from '@/data-access/adapters'
import { attentionChanged } from '@/features/attention/attention'
import {
  evaluateFence,
  formatBusinessDate,
  instantOnBusinessDay,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { cn } from '@/lib/cn'
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
  AbsenceReason,
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
 * **One outlet scope sits above both axes**, in the header, where the Ledger
 * keeps its own — same reader, same shops, same phone, so a second idiom for it
 * would be a second thing to learn. It stays in one place whichever axis is
 * being read.
 *
 * That supersedes `attendance-one-day-per-person`'s design D4, which cut the
 * outlet choice out of the by-staff axis entirely (see this change's design D1).
 * The half of D4 that mattered is untouched and is what makes the reversal safe:
 * **the axis is still chosen freely and the by-staff read still names no outlet
 * at all**, so what comes back is resolved in the database from the reader's own
 * live assignments. The earlier arrangement, where the outlet came first and the
 * axis second, made "how many days did this person work in August" impossible to
 * ask without first naming one shop; that is still gone.
 *
 * **So the load is not scoped by the selection, and the selection narrows it
 * afterwards.** One read of `listOutlets` and one of `listAccounts`, neither
 * naming an outlet, both already scoped by policy: what comes back is exactly
 * every outlet this reader may see and everybody they may see. The chips
 * intersect that, for both axes — a filter applied after the policies have
 * decided, which widens nothing and is not a boundary.
 *
 * **What the chips do not narrow is a person's month.** `StaffAxis` is handed the
 * narrowed people and every outlet the reader may see, so somebody who moved from
 * one shop to another inside the period still reads as one continuous month
 * rather than two partial ones. Narrowing that would break the one question the
 * axis exists to answer.
 *
 * Departed people (`left_on` set) are not offered for new days; their recorded
 * rows remain readable through the by-staff axis over a range that covers them.
 */

/**
 * Which question is being asked of the outlets in scope.
 *
 * `day` was `outlet` until the chips moved above the axis control. Naming a tab
 * after the thing the chips beside it choose said the choice belonged to the
 * tab, which is exactly what stopped being true; and the axis was never really
 * about outlets anyway — it is one business date, across however many shops are
 * on.
 */
type Axis = 'day' | 'staff'

const AXIS_LABELS: Record<Axis, string> = { day: 'By day', staff: 'By staff' }

export function OutletAttendance() {
  const { outlets: outletsAdapter, accounts } = useAdapters()
  const session = useSession()

  const [axis, setAxis] = useState<Axis>('day')
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
  // between reads, not an empty day. Both axes wait on it now, because both are
  // scoped by it.
  const ready = loaded !== null && selectedOutlets.length > 0

  return (
    <div className="mx-auto max-w-2xl">
      {/*
        The scope above the axis, in the header, exactly where the Ledger puts
        its own. It applies to both axes and never moves.
      */}
      {/*
        The subtitle names the two axes rather than the surface. "Who was here,
        and where they were" described attendance to somebody who had not looked
        at it yet, which the roll-call underneath does better by being it. What
        is genuinely not obvious is the control directly below — that one tab is
        a day across the shops and the other is a person across a month — so
        that is the line worth spending.
      */}
      <PageHeader
        scope={outletSelector}
        title="Attendance"
        subtitle="A day's roll-call, or one person's month."
      />

      {/*
        One control in two halves, the same shape the Ledger uses for its own
        day/month switch. It was two loose buttons carrying `role="tab"` with no
        tabpanel and no `aria-controls` beneath them, which is a tablist that is
        not one; a pressed pair says what these are and says it the same way on
        both surfaces (design D3).
      */}
      <div
        role="group"
        aria-label="Read attendance by"
        data-testid="attendance-axis"
        className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
      >
        {(['day', 'staff'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={axis === candidate}
            data-testid={`axis-${candidate}`}
            onClick={() => setAxis(candidate)}
            className={cn(
              'h-[var(--size-control-phone)] rounded-lg text-sm font-semibold focus-visible:focus-ring',
              axis === candidate
                ? 'bg-primary text-on-primary'
                : 'text-content-muted hover:bg-surface-raised hover:text-content',
            )}
          >
            {AXIS_LABELS[candidate]}
          </button>
        ))}
      </div>

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
      ) : axis === 'day' ? (
        <OutletAxis
          key={scopeKey}
          outlets={selectedOutlets}
          people={selectedPeople}
          onError={setError}
        />
      ) : (
        // The narrowed people, and every outlet the reader may see. The chips
        // decide who is offered; they must not decide which outlets a chosen
        // person's month is assembled against, or somebody who moved shops in
        // August would read as two partial months.
        <StaffAxis outlets={loaded.outlets} people={selectedPeople} onError={setError} />
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
 * The 60-second position reuse window is gone (attendance-batch-decisions,
 * design D5).
 *
 * It existed only so that approving one person at a time did not mean one GPS
 * read per person, which is the problem a selected set solves properly. Every
 * action now reads the position for that action, so every stored approval
 * position is a reading taken in direct response to it rather than one that may
 * be up to a minute old — and the capability carries one freshness rule instead
 * of two.
 */

/**
 * `1 arrival`, `3 arrivals`. A set of one now reaches the confirmation like any
 * other (design D10), so the titles that only ever saw two or more have to stop
 * reading `1 arrivals`.
 */
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * Where the manager's position left this action, for the confirmation.
 *
 * The manager did not type this one, but it is part of what the decision will
 * say, and it is the half of an approval a person reading their own day is most
 * likely to argue with. Stated as a fact about the reading rather than as a
 * verdict on any one row: the database judges each row for itself, and a set
 * that straddles a fence has no single answer to give.
 */
function positionWord(reading: PositionReading | null, partition: Partition): string {
  if (reading === null) return 'not recorded'
  if (partition.reasoned.length === 0) return 'at the outlet'
  if (partition.plain.length === 0) {
    return partition.why === 'away' ? 'away from the outlet' : 'at the outlet, day already closed'
  }
  return 'read once, judged per row'
}

/** Rank a day by how much it wants somebody's attention (design D12). */
const READING_RANK: Record<DayReading['kind'], number> = {
  waiting: 0,
  'not-yet-arrived': 1,
  absent: 2,
  elsewhere: 3,
  recorded: 4,
}

/**
 * One person in the set being decided, with everything the sheets need to name
 * them and the command needs to settle them.
 *
 * The decision id travels with the row from the moment the set is fixed, so a
 * retry after a lost response replays the same command rather than minting a
 * second identity for the same act.
 */
interface Chosen {
  record: AttendanceRecord
  personName: string
  outlet: Tables<'outlets'> | null
  decisionId: string
}

/**
 * How one reading falls across the selected rows, judged per row against that
 * row's own outlet fence and that row's own business day.
 *
 * Explanatory only. The database decides this again for itself and stores the
 * reason only where it was owed; a client that treated this as enforcement
 * would drift the moment the two disagreed.
 */
interface Partition {
  plain: Chosen[]
  reasoned: Chosen[]
  why: 'away' | 'no-position' | 'closed-day'
}

/**
 * What an approval is waiting on, once the manager's position is known.
 *
 * `confirm` travels with the flow because the naming gate follows the **route**
 * rather than the count (design D10): anything decided from the set's action bar
 * is named back before the write, a set of one included, and the per-row buttons
 * name nothing because the row is what is already being looked at.
 */
type ApprovalFlow =
  | { kind: 'idle' }
  | { kind: 'locating' }
  /** The rule wants a reason. `why` is what the sheet explains. */
  | {
      kind: 'reason'
      commandId: string
      rows: Chosen[]
      reading: PositionReading | null
      partition: Partition
      confirm: boolean
    }
  /** The last gate: the people, by name, before anything is written. */
  | {
      kind: 'confirm'
      commandId: string
      rows: Chosen[]
      reading: PositionReading | null
      reason: string | null
      partition: Partition
    }
  | { kind: 'saving' }

/** Denial reads no position, so it has one fewer step than approval. */
type DenialFlow =
  | { kind: 'idle' }
  | { kind: 'reason'; commandId: string; rows: Chosen[]; confirm: boolean }
  | { kind: 'confirm'; commandId: string; rows: Chosen[]; reason: string; preventRetry: boolean }
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
  const [denialFlow, setDenialFlow] = useState<DenialFlow>({ kind: 'idle' })
  const [manualFor, setManualFor] = useState<AccountSummary | null>(null)
  const [correctFor, setCorrectFor] = useState<AttendanceRecord | null>(null)

  /**
   * The set the manager is building, by attendance id.
   *
   * **Every person joins it by an action of its own.** There is no Select all
   * and no subset shortcut of any kind — not by outlet, not by lateness, not
   * select-the-rest, no range drag and no press-and-hold sweep. The saving this
   * surface offers is in acting on a set, never in building one, which is what
   * keeps an approval a statement about a person somebody remembers arriving.
   *
   * `Clear` is the one control that touches several at once, and it is safe for
   * the reason the others are not: it only ever removes people from an action.
   *
   * **There is no separate selecting flag: the mode is the set** (design D10).
   * Selection is on exactly when somebody is in it, so the first press enters it
   * and taking the last person out leaves it, as does `Clear`, as does a refusal
   * that drops every row, as does the day arriving with every selected row
   * already settled by somebody else. One piece of state, and a count that
   * cannot disagree with a mode.
   *
   * **Carried with the scope that produced it**, the same way the day itself is,
   * so leaving the day or changing the outlets empties it by arithmetic rather
   * than by an effect racing the render that reads it. A selection is about rows
   * that are on screen; one surviving a scope change would leave people selected
   * that nobody can see.
   */
  const [selectionState, setSelectionState] = useState<{
    key: string
    ids: readonly string[]
    /** Named on screen after a refusal dropped them: their day moved under the set. */
    dropped: readonly string[]
  } | null>(null)

  const outletIds = useMemo(() => outlets.map((outlet) => outlet.id), [outlets])
  const scopeKey = `${[...outletIds].sort().join(',')}|${businessDate}`

  const selection =
    selectionState?.key === scopeKey
      ? selectionState
      : { key: scopeKey, ids: [] as readonly string[], dropped: [] as readonly string[] }
  const selected = selection.ids
  const dropped = selection.dropped

  function reviseSelection(next: { ids?: readonly string[]; dropped?: readonly string[] }) {
    setSelectionState({
      key: scopeKey,
      ids: next.ids ?? selection.ids,
      dropped: next.dropped ?? selection.dropped,
    })
  }

  /**
   * Add or remove one person, **from whatever the set is when this runs** rather
   * than from what it was when the row rendered.
   *
   * Two presses landing in one React batch otherwise both compute their new list
   * from the same stale closure and the second wins outright, so one of the two
   * people is silently not in the set. A thumb cannot produce that; a stylus, an
   * assistive device replaying two taps, or a browser dispatching a queued pair
   * can. A set that quietly loses somebody is the one failure this whole
   * capability is built to prevent, so it is worth the updater form.
   */
  function toggleRow(id: string) {
    setSelectionState((current) => {
      const base =
        current?.key === scopeKey
          ? current
          : { key: scopeKey, ids: [] as readonly string[], dropped: [] as readonly string[] }
      return {
        key: scopeKey,
        ids: base.ids.includes(id)
          ? base.ids.filter((candidate) => candidate !== id)
          : [...base.ids, id],
        dropped: base.dropped,
      }
    })
  }

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
   * Turn a set of chosen attendance ids into the rows the sheets name and the
   * command settles. Each one takes its decision identity here, once, so every
   * later step — including a retry after a lost response — carries the same one.
   */
  function chooseRows(ids: readonly string[]): Chosen[] {
    return ids
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is AttendanceRecord => record?.currentAttemptId != null)
      .map((record) => ({
        record,
        personName: record.personName,
        outlet: outletOf(record.outletId),
        decisionId: crypto.randomUUID(),
      }))
  }

  function toItems(rows: readonly Chosen[]) {
    return rows.map((row) => ({
      attendanceId: row.record.id,
      expectedAttemptId: row.record.currentAttemptId as string,
      expectedVersion: row.record.stateVersion,
      decisionId: row.decisionId,
    }))
  }

  /**
   * Where one reading leaves each selected row, judged against **that row's**
   * own outlet fence and **that row's** own business day (design D4).
   *
   * One reading across several outlets is one statement about where the manager
   * was, not a claim to have been at each of them: the same instant is simply
   * measured against several fixed points, which is what the database does.
   */
  function partitionOf(rows: readonly Chosen[], reading: PositionReading | null): Partition {
    const plain: Chosen[] = []
    const reasoned: Chosen[] = []
    let anyClosed = false
    for (const row of rows) {
      const outlet = row.outlet
      const inside =
        outlet !== null &&
        reading !== null &&
        evaluateFence(
          {
            latitude: outlet.latitude,
            longitude: outlet.longitude,
            radiusMetres: outlet.geofence_radius_m,
          },
          reading,
        ).kind === 'inside'
      const sameDay =
        outlet !== null &&
        row.record.businessDate === resolveBusinessDate(new Date(), outlet.business_day_cutover)
      if (inside && sameDay) plain.push(row)
      else {
        reasoned.push(row)
        if (inside && !sameDay) anyClosed = true
      }
    }
    return {
      plain,
      reasoned,
      why: anyClosed ? 'closed-day' : reading === null ? 'no-position' : 'away',
    }
  }

  /**
   * One reading, taken in direct response to this action and never carried over
   * to a later one. Inside every selected row's fence on its own business day is
   * one tap; anything else costs one sentence covering the rows that need it,
   * and the database refuses the write without one whatever this decides.
   */
  async function beginApprove(rows: Chosen[], confirm: boolean) {
    if (rows.length === 0) return
    const commandId = crypto.randomUUID()
    setFlow({ kind: 'locating' })
    const result = await readPosition()
    const reading = result.ok ? result.reading : null
    const partition = partitionOf(rows, reading)

    if (partition.reasoned.length > 0) {
      setFlow({ kind: 'reason', commandId, rows, reading, partition, confirm })
      return
    }
    if (confirm) {
      setFlow({ kind: 'confirm', commandId, rows, reading, reason: null, partition })
      return
    }
    await submitApproval(commandId, rows, null, reading)
  }

  async function submitApproval(
    commandId: string,
    rows: readonly Chosen[],
    reason: string | null,
    reading: PositionReading | null,
  ) {
    setFlow({ kind: 'saving' })
    try {
      upsert(
        await attendance.approve(toItems(rows), {
          commandId,
          reason,
          reading,
          approverId: session.userId,
        }),
      )
      setFlow({ kind: 'idle' })
      finishAction()
    } catch (cause) {
      setFlow({ kind: 'idle' })
      await recover(cause, rows)
    }
  }

  function beginDeny(rows: Chosen[], confirm: boolean) {
    if (rows.length === 0) return
    // Denial reads no position at all, at any size of set: it says the attempts
    // should not count, not that the manager stood anywhere.
    setDenialFlow({ kind: 'reason', commandId: crypto.randomUUID(), rows, confirm })
  }

  async function submitDenial(
    commandId: string,
    rows: readonly Chosen[],
    reason: string,
    preventRetry: boolean,
  ) {
    setDenialFlow({ kind: 'saving' })
    try {
      upsert(await attendance.deny(toItems(rows), { commandId, reason, preventRetry }))
      setDenialFlow({ kind: 'idle' })
      finishAction()
    } catch (cause) {
      setDenialFlow({ kind: 'idle' })
      await recover(cause, rows)
    }
  }

  /** A successful action leaves nothing selected, so the next one starts fresh. */
  function finishAction() {
    setSelectionState({ key: scopeKey, ids: [], dropped: [] })
    onError(null)
    // The badge that pointed here has to go when the work is done, and it is
    // usually somewhere else on screen from the button that did it.
    attentionChanged()
  }

  /**
   * A refusal costs the action, never the selection (design D7).
   *
   * The command settled nothing and deliberately does not say which rows moved,
   * because describing them would mean the database narrating rows the caller
   * may not be entitled to read. So the day is read again here and the surface
   * diffs its own selection: whatever is still waiting on the same attempt and
   * version stays selected, and whatever moved is dropped and named.
   */
  async function recover(cause: unknown, rows: readonly Chosen[]) {
    const message =
      cause instanceof AttendanceActionError
        ? cause.message
        : 'That did not work. Try again in a moment.'
    if (!isRecoverableSetRefusal(cause)) {
      onError(message)
      return
    }
    try {
      const [fresh, away] = await Promise.all([
        attendance.listOutletDay(outletIds, businessDate),
        attendance.listElsewhere(outletIds, businessDate),
      ])
      setLoaded({ key: scopeKey, records: fresh, elsewhere: away, seed: fresh, at: new Date() })
      const moved = rows.filter((row) => {
        const now = fresh.find((candidate) => candidate.id === row.record.id)
        return (
          now == null ||
          now.currentAttemptId !== row.record.currentAttemptId ||
          now.stateVersion !== row.record.stateVersion
        )
      })
      const survivors = rows.filter((row) => !moved.includes(row)).map((row) => row.record.id)
      setSelectionState({
        key: scopeKey,
        ids: survivors,
        dropped: moved.map((row) => row.personName),
      })
      onError(message)
    } catch {
      onError(message)
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
  const busy = flow.kind === 'locating' || flow.kind === 'saving' || denialFlow.kind === 'saving'

  // A row that settled, was retried, or was decided by somebody else while the
  // set was open cannot stay silently selected. Derived rather than pruned in an
  // effect, so the count on the action bar can never disagree with the rows.
  const chosen = selected.filter((id) => waitingIds.includes(id))
  // The mode IS the set (design D10). Nothing else turns selection on or off.
  const selecting = chosen.length > 0

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
      {/*
        One slot, two occupants, and it never moves (design D10).

        The set's action bar REPLACES the day picker rather than appearing under
        the list. A bar that appears pushes every row down at the exact moment of
        the first press, sliding the row just pressed out from under the thumb,
        which is the movement the load-time ranking exists to prevent; and a bar
        at the foot of a phone roll-call is a bar that scrolls away. Both are the
        same height, so the list below starts in the same place either way.

        Sticky, because the manager is scrolling a roll-call while they build the
        set. The shell header is not sticky, so once it has scrolled away the
        rows get the whole screen with this pinned above them. The negative
        margin bleeds the backing across `main`'s padding, so cards pass under it
        rather than beside it.

        Losing the day arrows while a set is open is honest: changing the day
        empties the set. Nothing about which day is lost either, because the
        reason sheet says when a business day has closed and the denial sheet
        names each row's own date.
      */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 bg-canvas px-4 py-2">
        {selecting ? (
          <SelectionBar
            count={chosen.length}
            busy={busy}
            onApprove={() => void beginApprove(chooseRows(chosen), true)}
            onDeny={() => beginDeny(chooseRows(chosen), true)}
            onClear={() => {
              reviseSelection({ ids: [], dropped: [] })
            }}
          />
        ) : (
          <DayPicker
            businessDate={businessDate}
            today={today}
            onChange={setBusinessDate}
            waiting={waitingIds.length}
            earlier={scoped !== null && scoped.oldest < businessDate}
            later={scoped !== null && scoped.newest > businessDate}
          />
        )}
      </div>

      {dropped.length > 0 && (
        <p
          role="status"
          data-testid="selection-dropped"
          className="mb-3 rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted"
        >
          {dropped.join(', ')} {dropped.length === 1 ? 'was' : 'were'} decided or checked in again
          while this action was open, so {dropped.length === 1 ? 'that row was' : 'those rows were'}{' '}
          taken out of the set. Nothing was recorded. Everybody else is still selected.
        </p>
      )}

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
              // Selection is offered on every waiting row, including a row
              // belonging to somebody who holds no staff assignment here: it
              // counts towards the waiting badge, so leaving it out would strand
              // work a manager could only clear one row at a time.
              selecting={selecting}
              selectable={row.reading.kind === 'waiting' && row.record !== null}
              selected={row.record !== null && chosen.includes(row.record.id)}
              onToggleSelect={() => {
                if (row.record) toggleRow(row.record.id)
              }}
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
              // The per-row buttons name nobody back: this row is the thing
              // already being looked at, so confirming it would be asking
              // somebody to agree with the tap they have just made.
              onApprove={() => {
                if (row.record) void beginApprove(chooseRows([row.record.id]), false)
              }}
              onDeny={() => {
                if (row.record) beginDeny(chooseRows([row.record.id]), false)
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
        key={flow.kind === 'reason' ? flow.commandId : 'no-reason'}
        flow={flow}
        namedOutlets={named}
        onClose={() => setFlow({ kind: 'idle' })}
        onApprove={(reason) => {
          if (flow.kind !== 'reason') return
          // The confirmation is always the last step, so where a reason was
          // required the manager reads the names in the light of what they have
          // just written rather than before it.
          if (flow.confirm) {
            setFlow({
              kind: 'confirm',
              commandId: flow.commandId,
              rows: flow.rows,
              reading: flow.reading,
              reason,
              partition: flow.partition,
            })
            return
          }
          void submitApproval(flow.commandId, flow.rows, reason, flow.reading)
        }}
      />

      <ConfirmSheet
        open={flow.kind === 'confirm'}
        title={flow.kind === 'confirm' ? `Approve ${plural(flow.rows.length, 'arrival')}` : ''}
        action="Approve them"
        rows={flow.kind === 'confirm' ? flow.rows : []}
        namedOutlets={named}
        details={
          flow.kind === 'confirm'
            ? [
                ...(flow.reason ? [{ label: 'Your reason', value: `“${flow.reason}”` }] : []),
                { label: 'Your position', value: positionWord(flow.reading, flow.partition) },
              ]
            : []
        }
        note={
          flow.kind === 'confirm' && flow.reason !== null && flow.partition.plain.length > 0
            ? `Your reason reaches only the ${flow.partition.reasoned.length} that need it.`
            : null
        }
        onClose={() => setFlow({ kind: 'idle' })}
        onConfirm={() => {
          if (flow.kind === 'confirm')
            void submitApproval(flow.commandId, flow.rows, flow.reason, flow.reading)
        }}
      />

      <DenialSheet
        key={denialFlow.kind === 'reason' ? denialFlow.commandId : 'no-denial'}
        flow={denialFlow}
        radiusFor={(outletId) => outletOf(outletId)?.geofence_radius_m ?? 0}
        onClose={() => setDenialFlow({ kind: 'idle' })}
        onDeny={(reason, preventRetry) => {
          if (denialFlow.kind !== 'reason') return
          if (denialFlow.confirm) {
            setDenialFlow({
              kind: 'confirm',
              commandId: denialFlow.commandId,
              rows: denialFlow.rows,
              reason,
              preventRetry,
            })
            return
          }
          void submitDenial(denialFlow.commandId, denialFlow.rows, reason, preventRetry)
        }}
      />

      <ConfirmSheet
        open={denialFlow.kind === 'confirm'}
        title={
          denialFlow.kind === 'confirm' ? `Deny ${plural(denialFlow.rows.length, 'check-in')}` : ''
        }
        action="Deny them"
        danger
        rows={denialFlow.kind === 'confirm' ? denialFlow.rows : []}
        namedOutlets={named}
        details={
          denialFlow.kind === 'confirm'
            ? [
                { label: 'Your reason', value: `“${denialFlow.reason}”` },
                {
                  // Stated whichever way it was left, because leaving it
                  // unticked is a decision about somebody's day too. Two words:
                  // the sheet behind this one already explained what the choice
                  // means, and saying it twice in different words made the last
                  // screen read like a warning nobody could parse.
                  label: 'Another check-in',
                  value: denialFlow.preventRetry ? 'not allowed' : 'allowed',
                },
              ]
            : []
        }
        note={null}
        onClose={() => setDenialFlow({ kind: 'idle' })}
        onConfirm={() => {
          if (denialFlow.kind === 'confirm')
            void submitDenial(
              denialFlow.commandId,
              denialFlow.rows,
              denialFlow.reason,
              denialFlow.preventRetry,
            )
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
    <div className="rounded-xl border border-border bg-surface p-2">
      <div className="flex items-center justify-between gap-2">
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
    </div>
  )
}

/**
 * The set, and the two things that can be done with it.
 *
 * It occupies the day picker's slot rather than sitting under the list, so
 * entering selection moves nothing (design D10). It states the exact count
 * rather than a word for it: `Approve` over an unstated number is the rubber
 * stamp this capability exists to avoid.
 *
 * `Clear` is here and no other multi-row control is, for one reason: it only
 * ever takes people OUT of an action. Without it a mis-tapped selection has to
 * be undone one row at a time.
 *
 * The buttons carry no icons and the row does not wrap. The count and three
 * labels have to hold one line at 375px, and a second line would put back the
 * movement occupying the picker's slot exists to avoid.
 */
function SelectionBar({
  count,
  busy,
  onApprove,
  onDeny,
  onClear,
}: {
  count: number
  busy: boolean
  onApprove: () => void
  onDeny: () => void
  onClear: () => void
}) {
  return (
    <div
      data-testid="selection-bar"
      className="flex items-center gap-2 rounded-xl border border-primary bg-surface p-2"
    >
      <span
        role="status"
        data-testid="selection-count"
        className="shrink-0 text-sm font-semibold text-content"
      >
        {count} selected
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="phone" disabled={busy} onClick={onApprove} data-testid="approve-selected">
          Approve
        </Button>
        <Button
          variant="secondary"
          size="phone"
          disabled={busy}
          onClick={onDeny}
          data-testid="deny-selected"
        >
          Deny
        </Button>
        <Button
          variant="ghost"
          size="phone"
          disabled={busy}
          onClick={onClear}
          data-testid="clear-selection"
        >
          Clear
        </Button>
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
  selecting,
  selectable,
  selected,
  onToggleSelect,
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
  /** Is a set being built on this day? */
  selecting: boolean
  /** Only a row currently waiting for a decision can join one. */
  selectable: boolean
  selected: boolean
  onToggleSelect: () => void
  /** Can an arrival still be typed in for this person on this day? */
  offerManual: boolean
  onApprove: () => void
  onDeny: () => void
  onCorrect: () => void
  onManual: () => void
}) {
  const waiting = reading.kind === 'waiting'
  // A person with no row on a past day has no evidence and no action, but if the
  // deadline has passed they are absent, and an absence says why.
  const derivedAbsence = record === null && reading.kind === 'absent'

  /*
    Selection is entered here, on the row it is about, leftmost in the row's own
    action group (design D10). It carries no word: an empty box and a checked box
    say add and added, and a label beside them on every waiting row costs the
    width the two real actions need. Its accessible name states the person, so
    eight waiting rows are eight distinct controls rather than eight buttons all
    called Select.

    Leftmost on purpose. When a set exists and `Approve` and `Deny` go, this
    button does not move.
  */
  const actions =
    waiting || offerManual ? (
      <div className="flex flex-wrap gap-2 pt-0.5">
        {waiting && (
          <>
            {selectable && (
              <Button
                // Empty, it carries the outlined shape `Deny` has, so it reads
                // as one of the row's controls rather than as a stray glyph
                // floating beside them. Checked, it takes `Approve`'s fill, so
                // who is in the set is legible down a scrolled roll-call rather
                // than resting on a 16px difference between two small boxes.
                variant={selected ? 'primary' : 'secondary'}
                size="phone"
                // Square, so the box sits the same distance from every edge.
                // The sized variants set a height and a horizontal padding,
                // which on a control holding one glyph and no word reads as a
                // wide button with a small mark adrift in it.
                className="w-[var(--size-control-phone)] px-0"
                disabled={busy}
                onClick={onToggleSelect}
                aria-label={
                  selected
                    ? `Take ${person.fullName} out of this action`
                    : `Add ${person.fullName} to this action`
                }
                title={selected ? 'Take out of this action' : 'Add to this action'}
                data-testid={`select-${person.id}`}
              >
                {selected ? (
                  <CheckSquare aria-hidden size={16} />
                ) : (
                  <Square aria-hidden size={16} />
                )}
              </Button>
            )}
            {/*
              Two ways to act on one row is the ambiguity this capability least
              needs, so while a set exists the set's own actions are the only
              ones. `Record arrival` and `Correct attendance` stay: they appear
              only on rows that are not waiting, which can never be in a set.
            */}
            {!selecting && (
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
      /*
        Every control that decides this row lives in the panel, so a waiting row
        that could be closed is a row a manager can neither act on nor tell apart
        from one they have already put in a set. Tapping the body still means
        "show me this" on every other row, in selection and out of it, so reading
        somebody's evidence never disturbs the set (design D9).
      */
      pinnedOpen={waiting}
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
        record || actions || derivedAbsence ? (
          <>
            <AbsenceReason reading={reading} subjectId={person.id} />
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
 * How one reading fell across the selected rows, grouped by treatment and named
 * by outlet, so a manager sees which of the people they picked their sentence
 * is actually going to be recorded against.
 *
 * Three or more outlets read the same way as two; there is no two-outlet special
 * case to get wrong. It is explanation, never enforcement — the database decides
 * this again for itself.
 */
function PartitionSummary({
  partition,
  namedOutlets,
}: {
  partition: Partition
  namedOutlets: boolean
}) {
  const group = (rows: readonly Chosen[]) => {
    const byOutlet = new Map<string, number>()
    for (const row of rows) {
      const name = row.outlet?.name ?? 'this outlet'
      byOutlet.set(name, (byOutlet.get(name) ?? 0) + 1)
    }
    return [...byOutlet.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const line = (count: number, name: string) => (namedOutlets ? `${name}: ${count}` : `${count}`)

  return (
    <div data-testid="approval-partition" className="space-y-1 text-sm">
      {partition.plain.length > 0 && (
        <p className="text-content-muted">
          Approved normally:{' '}
          {group(partition.plain)
            .map(([name, count]) => line(count, name))
            .join(' · ')}
        </p>
      )}
      <p className="text-content">
        Need your reason:{' '}
        {group(partition.reasoned)
          .map(([name, count]) => line(count, name))
          .join(' · ')}
      </p>
      {partition.plain.length > 0 && (
        <p className="text-xs text-content-muted">
          Your reason is recorded only against the {partition.reasoned.length} that need it.
        </p>
      )}
    </div>
  )
}

/**
 * The reason, asked for only when the rule wants one.
 *
 * Not pre-filled and not defaulted: the point of recording one is that a person
 * decided something, and a placeholder answer would make it a formality. A
 * manager standing at the counter on the day never sees this sheet at all, which
 * is the difference the rule is built around.
 *
 * One reason covers the whole set. Where the set spans outlets it is stored only
 * on the rows that were away, which the summary above says plainly rather than
 * leaving the manager to infer from where they happen to be standing.
 */
function ReasonSheet({
  flow,
  namedOutlets,
  onClose,
  onApprove,
}: {
  flow: ApprovalFlow
  namedOutlets: boolean
  onClose: () => void
  onApprove: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const open = flow.kind === 'reason'
  const copy = flow.kind === 'reason' ? WHY_COPY[flow.partition.why] : null
  const count = flow.kind === 'reason' ? flow.rows.length : 0
  // Whether a confirmation follows. It is the route that decides, not the count
  // (design D10), so a set of one built on the bar reads `Continue` too.
  const continues = flow.kind === 'reason' && flow.confirm

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
          {continues ? 'Continue' : 'Approve and record my reason'}
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
        {flow.kind === 'reason' && count > 1 && (
          <PartitionSummary partition={flow.partition} namedOutlets={namedOutlets} />
        )}
        <div className="space-y-1">
          <label htmlFor="approval-reason" className="block text-sm font-semibold">
            Why are you approving {count > 1 ? 'these' : 'this'}?
          </label>
          <Input
            id="approval-reason"
            required
            value={reason}
            placeholder="e.g. Seen at the counter this morning before I left"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-content-muted">
            This is stored on the record and is visible to the people it is about.
          </p>
        </div>
      </form>
    </FormSheet>
  )
}

/**
 * The last gate before anything is written: every selected person by name, the
 * outlet they belong to, and their business date where the set spans dates.
 *
 * Shown only where more than one person is being decided. A single row is
 * already the thing being looked at, and confirming it would be asking somebody
 * to agree with the tap they just made.
 */
function ConfirmSheet({
  open,
  title,
  action,
  rows,
  namedOutlets,
  details,
  note,
  danger = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  action: string
  rows: readonly Chosen[]
  namedOutlets: boolean
  /**
   * Everything else about to be written, in the manager's own words where they
   * gave any: the reason they typed, the choice they ticked, and where their
   * position was read.
   *
   * The gate is the last thing between a set and an immutable decision, so it
   * has to show the whole of what that decision will say. Naming the people and
   * hiding the sentence being recorded against them would confirm half an act.
   */
  details: readonly { label: string; value: string }[]
  /** One extra sentence about the shared consequence, where there is one. */
  note: string | null
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  // A set may span business dates, so a person appearing on two of them has to
  // read as two rows rather than as a duplicate somebody distrusts.
  const spansDates = new Set(rows.map((row) => row.record.businessDate)).size > 1

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <button
          type="button"
          data-testid="confirm-set"
          onClick={onConfirm}
          className={`${buttonVariants({ variant: danger ? 'danger' : 'primary', size: 'phone' })} w-full`}
        >
          {action}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-content-muted">Nothing is recorded until you confirm.</p>
        <ul data-testid="confirm-people" className="space-y-1">
          {rows.map((row) => (
            <li
              key={`${row.record.id}`}
              className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-lg bg-surface-raised px-2 py-1.5 text-sm"
            >
              <span className="font-semibold text-content">{row.personName}</span>
              <span className="text-xs text-content-muted">
                {[
                  namedOutlets ? (row.outlet?.name ?? null) : null,
                  spansDates ? formatBusinessDate(row.record.businessDate) : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {details.length > 0 && (
          <dl data-testid="confirm-details" className="space-y-1 text-sm">
            {details.map((detail) => (
              <div key={detail.label} className="flex flex-wrap gap-x-2">
                <dt className="text-content-muted">{detail.label}:</dt>
                <dd className="min-w-0 flex-1 font-semibold text-content">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {note && (
          <p data-testid="confirm-note" className="text-sm text-content">
            {note}
          </p>
        )}
      </div>
    </FormSheet>
  )
}

/**
 * Denial has exactly two manager inputs, and both apply to everybody selected.
 * The retry lock is always opt-in, and its consequence is stated before it is
 * used — naming the count and each row's own business date rather than saying
 * `today`, because a set may reach back over days that have closed.
 */
function DenialSheet({
  flow,
  radiusFor,
  onClose,
  onDeny,
}: {
  flow: DenialFlow
  radiusFor: (outletId: string) => number
  onClose: () => void
  onDeny: (reason: string, preventRetry: boolean) => void
}) {
  const rows = flow.kind === 'reason' ? flow.rows : []
  /*
    An evidence-derived prefill is reused only where it is true of EVERY
    selected attempt. Where the set mixes measured-outside attempts with
    unverifiable ones the reason starts blank instead, because a sentence that
    is false about half a set is worse than no sentence: it would be recorded
    against people it does not describe, and they can read it.
  */
  const evidence = rows.map((row) => {
    const current =
      row.record.attempts.find((attempt) => attempt.id === row.record.currentAttemptId) ?? null
    const radius = radiusFor(row.record.outletId)
    if (isOutOfFence(current, radius)) return 'Not at outlet'
    if (isUnverifiable(current)) return 'Location could not be verified'
    return ''
  })
  const shared = evidence.every((candidate) => candidate === evidence[0]) ? (evidence[0] ?? '') : ''

  const [reason, setReason] = useState(shared)
  const [preventRetry, setPreventRetry] = useState(false)

  const dates = [...new Set(rows.map((row) => row.record.businessDate))].sort()
  const spansDates = dates.length > 1

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim()) onDeny(reason.trim(), preventRetry)
  }

  return (
    <FormSheet
      open={flow.kind === 'reason'}
      onClose={onClose}
      title={rows.length > 1 ? `Deny ${rows.length} check-ins` : 'Deny this check-in'}
      footer={
        <button
          type="submit"
          form="deny-attendance"
          disabled={!reason.trim()}
          className={`${buttonVariants({ variant: 'danger', size: 'phone' })} w-full`}
        >
          {flow.kind === 'reason' && flow.confirm ? 'Continue' : 'Deny check-in'}
        </button>
      }
    >
      <form id="deny-attendance" onSubmit={submit} className="space-y-4" noValidate>
        {rows.length > 1 && (
          <p data-testid="denial-shared" className="text-sm text-content-muted">
            This reason and this choice apply to all {rows.length} of them.
          </p>
        )}
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
            Denial marks {rows.length > 1 ? 'these days' : 'this day'} absent. The reason is saved
            in the attendance history.
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
            <span className="font-semibold">
              {spansDates
                ? 'Prevent another check-in on each of these business dates'
                : `Prevent another check-in on ${dates[0] ? formatBusinessDate(dates[0]) : 'this business date'}`}
            </span>
            <span className="block text-xs text-content-muted">
              {rows.length > 1
                ? `Applies to all ${rows.length}, each on their own business date. Leave unchecked to let them correct an outside or wrong-outlet check-in.`
                : 'Leave unchecked to let the employee correct an outside or wrong-outlet check-in.'}
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
 * **The read names no outlet at all**, so what comes back is every outlet the
 * reader may see, resolved in the database from their own live assignments: one
 * outlet for a single-outlet Franchise Admin, their own for a multi-outlet one,
 * all of them for the owner. That is the question this axis exists to answer —
 * how many days did this person work — and naming a set here could only
 * duplicate the policy or contradict it.
 *
 * This revisits #28's D7, which pinned an explicit outlet on the read. That was
 * right while the intended meaning was one outlet. It is not the meaning now.
 *
 * **The outlet chips narrow `people` and nothing else** (this change's D1).
 * `outlets` remains everything the reader may see, so a person who moved from one
 * shop to another mid-month is still assembled into one continuous month; only
 * who is *offered* follows the chips. The read above is untouched by either.
 */
function StaffAxis({
  outlets,
  people,
  onError,
}: {
  /** Every outlet the reader may see — never the selection. */
  outlets: readonly Tables<'outlets'>[]
  /** Those of them staffed at a selected outlet. */
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
  //
  // **Validated against the list, not merely defaulted from it.** The chips can
  // narrow a chosen person away mid-read, and a `<select>` whose value points
  // outside its options is how a surface ends up showing one person's month
  // under another person's name. Deliberately not a reset: the month stays where
  // the reader put it, because the month is a fact about what they are reading
  // and not about which shops are on.
  const personId = people.some((candidate) => candidate.id === chosenPersonId)
    ? chosenPersonId
    : (people[0]?.id ?? '')
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
      {/*
        Named to a screen reader, captioned to nobody. A control showing a
        person's name under a tab reading "By staff" was already saying whose
        attendance this is, and "Whose attendance" above it said it a third
        time — the same caption the outlet chips dropped, for the same reason.
        The accessible name stays, because a bare combobox announces nothing.
      */}
      <Select
        aria-label="Whose attendance"
        data-testid="person-picker"
        className="mb-3"
        value={personId}
        onChange={(event) => setChosenPersonId(event.target.value)}
      >
        {people.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.fullName}
          </option>
        ))}
      </Select>

      <RangePicker range={range} today={today} onChange={setRange} />

      {records === null ? (
        <>
          <LoadingBlock label="the summary" className="mb-3" />
          <LoadingList label="this person’s days" data-testid="range-loading" />
        </>
      ) : (
        <>
          <TallySummary tally={tallyDays(days)} />
          {/* Whoever the picker names — usually somebody else, occasionally the
              reader themselves, and the sentences follow either way. */}
          <RangeDayList
            rows={days}
            radiusFor={radiusFor}
            personId={personId}
            showOutlet={outlets.length > 1}
          />
        </>
      )}
    </div>
  )
}
