import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Check,
  ChevronDown,
  Clock,
  LoaderCircle,
  Lock,
  MapPin,
  MapPinOff,
  Pencil,
  TriangleAlert,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Explain } from '@/components/ui/why'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  DRAWER_HISTORY_PAGE,
  type DrawerObservationRecord,
  type DrawerState,
} from '@/data-access/adapters'
import {
  APPROXIMATE_WINDOW_MINUTES,
  evaluateFence,
  formatDateTime,
  formatDayTime,
  formatMetres,
  formatPaise,
  formatTime,
  nextOpeningPaise,
  rupeesToPaise,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'
import { useOnForeground } from '@/features/attention/attention'
import { cn } from '@/lib/cn'
import { readPosition, type GeolocationFailureKind, type PositionReading } from '@/lib/geolocation'

import { boundaryMove, countAdvice, expectedAtInstant } from './drawer-arithmetic'
import {
  ExpensesBreakdown,
  LastLeftBreakdown,
  ReceiptsBreakdown,
  breakdownContext,
  verdictOf,
} from './drawer-breakdowns'
import {
  classifyDrawerTabletTelemetry,
  type DrawerTabletTelemetry,
} from './drawer-tablet-telemetry'

/**
 * The Cash drawer — the surface this business was commissioned to get right, at
 * the second attempt.
 *
 * **It opens on a balance, not a date picker.** That is the question the
 * collector has when they walk in: what should be in the drawer right now. The
 * screen it replaces opened on a business date and asked for a count against a
 * whole day's cash sales, which produced a fiction on every ordinary night —
 * ₹4,640 of it in one measured month across two outlets.
 *
 * **It is read on a phone, at 22:00, by somebody holding cash.** So a *fact* is a
 * chip and a *reason* is behind a `Why`. The first version of this file rendered
 * every reason inline and became a page of warning-coloured paragraphs, which is
 * how a reader learns to skip the paragraph that matters.
 *
 * Three things are load-bearing, each has a test, and **none of them may go
 * behind a disclosure**, because they are what the reader acts on:
 *
 *   * **The difference appears on the keystroke that produces it**, before
 *     anything is submitted, with its direction as a word as well as a sign. A
 *     minus is the first thing a small screen loses.
 *
 *   * **A negative amount announces that it means money ADDED**, on the keystroke
 *     that makes it negative rather than at submission. The stated action, the
 *     balance preview and the confirming control all flip with the sign.
 *
 *   * **An exact bill-run coincidence is reported as a fact; a nearby instant is
 *     never proposed.** See `drawer-arithmetic.ts`, where the refusal lives so it
 *     can be asserted directly.
 *
 * The 2026-08-28 pass over this file added three more that are equally not
 * negotiable, each with its decision in `design.md`:
 *
 *   * **Every count is approximate** (D19). No control asserts an exact instant,
 *     because counting a drawer takes minutes while the counter keeps trading.
 *
 *   * **Where the recorder stood is read, never typed** (D20), and the reason
 *     field appears exactly when the fence says it must — where it is required.
 *     Before this the surface sent no position at all, so every record was
 *     off-site and the database's own constraint would have refused a count
 *     whose "optional" reason was left empty.
 *
 *   * **The count history is paged** (D21). It was capped at one read, which two
 *     outlets counted daily outgrow in a fortnight.
 *
 * The 2026-08-30 pass added the last of them, and replaced a piece of reasoning
 * this file used to carry.
 *
 *   * **Every term in the balance is reachable from the figure that states
 *     it.** Cash from Bills opens a day-by-day reading of the interval; Cash
 *     Expenses opens the same list and entry form the Expenses tab renders, one
 *     per business date, each with its own Add. Both partition the INTERVAL and
 *     never the calendar day, both are grouped by the database from the same
 *     predicate as the tile they explain, and both therefore sum to it.
 *
 *   * **Only Collect and Other Spend are gone, and what they cost was not
 *     tidiness.** This file used to argue for keeping them as a quieter escape
 *     hatch — distance rather than invisibility. That argument is now history,
 *     and here is what replaced it. `In the drawer now` is four terms — opening,
 *     plus receipts, less expenses, less cash out — and the strip beneath it
 *     shows three. `cashOutSincePaise` had no tile, so taking ₹5,000 out between
 *     counts dropped the headline by ₹5,000 with nothing on the card accounting
 *     for it. Deleting the only two controls that could create a standalone
 *     movement makes every movement part of a count, folded into `Last Left` by
 *     `nextOpeningPaise` — so the three tiles are a complete account of the
 *     headline **by construction** rather than by adding a fourth tile for a
 *     term measured at zero occurrences in production. Neither had ever been
 *     used: `drawer_cash_out` held two rows on 2026-08-29, both collections,
 *     both attached to a count. The database keeps both kinds and every grant,
 *     so re-offering a spend is a control, not a migration.
 */

type Sheet = 'none' | 'count' | 'adjust' | 'edit' | 'left' | 'receipts' | 'expenses'

/**
 * Where the recorder is standing, as far as the sheet can tell.
 *
 * Four outcomes, and the difference that matters is between the first — which
 * asks nothing — and the other three, which all require a reason for the same
 * reason: nothing on the row would show the person was there.
 */
type Whereabouts =
  | { kind: 'locating' }
  | { kind: 'on-site'; reading: PositionReading; distanceMetres: number }
  | { kind: 'away'; reading: PositionReading; distanceMetres: number }
  /** A reading, but an outlet with no captured position to measure it against. */
  | { kind: 'unsurveyed'; reading: PositionReading }
  | { kind: 'unlocatable'; failure: GeolocationFailureKind }

const FAILURE_COPY: Record<GeolocationFailureKind, string> = {
  denied: 'Location permission is off, so nothing can show you were at the outlet.',
  unavailable: 'Your phone could not find a position, so nothing can show you were at the outlet.',
  timeout: 'Finding your position took too long, so nothing can show you were at the outlet.',
  unsupported: 'This browser cannot share a location, so nothing can show you were at the outlet.',
}

/** True when the record needs the recorder to say why they were elsewhere. */
function needsReason(where: Whereabouts | null): boolean {
  return where !== null && where.kind !== 'locating' && where.kind !== 'on-site'
}

/** The position to send, which is whatever was read — including from far away. */
function readingOf(where: Whereabouts | null): PositionReading | null {
  if (!where) return null
  return where.kind === 'locating' || where.kind === 'unlocatable' ? null : where.reading
}

/**
 * The relative options, and the only ones. Anything else is a stated instant,
 * reached through the platform's own picker.
 */
const RELATIVE_TIMES = [
  // These make the direction explicit without relying on the stated instant
  // below. The spoken labels remain complete for a reader who gets no line.
  { label: 'Now', spoken: 'Counted just now', minutes: 0 },
  { label: '15m ago', spoken: 'Counted 15 minutes ago', minutes: 15 },
  { label: '30m ago', spoken: 'Counted 30 minutes ago', minutes: 30 },
] as const

/** `datetime-local` speaks local wall-clock with no zone. Both directions here. */
function toLocalInput(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

/** The drawer's loading silhouette, including the metric-bearing count rows. */
function DrawerLoading() {
  return (
    <LoadingRegion label="the drawer" className="space-y-3" data-testid="drawer-loading">
      {[4, 4].map((rowCount, card) => (
        <div key={card} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="space-y-2">
            {Array.from({ length: rowCount }, (_, index) => (
              <Shimmer key={index} className="h-6" />
            ))}
          </div>
        </div>
      ))}
      <div className="px-1">
        <Shimmer className="h-4 w-28" />
      </div>
      {[0, 1, 2].map((row) => (
        <Card key={row} className="overflow-hidden p-0">
          <div className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
            <div className="space-y-2">
              <Shimmer className="h-4 w-40 max-w-full" />
              <Shimmer className="h-3 w-48 max-w-full" />
            </div>
            <div className="flex items-center gap-2">
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((metric) => (
                  <div key={metric} className="space-y-1">
                    <Shimmer className="ml-auto h-3 w-14" />
                    <Shimmer className="ml-auto h-5 w-12" />
                  </div>
                ))}
              </div>
              <Shimmer className="h-5 w-4" />
            </div>
          </div>
        </Card>
      ))}
    </LoadingRegion>
  )
}

export function CashDrawerSurface() {
  const { cashDrawer: adapter, counter, outlets: outletsAdapter } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()
  const session = useSession()

  const [state, setState] = useState<DrawerState | null>(null)
  const [outlet, setOutlet] = useState<Tables<'outlets'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<Sheet>('none')

  /**
   * Tablets holding work they have not delivered.
   *
   * Read from the counter adapter rather than folded into `DrawerState`, because
   * the drawer's policy grants no reach over `counter_devices` and an adapter
   * borrowing an authority the database did not give it is the seam violation
   * this repo's layering exists to prevent.
   */
  const [tabletTelemetryReading, setTabletTelemetryReading] = useState<{
    outletId: string
    value: DrawerTabletTelemetry
  } | null>(null)
  const latestTabletRead = useRef(0)
  const tabletTelemetry =
    tabletTelemetryReading?.outletId === outletId ? tabletTelemetryReading.value : null

  // The count sheet.
  const [counted, setCounted] = useState('')
  // Empty, not '0'. A pre-filled nought is a figure somebody has to clear
  // before typing, and leaving it alone already means nothing was collected.
  const [collecting, setCollecting] = useState('')
  const [countedAt, setCountedAt] = useState<Date>(() => new Date())
  const [sheetOpenedAt, setSheetOpenedAt] = useState<number>(() => Date.now())
  /**
   * A reference instant for the "not in the future" check, ticking while the
   * count sheet is open.
   *
   * Separate from `sheetOpenedAt`, which must stay frozen: the relative options
   * are measured from it, and an anchor that advanced would move a time the
   * recorder had already chosen out from under them.
   */
  const [clock, setClock] = useState<number>(() => Date.now())
  const [awayReason, setAwayReason] = useState('')

  // Where the person is, read once when a recording sheet opens (design D20).
  const [where, setWhere] = useState<Whereabouts | null>(null)

  // The adjustment sheet, and the edit sheet beside it.
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [adjustedAmount, setAdjustedAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  /**
   * The edit sheet's own fields.
   *
   * `editedNote` starts as the stored note rather than blank, and `editedAt`
   * as the stored instant. Both are what makes an edit a *correction of this
   * observation* rather than a fresh statement of it — the note used to be
   * wiped by every amount edit precisely because nothing on screen held it.
   */
  const [editedNote, setEditedNote] = useState('')
  const [editedAt, setEditedAt] = useState<Date>(() => new Date())
  const [editOpenedAt, setEditOpenedAt] = useState<number>(() => Date.now())

  // Pages of the count history beyond the first, which arrives with the state.
  const [older, setOlder] = useState<DrawerObservationRecord[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [paging, setPaging] = useState(false)

  /**
   * Everything read under the previous outlet goes before anything is fetched
   * for the new one, so nothing is ever on screen under the wrong outlet's name
   * — the paged counts least of all, since two outlets' histories interleave
   * into one plausible-looking list.
   *
   * Adjusted during render rather than in an effect, which is React's own
   * pattern for this: an effect would paint one frame of the old outlet's rows
   * under the new outlet's name before it ran.
   */
  const [readingFor, setReadingFor] = useState<string | null>(outletId)
  if (readingFor !== outletId) {
    setReadingFor(outletId)
    setState(null)
    setOlder([])
    setExhausted(false)
  }

  const load = useCallback(async () => {
    if (!outletId) return
    setState(await adapter.getState(outletId))
  }, [adapter, outletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void adapter
      .getState(outletId)
      .then((loaded) => {
        if (active) setState(loaded)
      })
      .catch(() => {
        if (active) setError('Could not read the drawer. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outletsAdapter
      .getOutlet(outletId)
      .then((found) => {
        if (active) setOutlet(found)
      })
      // The fence is then unjudgeable, which reads as away and asks for a
      // reason. Never a reason to stop somebody recording what they counted.
      .catch(() => {
        if (active) setOutlet(null)
      })
    return () => {
      active = false
    }
  }, [outletsAdapter, outletId])

  const loadTabletTelemetry = useCallback(async () => {
    if (!outletId) return
    const request = ++latestTabletRead.current
    try {
      const devices = await counter.listDevices()
      if (request === latestTabletRead.current) {
        setTabletTelemetryReading({
          outletId,
          value: classifyDrawerTabletTelemetry(devices, outletId),
        })
      }
    } catch {
      // Keep the last qualified reading. Telemetry is advisory and never stops
      // the collector from recording the cash physically in front of them.
    }
  }, [counter, outletId])

  useEffect(() => {
    if (!outletId) return
    const request = ++latestTabletRead.current
    void counter
      .listDevices()
      .then((devices) => {
        if (request === latestTabletRead.current) {
          setTabletTelemetryReading({
            outletId,
            value: classifyDrawerTabletTelemetry(devices, outletId),
          })
        }
      })
      .catch(() => undefined)
    return () => {
      latestTabletRead.current += 1
    }
  }, [counter, outletId])

  const refreshTabletTelemetry = useCallback(() => {
    void loadTabletTelemetry()
  }, [loadTabletTelemetry])
  useOnForeground(refreshTabletTelemetry)

  // Only while a sheet that states an instant is open: nowhere else on this
  // surface asks what time it is, and a timer running behind a closed sheet is a
  // wakeup for nothing. Both the count sheet and the edit sheet refuse an
  // instant in the future, and both need a reference that does not go stale
  // while somebody thinks about it.
  useEffect(() => {
    if (sheet !== 'count' && sheet !== 'edit') return
    const timer = setInterval(() => setClock(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [sheet])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      return true
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  // ── The count history, first page plus whatever has been paged in ────────
  //
  // Merged and deduplicated rather than concatenated: a count recorded while
  // somebody is reading pushes the first page's oldest row down into territory
  // an older page already covers, and two rows for one count is a figure
  // apparently recorded twice.
  const observations = useMemo(() => {
    const seen = new Set<string>()
    return [...(state?.recentObservations ?? []), ...older]
      .filter((row) => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
      })
      .sort((a, b) => b.countedAt.localeCompare(a.countedAt))
  }, [state, older])

  // The cursor lives in a ref so `loadMore` keeps one identity across pages —
  // the observer effect below re-subscribes on every change of it.
  const cursor = useRef<string | null>(null)
  useEffect(() => {
    cursor.current = observations.at(-1)?.countedAt ?? null
  }, [observations])

  /**
   * There is no `hasMore` on `DrawerState`, so a full first page is taken as a
   * reason to look. The cost of guessing wrong is one read that returns nothing
   * and settles the question; the cost of not looking is a history that ends
   * silently at ten.
   */
  const mayHaveMore = !exhausted && (state?.recentObservations.length ?? 0) >= DRAWER_HISTORY_PAGE

  const loadMore = useCallback(async () => {
    if (!outletId) return
    setPaging(true)
    try {
      const page = await adapter.listObservations(outletId, { before: cursor.current })
      setOlder((was) => [...was, ...page.observations])
      if (!page.hasMore || page.observations.length === 0) setExhausted(true)
    } catch {
      // Stop asking rather than retrying into the same failure on every scroll.
      // The counts already on screen are unaffected, and a reload starts over.
      setExhausted(true)
      setError('Could not read older counts.')
    } finally {
      setPaging(false)
    }
  }, [adapter, outletId])

  /**
   * Load the next page when the end of the list comes into view.
   *
   * The button below does the same job and is not a fallback nobody sees: it is
   * what a keyboard reader walking the list uses, and it is the only path in an
   * environment without `IntersectionObserver` — jsdom, for one, which is why
   * the paging tests press it.
   */
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !mayHaveMore || paging) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, mayHaveMore, paging, observations.length])

  // ── What the sheet may say, computed as it is typed ──────────────────────
  const countedRupees = Number(counted.trim())
  const countedUsable =
    counted.trim() !== '' && Number.isFinite(countedRupees) && countedRupees >= 0

  const advice = useMemo(() => {
    if (!state || !countedUsable || state.lastObservation === null) return null
    // Always approximate (design D19): a count takes minutes, the counter keeps
    // trading, and no instant a person supplies is the edge of that act.
    return countAdvice(state, rupeesToPaise(countedRupees), countedAt, true)
  }, [state, countedUsable, countedRupees, countedAt])

  const boundary = useMemo(() => {
    if (!state || state.lastObservation === null) return null
    return expectedAtInstant(state, countedAt)
  }, [state, countedAt])

  /**
   * What the two breakdowns need: the state, and two business dates resolved
   * through **the outlet's own cutover** rather than a constant this file used
   * to carry. Null until both the drawer and the outlet have arrived.
   */
  const breakdown = useMemo(
    () => (state ? breakdownContext(state, outlet?.business_day_cutover ?? null) : null),
    [state, outlet],
  )

  /**
   * What the sheet refuses before the database gets the chance.
   *
   * Both bounds are enforced in Postgres and both come back as a sentence naming
   * what they collided with — but a person who has just typed a time should be
   * told by the field, not by a round trip.
   */
  const timeProblem = useMemo(() => {
    const at = countedAt.getTime()
    if (Number.isNaN(at)) return 'Pick the date and time the drawer was counted.'
    if (at > clock) return 'A count cannot be taken in the future.'
    const previous = state?.lastObservation?.countedAt
    if (previous && countedAt.toISOString() <= previous) {
      return `This drawer was already counted at ${formatDayTime(previous)}. Pick a later time.`
    }
    return null
  }, [clock, countedAt, state])

  /**
   * Business dates that have passed **since the one the last count belongs to**,
   * and so have never been counted.
   *
   * `daysCovered` is the inclusive span of the pending interval, which always
   * includes the last count's own business date — and that date was counted. So
   * a count at 23:16 last night read as "2 days uncounted" by nine the next
   * morning, which is wrong twice over: the night before was counted, and today
   * has barely started.
   *
   * The chip appears from **two** upward, so a day still in progress never nags.
   * At one there is nothing to say: nobody counts at nine in the morning, and a
   * warning that fires every single day is a warning nobody reads. At two, a
   * whole business date has passed with no count at all, which is the point the
   * next difference stops being attributable to one night.
   */
  const uncountedDays = Math.max(0, (state?.daysCovered ?? 0) - 1)

  /** What the drawer should hold at the stated instant. Null before the anchor. */
  const expectedPaise = boundary && state?.lastObservation ? boundary.expectedPaise : null

  const collectingRupees = Number(collecting.trim())
  const collectingUsable = collecting.trim() !== '' && Number.isFinite(collectingRupees)
  const collectingPaise = collectingUsable ? rupeesToPaise(collectingRupees) : 0
  // **A negative is cash going IN.** Same field, same record, no second control —
  // and the meaning is stated on the keystroke that creates it.
  const collectingIsAdding = collectingUsable && collectingPaise < 0
  const leavingPaise = countedUsable ? rupeesToPaise(countedRupees) - collectingPaise : null

  const reasonMissing = needsReason(where) && awayReason.trim() === ''

  /**
   * Dismiss a sheet, but only if it is still the one on screen.
   *
   * **Swapping one sheet for another fires the first one's `close`.** `Modal`
   * closes its `<dialog>` in an effect when `open` goes false, and a closing
   * dialog dispatches `close` — so handing a sheet `closeSheets` directly means
   * opening its successor immediately tears the successor down again. The guard
   * reads the sheet state *after* the swap, so a genuine dismissal still clears
   * every field and a swap leaves the new sheet alone.
   */
  function closeIfCurrent(kind: Sheet) {
    if (sheet === kind) closeSheets()
  }

  function closeSheets() {
    setSheet('none')
    setCounted('')
    setCollecting('')
    setAwayReason('')
    setAdjustingId(null)
    setAdjustedAmount('')
    setAdjustReason('')
    setEditedNote('')
    setWhere(null)
    setCountedAt(new Date())
    setError(null)
  }

  /**
   * One position, read because a person opened a sheet to record something.
   *
   * The same class of event as pressing **Check in**, through the same module —
   * `src/lib/geolocation.ts` is still the only thing in this app that touches
   * `navigator.geolocation`, and nothing here watches or samples. It is
   * deliberately not awaited by the caller: every field is usable while it
   * resolves, and a collector holding the drawer does not wait for GPS.
   */
  const locate = useCallback(async () => {
    setWhere({ kind: 'locating' })
    const result = await readPosition()
    if (!result.ok) {
      setWhere({ kind: 'unlocatable', failure: result.kind })
      return
    }
    const verdict = evaluateFence(
      {
        latitude: outlet?.latitude ?? null,
        longitude: outlet?.longitude ?? null,
        radiusMetres: outlet?.geofence_radius_m ?? 0,
      },
      result.reading,
    )
    if (verdict.kind === 'unreferenced') {
      setWhere({ kind: 'unsurveyed', reading: result.reading })
      return
    }
    setWhere(
      verdict.kind === 'inside'
        ? { kind: 'on-site', reading: result.reading, distanceMetres: verdict.distanceMetres }
        : { kind: 'away', reading: result.reading, distanceMetres: verdict.distanceMetres },
    )
  }, [outlet])

  function openCount() {
    const now = Date.now()
    setSheetOpenedAt(now)
    setClock(now)
    setCountedAt(new Date(now))
    setCounted('')
    // Zero, not blank: the common night collects nothing, and the leaving
    // preview should be right before anybody types into this field.
    setCollecting('')
    setAwayReason('')
    setSheet('count')
    void loadTabletTelemetry()
    void locate()
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault()
    if (!outletId || !countedUsable || timeProblem || reasonMissing) return
    const ok = await run(async () => {
      await adapter.recordObservation({
        outletId,
        countedAt: countedAt.toISOString(),
        countedTotalPaise: rupeesToPaise(countedRupees),
        // Never asserted (design D19). Every count carries the window.
        certain: false,
        position: readingOf(where),
        awayReason: needsReason(where) ? awayReason.trim() : null,
        cashOut:
          collectingUsable && collectingPaise !== 0
            ? { amountPaise: collectingPaise, kind: 'collection' }
            : null,
      })
    })
    if (ok) closeSheets()
  }

  /**
   * The quick correction, for a count nothing has anchored on yet.
   *
   * **No reason, and no trail** — that is the whole distinction from an
   * adjustment, and it is deliberate (design D8). Nobody has relied on this
   * figure, so a typo caught two minutes later should not have to wear a
   * permanent correction with a justification attached. The database is what
   * enforces the boundary: `edit_drawer_observation` refuses the moment a later
   * count reads this one as its opening, and the surface stops offering it at
   * the same instant for the same reason.
   */
  async function submitEdit(event: FormEvent) {
    event.preventDefault()
    if (!adjustingId || !adjusting) return
    const rupees = Number(adjustedAmount.trim())
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError('Enter what the count should have been, in rupees.')
      return
    }
    if (editTimeProblem) {
      setError(editTimeProblem)
      return
    }
    const moved = editedAt.toISOString() !== adjusting.countedAt
    const ok = await run(async () => {
      await adapter.editObservation(adjustingId, {
        countedTotalPaise: rupeesToPaise(rupees),
        // Always sent, which is the whole of the note fix: the field holds what
        // is stored, so leaving it alone re-sends it and clearing it clears it.
        note: editedNote.trim(),
        // Omitted where the instant did not move, so the command takes the
        // cheap path and nothing recomputes for an amount-only correction.
        ...(moved ? { countedAt: editedAt.toISOString() } : {}),
      })
    })
    if (ok) closeSheets()
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault()
    if (!adjustingId) return
    const rupees = Number(adjustedAmount.trim())
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError('Enter what the count should have been, in rupees.')
      return
    }
    const ok = await run(async () => {
      await adapter.adjustObservation(adjustingId, rupeesToPaise(rupees), adjustReason)
    })
    if (ok) closeSheets()
  }

  const adjusting = observations.find((row) => row.id === adjustingId) ?? null
  // Editable until the next observation anchors on it, so the most recent is the
  // only one nothing has anchored on.
  const newestId = observations[0]?.id ?? null

  /**
   * What a moved boundary does to the count being edited, in one sentence.
   *
   * **The database is what recomputes the expected total**, by calling the same
   * three interval readers that computed it at recording — this is only the
   * statement, drawn from the nearby cash bills the surface already holds as
   * evidence for the movable boundary. Two different arithmetics would be the
   * thing `drawer-arithmetic.ts` exists to prevent.
   */
  const editMoved =
    state && adjusting ? boundaryMove(state, new Date(adjusting.countedAt), editedAt) : null

  /**
   * The recording bounds, asked by the field rather than by a round trip. The
   * database enforces all three and names what each collided with; a person who
   * has just moved a time should not have to press Save to find out.
   */
  const editTimeProblem = ((): string | null => {
    if (!adjusting) return null
    const at = editedAt.getTime()
    if (Number.isNaN(at)) return 'Pick the date and time the drawer was counted.'
    if (at > clock) return 'A count cannot be taken in the future.'
    const previous = observations.find((row) => row.countedAt < adjusting.countedAt)
    if (previous && editedAt.toISOString() <= previous.countedAt) {
      return `This drawer was already counted at ${formatDayTime(previous.countedAt)}. Pick a later time.`
    }
    return null
  })()

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader scope={outletSelector} title="Cash drawer" />

      {error && (
        <p
          role="alert"
          data-testid="drawer-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {state === null ? (
        <DrawerLoading />
      ) : (
        <div className="space-y-3">
          {state.exceptions.length > 0 && (
            <Card className="space-y-2" data-testid="drawer-exception">
              <ChipRow>
                <Explain
                  label="why a late arrival is not folded in"
                  explanation={
                    <>
                      A count is what somebody saw. Work landing afterwards is reported here rather
                      than folded in, because rewriting a recorded figure is the failure this whole
                      chain exists to prevent.
                    </>
                  }
                >
                  <Chip tone="warn" icon={TriangleAlert}>
                    Needs a look
                  </Chip>
                </Explain>
              </ChipRow>

              {state.exceptions.map((exception) => (
                <div
                  key={exception.sourceId}
                  className="space-y-1 border-t border-border pt-2"
                  data-testid={`exception-${exception.sourceId}`}
                >
                  <p className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-content-muted">{exception.label}</span>
                    <Money paise={exception.amountPaise} className="font-semibold" />
                  </p>
                  <ChipRow>
                    <Chip icon={Clock}>rung {formatTime(exception.occurredAt)}</Chip>
                    <Chip icon={Clock}>arrived {formatDayTime(exception.arrivedAt)}</Chip>
                    {exception.explainsRecordedVariance ? (
                      <Chip tone="good" icon={Check}>
                        explains that count
                      </Chip>
                    ) : (
                      <Chip tone="neutral">
                        would have been <Money paise={exception.differenceWouldHaveBeenPaise} />
                      </Chip>
                    )}
                    {exception.acknowledgedAt && (
                      <Chip tone="good" icon={Check}>
                        accepted {formatDayTime(exception.acknowledgedAt)}
                      </Chip>
                    )}
                  </ChipRow>
                  {exception.acknowledgementNote && (
                    <p className="text-xs italic text-content-muted">
                      {exception.acknowledgementNote}
                    </p>
                  )}
                  {!exception.acknowledgedAt && (
                    <div className="flex gap-2">
                      <Button
                        size="phone"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            adapter.acknowledgeException(
                              exception.observationId,
                              exception.sourceKind,
                              exception.sourceId,
                            ),
                          )
                        }
                        data-testid={`accept-${exception.sourceId}`}
                      >
                        Accept
                      </Button>
                      <Button size="phone" variant="secondary" onClick={openCount}>
                        Count again
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}

          {/* ── The balance ─────────────────────────────────────────────── */}
          <Card className="space-y-3" data-testid="drawer-balance">
            {state.lastObservation === null ? (
              // Before the anchor there is no balance to state, and inventing one
              // would be the fabricated figure decision 18 refuses.
              <div className="space-y-2" data-testid="drawer-not-tracked">
                <p className="text-sm font-semibold text-content">
                  This drawer has never been counted.
                </p>
                <ChipRow>
                  <Explain
                    label="what not tracked yet means"
                    explanation={
                      <>
                        Count it once and the record begins there. Earlier days keep their revenue
                        and expenses and say the drawer was not being followed, rather than showing
                        a balance nobody checked.
                      </>
                    }
                  >
                    <Chip tone="neutral">not tracked yet</Chip>
                  </Explain>
                </ChipRow>
              </div>
            ) : (
              <>
                {/* The figure at the right end of its own label's line, where
                    every other money figure in this app sits (design D23). */}
                <div className="flex items-baseline justify-between gap-3">
                  {/* Heavier and a shade larger than the section headings
                      below it — 15px at 800, measured on the device rather
                      than picked off the scale. It is the card's headline and
                      the only label sharing a line with a display figure, so
                      the two read as one statement rather than as a caption
                      under a number. */}
                  <p className="text-[0.9375rem] font-extrabold uppercase tracking-wide text-content-muted">
                    In the drawer now
                  </p>
                  <Money paise={state.expectedNowPaise ?? 0} display data-testid="expected-now" />
                </div>

                {/* Directly beneath it: these chips qualify that figure. */}
                <ChipRow data-testid="balance-chips">
                  <Chip icon={Clock} data-testid="last-counted">
                    {state.lastObservation.isLegacyImprecise
                      ? 'Hour was never recorded'
                      : formatDayTime(state.lastObservation.countedAt)}
                  </Chip>
                  {!state.lastObservation.onSite && (
                    <Chip tone="neutral" icon={MapPinOff}>
                      away
                    </Chip>
                  )}
                  {uncountedDays >= 2 && (
                    <>
                      <Explain
                        label="what counting after several days means"
                        explanation={
                          <>
                            The next count covers all of them, so a difference cannot be pinned to
                            one night.
                          </>
                        }
                      >
                        <Chip tone="warn" icon={TriangleAlert} data-testid="days-covered">
                          {uncountedDays} days uncounted
                        </Chip>
                      </Explain>
                    </>
                  )}
                  {tabletTelemetry && tabletTelemetry.kind !== 'clear' && (
                    <>
                      <Explain
                        label="what tablet reporting means for this figure"
                        explanation={
                          <>
                            {tabletTelemetry.kind === 'out-of-touch'
                              ? `The tablet is out of touch${
                                  tabletTelemetry.reportedAt
                                    ? `; it last reported ${formatDateTime(
                                        tabletTelemetry.reportedAt,
                                      )}`
                                    : ' and has never completed a report'
                                }. Its last report said ${tabletTelemetry.unresolvedCount} unresolved billing action${
                                  tabletTelemetry.unresolvedCount === 1 ? '' : 's'
                                }, but its current state is unknown.`
                              : `The tablet reported ${tabletTelemetry.unresolvedCount} unresolved billing action${
                                  tabletTelemetry.unresolvedCount === 1 ? '' : 's'
                                }${
                                  tabletTelemetry.oldestUnresolvedAt
                                    ? `, the oldest held since ${formatDateTime(
                                        tabletTelemetry.oldestUnresolvedAt,
                                      )}`
                                    : ''
                                }.`}{' '}
                            The figure above is provisional and may be understated. Count anyway —
                            you are the one holding the cash.
                          </>
                        }
                      >
                        <Chip tone="warn" icon={TriangleAlert} data-testid="unsynced-chip">
                          {tabletTelemetry.tabletCount} tablet
                          {tabletTelemetry.tabletCount === 1 ? '' : 's'}{' '}
                          {tabletTelemetry.kind === 'out-of-touch' ? 'out of touch' : 'unresolved'}
                        </Chip>
                      </Explain>
                    </>
                  )}
                </ChipRow>

                <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
                  {/* Not an interval, so it opens the count that produced it
                      rather than a day-by-day reading — but it opens, because a
                      figure on this strip that cannot be asked about is the odd
                      one out [owner, 2026-08-30]. */}
                  <Figure
                    label="Last Left"
                    paise={state.leftInDrawerPaise ?? 0}
                    testId="left"
                    onOpen={() => setSheet('left')}
                    openLabel="Last Left, from the count that produced it"
                  />
                  {/* Both through the same rule, so the two cannot disagree
                      about what a sign means. Expenses are negated on the way
                      in, which is the whole of the difference between them. */}
                  <Figure
                    label="Cash from Bills"
                    paise={state.cashReceiptsSincePaise}
                    rows={
                      state.cashReceiptsSinceCount === 1
                        ? '1 bill'
                        : `${state.cashReceiptsSinceCount} bills`
                    }
                    testId="receipts-since"
                    signed
                    onOpen={() => setSheet('receipts')}
                    openLabel="Cash from Bills, day by day"
                  />
                  <Figure
                    label="Cash Expenses"
                    paise={-state.cashExpensesSincePaise}
                    rows={
                      state.cashExpensesSinceCount === 1
                        ? '1 expense'
                        : `${state.cashExpensesSinceCount} expenses`
                    }
                    testId="expenses-since"
                    signed
                    onOpen={() => setSheet('expenses')}
                    openLabel="Cash Expenses, day by day"
                  />
                </div>
              </>
            )}
          </Card>

          {/* ── The action ──────────────────────────────────────────────
              One control, and there is no longer a quieter row beneath it.
              Only Collect and Other Spend are gone (design D5): with no way to
              record a movement outside a count, every movement belongs to one
              and is folded into the following opening — which is what makes the
              three tiles above account for the headline exactly.

              It carries its own vertical margin rather than taking the strip's
              `space-y-3`, because it is the one thing on this screen somebody
              came here to press: the reading above it and the history below it
              are both things to look at, and the act between them earns a band
              of its own. Four rather than five: at five the button drifted away
              from the reading it acts on [owner, 2026-08-30]. */}
          <Button className="my-4 w-full" onClick={openCount} data-testid="open-count">
            <Banknote aria-hidden size={16} /> Count &amp; Collect
          </Button>

          {/* ── Recent counts ───────────────────────────────────────────── */}
          {observations.length > 0 && (
            <section className="space-y-3" data-testid="recent-counts">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Recent counts
              </h2>
              {observations.map((observation) => (
                <ObservationRow
                  key={observation.id}
                  observation={observation}
                  locked={observation.id !== newestId}
                  onAdjust={() => {
                    setAdjustingId(observation.id)
                    setAdjustedAmount('')
                    setAdjustReason('')
                    setSheet('adjust')
                  }}
                  onEdit={() => {
                    setAdjustingId(observation.id)
                    // Prefilled with what is stored, because this sheet corrects
                    // an observation rather than restating one: a blank note
                    // field would be an invitation to clear a note nobody meant
                    // to touch, which is the bug in the shape it replaces.
                    setAdjustedAmount(String(observation.countedTotalPaise / 100))
                    setEditedNote(observation.note ?? '')
                    setEditedAt(new Date(observation.countedAt))
                    setEditOpenedAt(Date.now())
                    setClock(Date.now())
                    setAdjustReason('')
                    setSheet('edit')
                  }}
                />
              ))}

              <div ref={sentinel} />
              {mayHaveMore ? (
                <Button
                  variant="secondary"
                  size="phone"
                  className="w-full"
                  disabled={paging}
                  onClick={() => void loadMore()}
                  data-testid="load-older-counts"
                >
                  {paging ? (
                    <>
                      <LoaderCircle aria-hidden size={14} className="animate-spin" /> Reading…
                    </>
                  ) : (
                    'Show older counts'
                  )}
                </Button>
              ) : (
                <p
                  className="pt-1 text-center text-[0.6875rem] text-content-muted"
                  data-testid="counts-exhausted"
                >
                  That is every count at this outlet.
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {/* ── Count & Collect ─────────────────────────────────────────────── */}
      <FormSheet
        open={sheet === 'count'}
        onClose={closeSheets}
        title="Count & Collect"
        error={error}
        footer={
          <Button
            type="submit"
            form="count-form"
            className="w-full"
            disabled={busy || !countedUsable || timeProblem !== null || reasonMissing}
            data-testid="save-count"
          >
            Save count
          </Button>
        }
      >
        <form id="count-form" onSubmit={submitCount} className="space-y-4">
          <fieldset className="space-y-2">
            {/*
              The label and its answer on one line: `Counted when: Today, 04:07
              pm, give or take 15 min`. It read as a question with the answer
              parked under the buttons, which is two lines to say one thing and
              puts the chosen instant furthest from the label that names it.

              The flex lives on a span inside the legend rather than on the
              legend itself, because `display` on `<legend>` is the one box in
              HTML browsers still disagree about.
            */}
            <legend className="text-sm">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-content">Counted when:</span>
                <span className="font-semibold text-content" data-testid="counted-at-echo">
                  {formatDayTime(countedAt.toISOString())}
                </span>
                {/* Every count carries this window, so it is stated rather than
                    used to mark some counts out from others (design D19). */}
                <Explain
                  label="why every count time is approximate"
                  explanation={
                    <>
                      Counting takes a few minutes and the counter keeps selling while you do it, so
                      no stated time is exact. The window is the same whichever option you pick.
                    </>
                  }
                >
                  <span className="text-content-muted" data-testid="tolerance-window">
                    give or take {APPROXIMATE_WINDOW_MINUTES} min
                  </span>
                </Explain>
              </span>
            </legend>
            <CountedAtButtons value={countedAt} onChange={setCountedAt} anchorMs={sheetOpenedAt} />
            {boundary && boundary.excludedBills > 0 && (
              <ChipRow>
                <Chip tone="neutral" data-testid="excluded-by-time">
                  leaves out <Money paise={boundary.excludedPaise} /> · {boundary.excludedBills}
                </Chip>
              </ChipRow>
            )}
            {timeProblem && (
              <p
                role="alert"
                className="text-sm font-semibold text-danger"
                data-testid="time-problem"
              >
                {timeProblem}
              </p>
            )}
          </fieldset>

          {/*
            The four figures as a tally, which is the shape the arithmetic
            already has: what should be there, what was there, what is being
            taken, what stays. Two labelled boxes made the reader hold the sum in
            their head while typing into the middle of it.

            The two editable rows carry NO placeholder. A greyed `8950` in an
            empty money field is read as a value at a glance, and an empty
            collection field already means nought without saying so.
          */}
          <fieldset className="space-y-2">
            <legend className="sr-only">The count</legend>

            {expectedPaise !== null && (
              <TallyRow
                label="Cash expected"
                value={<Money paise={expectedPaise} data-testid="expected-at-instant" />}
              />
            )}

            <TallyRow
              label="Cash counted"
              input={
                <TallyInput
                  value={counted}
                  onChange={setCounted}
                  ariaLabel="Cash counted, in rupees"
                  testId="counted-input"
                />
              }
            />

            {advice && (
              // On the keystroke, before anything is saved. Never behind a tap.
              //
              // Right-aligned, because it belongs to the field above it rather
              // than to the sheet: against the left margin it read as a new
              // paragraph interrupting the tally, and the eye lost the column of
              // figures it was following.
              <div className="space-y-1 text-right" data-testid="count-difference">
                {advice.direction === 'balanced' ? (
                  <ChipRow className="justify-end">
                    <Chip tone="good" icon={Check}>
                      matches <Money paise={advice.expectedPaise} />
                    </Chip>
                  </ChipRow>
                ) : (
                  <ChipRow className="justify-end">
                    <Explain
                      label="what short and over mean here"
                      explanation={
                        <>
                          {advice.direction === 'short'
                            ? 'This much is missing from the drawer against what was expected.'
                            : 'This much more than expected was counted.'}
                        </>
                      }
                    >
                      <Chip
                        tone="bad"
                        icon={advice.direction === 'short' ? ArrowDownRight : ArrowUpRight}
                        // Its own handle, because the block around it also contains
                        // the `Why` button's screen-reader label — "what short and
                        // over mean here" — which carries both words and makes any
                        // direction test over the whole block read `short` always.
                        data-testid="count-direction"
                      >
                        <Money paise={Math.abs(advice.differencePaise)} />{' '}
                        {advice.direction === 'short' ? 'short' : 'over'}
                      </Chip>
                    </Explain>
                  </ChipRow>
                )}

                {advice.coincidence && (
                  // An exact hit is unlikely to be chance, so saying so is an
                  // observation rather than an excuse.
                  <p className="text-xs text-content" data-testid="exact-coincidence">
                    Exactly the {advice.coincidence.bills.length} cash{' '}
                    {advice.coincidence.bills.length === 1 ? 'bill' : 'bills'} between{' '}
                    {formatTime(advice.coincidence.bills[0]?.paidAt.toISOString() ?? '')} and{' '}
                    {formatTime(advice.coincidence.bills.at(-1)?.paidAt.toISOString() ?? '')}.
                  </p>
                )}

                {!advice.coincidence && advice.direction !== 'balanced' && (
                  <ChipRow className="justify-end" data-testid="no-coincidence">
                    <Chip tone="neutral">no run of bills matches</Chip>
                    {advice.timingCouldExplainPaise !== null &&
                      advice.timingCouldExplainPaise > 0 && (
                        <>
                          <Explain
                            label="what nearby cash means for this difference"
                            explanation={
                              <>
                                Your time is approximate, so the timing could account for part of
                                the difference. Nothing here proposes a time — move the count time
                                only if you recognise the bills.
                              </>
                            }
                          >
                            <Chip tone="neutral">
                              <Money paise={advice.timingCouldExplainPaise} /> moved nearby
                            </Chip>
                          </Explain>
                        </>
                      )}
                  </ChipRow>
                )}
              </div>
            )}

            <TallyRow
              label="Cash collected"
              input={
                <TallyInput
                  value={collecting}
                  onChange={setCollecting}
                  ariaLabel="Cash collected, in rupees"
                  testId="collecting-input"
                />
              }
            />

            {collectingIsAdding && (
              // **On the keystroke, not at submission, and never behind a tap.**
              // This alert is the whole protection against a mistyped minus.
              <p
                role="alert"
                className="rounded-lg bg-warning px-2 py-1 text-sm font-bold text-on-warning"
                data-testid="negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}

            {/* The line the tally exists to produce, and the only one that
                moves with both fields above it. */}
            <TallyRow
              label="Cash left"
              emphasis
              value={
                leavingPaise === null ? (
                  <span className="text-content-muted">not counted yet</span>
                ) : (
                  <Money paise={leavingPaise} data-testid="leaving-preview" />
                )
              }
            />
          </fieldset>

          <WhereaboutsPanel
            where={where}
            outletName={outlet?.name ?? null}
            reason={awayReason}
            onReason={setAwayReason}
          />
        </form>
      </FormSheet>

      {/* ── The two readings behind the figures ────────────────────────
          Rendered whenever there is a state to read, so opening one is a state
          change and nothing else. `breakdownContext` returns null before the
          anchor and before the outlet's own cutover has been read — neither
          tile is a control in that case either. */}
      <LastLeftBreakdown
        open={sheet === 'left'}
        onClose={() => closeIfCurrent('left')}
        observation={state?.lastObservation ?? null}
        // The same edit, from a second doorway. It swaps sheets rather than
        // stacking them: two bottom sheets over each other on a phone is one
        // sheet nobody can read, and the edit sheet is where the fields live.
        onFix={() => {
          const newest = state?.lastObservation
          if (!newest) return
          setAdjustingId(newest.id)
          setAdjustedAmount(String(newest.countedTotalPaise / 100))
          setEditedNote(newest.note ?? '')
          setEditedAt(new Date(newest.countedAt))
          setEditOpenedAt(Date.now())
          setClock(Date.now())
          setAdjustReason('')
          setSheet('edit')
        }}
      />
      <ReceiptsBreakdown open={sheet === 'receipts'} onClose={closeSheets} context={breakdown} />
      <ExpensesBreakdown
        open={sheet === 'expenses'}
        onClose={closeSheets}
        context={breakdown}
        outletId={outletId ?? ''}
        viewerId={session.userId}
        onChanged={load}
      />

      {/* ── Fix the newest count, which nothing has anchored on ────────── */}
      <FormSheet
        open={sheet === 'edit'}
        onClose={closeSheets}
        title="Fix this count"
        error={error}
        footer={
          <Button
            type="submit"
            form="edit-form"
            className="w-full"
            disabled={busy || adjustedAmount.trim() === '' || editTimeProblem !== null}
            data-testid="save-edit"
          >
            Save the figure
          </Button>
        }
      >
        <form id="edit-form" onSubmit={submitEdit} className="space-y-4">
          {adjusting && (
            <>
              <TallyRow
                label={`Recorded as ${formatDayTime(adjusting.countedAt)}`}
                value={<Money paise={adjusting.countedTotalPaise} />}
              />

              <div className="space-y-1">
                <label htmlFor="edited-amount" className="text-sm font-bold text-content">
                  What was actually counted?
                </label>
                <Input
                  id="edited-amount"
                  inputMode="decimal"
                  value={adjustedAmount}
                  onChange={(event) => setAdjustedAmount(event.target.value)}
                  data-testid="edited-amount"
                />
              </div>

              {/*
                **The instant, which is the whole reason this sheet exists.** The
                count sheet's own thesis is that a count at 22:00 is measured
                against cash received up to 22:00 — so a count recorded at 23:30
                and offering only the amount left the recorder one affordance:
                falsify the physical count until it balances. That is the precise
                inversion of what this surface is for.
              */}
              <fieldset className="space-y-2">
                <legend className="text-sm">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold text-content">Counted when:</span>
                    <span className="font-semibold text-content" data-testid="edited-at-echo">
                      {formatDayTime(editedAt.toISOString())}
                    </span>
                  </span>
                </legend>
                <CountedAtButtons value={editedAt} onChange={setEditedAt} anchorMs={editOpenedAt} />
                {editMoved && editMoved.direction !== 'none' && (
                  <p className="text-sm text-content" data-testid="edit-boundary-moved">
                    <Money paise={editMoved.paise} /> of cash rung{' '}
                    {editMoved.direction === 'out' ? 'after' : 'up to'}{' '}
                    {formatTime(editedAt.toISOString())} is{' '}
                    {editMoved.direction === 'out' ? 'no longer' : 'now'} inside this count.
                  </p>
                )}
                {editTimeProblem && (
                  <p
                    role="alert"
                    className="text-sm font-semibold text-danger"
                    data-testid="edit-time-problem"
                  >
                    {editTimeProblem}
                  </p>
                )}
              </fieldset>

              {/*
                **The note is a field because it was silently a casualty.** The
                sheet sent no note and the command assigned one unconditionally,
                so typing a note and then fixing a typo in the figure lost the
                note with no warning at all.
              */}
              <div className="space-y-1">
                <label htmlFor="edited-note" className="text-sm font-bold text-content">
                  Note (optional)
                </label>
                <Input
                  id="edited-note"
                  value={editedNote}
                  onChange={(event) => setEditedNote(event.target.value)}
                  placeholder="counted with the evening float still in"
                  data-testid="edited-note"
                />
              </div>

              <ChipRow>
                <Explain
                  label="why this one takes no reason"
                  explanation={
                    <>
                      Nothing has been counted since, so no later figure was worked out from this
                      one and nobody has read it as settled. Correcting it now simply replaces it.
                      Once a later count opens at this figure the offer changes to an adjustment,
                      which does ask why and does stay on the record.
                    </>
                  }
                >
                  <Chip tone="good" icon={Check} data-testid="edit-leaves-no-trail">
                    no reason needed
                  </Chip>
                </Explain>
              </ChipRow>
            </>
          )}
        </form>
      </FormSheet>

      {/* ── Adjust a locked count ──────────────────────────────────────── */}
      <FormSheet
        open={sheet === 'adjust'}
        onClose={closeSheets}
        title="Adjust a count"
        error={error}
        footer={
          <Button
            type="submit"
            form="adjust-form"
            className="w-full"
            disabled={busy || adjustReason.trim() === ''}
            data-testid="save-adjustment"
          >
            Post adjustment
          </Button>
        }
      >
        <form id="adjust-form" onSubmit={submitAdjustment} className="space-y-4">
          {adjusting && (
            <>
              <div className="space-y-2">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-content-muted">
                    {formatDayTime(adjusting.countedAt)}
                  </span>
                  <Money paise={adjusting.countedTotalPaise} className="font-semibold" />
                </p>
                <ChipRow>
                  <Explain
                    label="why this count is locked"
                    explanation={
                      <>
                        A later count read this figure as its own opening, which is the moment it
                        became load-bearing. Both figures stay on the record, and the later count
                        re-anchors the balance on what was physically there — so nothing after it
                        moves.
                      </>
                    }
                  >
                    <Chip tone="neutral" icon={Lock}>
                      locked
                    </Chip>
                  </Explain>
                </ChipRow>
              </div>

              <div className="space-y-1">
                <label htmlFor="adjusted-amount" className="text-sm font-bold text-content">
                  What should it have been?
                </label>
                <Input
                  id="adjusted-amount"
                  inputMode="decimal"
                  value={adjustedAmount}
                  onChange={(event) => setAdjustedAmount(event.target.value)}
                  data-testid="adjusted-amount"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="adjust-reason" className="text-sm font-bold text-content">
                  Why? (required)
                </label>
                <Input
                  id="adjust-reason"
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  placeholder="miscounted, found a 500 note"
                  data-testid="adjust-reason"
                />
              </div>
            </>
          )}
        </form>
      </FormSheet>
    </div>
  )
}

/**
 * Where the recorder is standing, and the one question that follows from it.
 *
 * **The reason field exists exactly when it is evidence** (design D20). Inside
 * the fence there is nothing to explain, so there is no field — not a disabled
 * one, not an optional one. Outside it, or with no fix at all, it is required,
 * and the sheet refuses the save rather than letting Postgres do it with a
 * constraint message.
 *
 * Nothing here refuses a recording for being elsewhere, which is decision 11
 * unchanged. It only makes the record say where the person was.
 */
function WhereaboutsPanel({
  where,
  outletName,
  reason,
  onReason,
}: {
  where: Whereabouts | null
  outletName: string | null
  reason: string
  onReason: (value: string) => void
}) {
  if (where === null) return null

  if (where.kind === 'locating') {
    return (
      <ChipRow data-testid="whereabouts-locating">
        <Chip tone="neutral" icon={LoaderCircle}>
          checking where you are
        </Chip>
      </ChipRow>
    )
  }

  if (where.kind === 'on-site') {
    return (
      <ChipRow data-testid="whereabouts-on-site">
        <Chip tone="good" icon={MapPin}>
          at {outletName ?? 'the outlet'}
        </Chip>
      </ChipRow>
    )
  }

  const said: ReactNode =
    where.kind === 'away' ? (
      <>
        {formatMetres(where.distanceMetres)} from {outletName ?? 'the outlet'}
      </>
    ) : where.kind === 'unsurveyed' ? (
      <>this outlet has no position captured, so nothing can be measured</>
    ) : (
      FAILURE_COPY[where.failure]
    )

  return (
    <div className="space-y-2" data-testid="whereabouts-away" data-kind={where.kind}>
      <ChipRow>
        <Chip tone="warn" icon={MapPinOff}>
          not at the outlet
        </Chip>
      </ChipRow>
      <p className="text-xs text-content-muted">{said}</p>
      <div className="space-y-1">
        <label htmlFor="away-reason" className="text-sm font-bold text-content">
          Why are you recording this from elsewhere?
        </label>
        <Input
          id="away-reason"
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          placeholder="counted at the counter, typed at home"
          data-testid="away-reason"
        />
        <p className="text-xs text-content-muted">
          Nothing is refused for being elsewhere. The record just says where you were.
        </p>
      </div>
    </div>
  )
}

/**
 * The movable boundary: three relative options and the platform's own picker.
 *
 * **One control, two sheets.** The count sheet moves the boundary of an interval
 * that has not closed; the edit sheet moves the boundary of one that has. They
 * are the same act — a person stating when the drawer was actually counted — and
 * a second implementation would be a second set of rules about what a stated
 * instant may be.
 *
 * `anchorMs` is what the relative options are measured from, and it must stay
 * frozen for as long as the sheet is open: an anchor that advanced would move a
 * time the recorder had already chosen out from under them.
 */
function CountedAtButtons({
  value,
  onChange,
  anchorMs,
}: {
  value: Date
  onChange: (next: Date) => void
  anchorMs: number
}) {
  const picker = useRef<HTMLInputElement | null>(null)

  /** Which of the three relative options this instant currently is, or null. */
  const relative = RELATIVE_TIMES.find(
    (option) => Math.abs(value.getTime() - (anchorMs - option.minutes * 60_000)) < 30_000,
  )

  function openPicker() {
    const field = picker.current
    if (!field) return
    // `showPicker()` is the supported way to open a date control from another
    // element. Where it is missing, focusing and clicking the field is what
    // older browsers open it on, and the field is still bound either way.
    if (typeof field.showPicker === 'function') {
      try {
        field.showPicker()
        return
      } catch {
        // A browser that refuses is one that falls through to the same fallback.
      }
    }
    field.focus()
    field.click()
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {RELATIVE_TIMES.map((option) => {
        const candidate = new Date(anchorMs - option.minutes * 60_000)
        return (
          <Button
            key={option.label}
            type="button"
            size="phone"
            className="px-0"
            aria-label={option.spoken}
            variant={relative?.minutes === option.minutes ? 'primary' : 'secondary'}
            onClick={() => onChange(candidate)}
            data-testid={`when-${option.minutes}`}
          >
            {option.label}
          </Button>
        )
      })}
      {/*
        The fourth option, in the space beside the other three, for a count being
        caught up on days later — which has no relative name.

        **It opens the platform's own picker and takes no typing.** The input is
        present and bound, because that is what `showPicker()` acts on and what
        carries the value, but it is not somewhere a person puts a caret: a
        half-typed date is a date, and this field decides which cash a count is
        measured against.
      */}
      <div className="relative">
        <Button
          type="button"
          size="phone"
          className="w-full px-0"
          aria-label="Pick another date and time"
          variant={relative === undefined ? 'primary' : 'secondary'}
          onClick={openPicker}
          data-testid="when-other"
        >
          Other
        </Button>
        <input
          ref={picker}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(event) => {
            const picked = new Date(event.target.value)
            if (!Number.isNaN(picked.getTime())) onChange(picked)
          }}
          // Reachable through the button above, which is the labelled control; a
          // second tab stop for the same value is one control too many, and the
          // picker itself is keyboard-navigable.
          tabIndex={-1}
          aria-hidden
          // Rendered rather than `display:none`, so the picker has somewhere to
          // anchor, and inert to the pointer so a stray tap lands on the button.
          className="pointer-events-none absolute inset-0 size-full opacity-0"
          data-testid="counted-at-picker"
        />
      </div>
    </div>
  )
}

/**
 * One line of the count tally: a label on the left, a figure or a field on the
 * right, aligned down one column so the four read as arithmetic.
 */
function TallyRow({
  label,
  value,
  input,
  emphasis = false,
}: {
  label: string
  value?: ReactNode
  input?: ReactNode
  /** The line the others add up to. */
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('text-base text-content-muted', emphasis && 'font-bold text-content')}>
        {label}
      </span>
      {input ?? (
        // `pr-3` so a stated figure lands on the same right edge as a typed one,
        // which sits inside its field's own padding. Without it the column is a
        // few pixels out and the tally stops reading as a column.
        <span
          className={cn(
            'shrink-0 whitespace-nowrap pr-3 text-base text-content',
            emphasis && 'font-bold',
          )}
        >
          {value}
        </span>
      )}
    </div>
  )
}

/**
 * The editable half of a tally line.
 *
 * Right-aligned and fixed-width so it sits in the same column as the figures it
 * is being added to, and **carries no placeholder**: a greyed number in an empty
 * money field reads as a value at a glance, which is the one mistake this
 * surface cannot afford.
 */
function TallyInput({
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  value: string
  onChange: (next: string) => void
  ariaLabel: string
  testId: string
}) {
  return (
    // The rupee sits INSIDE the field, pinned left, while the number stays
    // right-aligned. Outside it, the mark would sit between the label and the
    // box and read as part of the label; hugging the number would need the
    // caret's own text metrics and would drift as digits are typed.
    //
    // Left mark, right number is what a bank's amount field does, and it is
    // what keeps this column a column: the typed figures land on the same right
    // edge as the stated ones above and below them.
    <span className="relative inline-block w-44 shrink-0">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-content-muted"
      >
        ₹
      </span>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // The mark is decorative, so the field still says what it wants in
        // words: a reader who cannot see it is told "in rupees" either way.
        aria-label={ariaLabel}
        data-testid={testId}
        className="h-[var(--size-control-phone)] w-full pl-7 text-right text-base"
      />
    </span>
  )
}

/**
 * How a signed figure reads: the sign it needs, and the tone that agrees.
 *
 * **One rule, applied to every term in the running balance.** Nought is not a
 * direction, so it carries neither a sign nor a colour; a positive adds to the
 * drawer, a negative takes from it, and the tone follows the sign rather than
 * the label. Cash expenses go through this function negated, so the ordinary
 * case is red with a minus — and a *negative* expense, which is a refund,
 * comes out green with a plus without needing a rule of its own.
 */
function signOf(paise: number): { prefix: string; tone: string | undefined } {
  if (paise === 0) return { prefix: '', tone: undefined }
  if (paise > 0) return { prefix: '+', tone: 'text-success' }
  // `formatPaise` already renders the minus, so the prefix stays empty.
  return { prefix: '', tone: 'text-danger' }
}

/**
 * One figure in the three-up strip.
 *
 * **The sign is shown, not implied** (design D23). The direction of a term in a
 * running balance is the whole content of that term, and a green tint is not
 * available to every reader.
 */
function Figure({
  label,
  paise,
  rows,
  testId,
  signed = false,
  onOpen,
  openLabel,
}: {
  label: string
  paise: number
  rows?: string
  testId: string
  /** Read this figure as a movement, so its sign and tone follow its value. */
  signed?: boolean
  /** Where given, the whole tile opens the reading behind this figure. */
  onOpen?: () => void
  /** What that reading is, for a reader who gets no layout. */
  openLabel?: string
}) {
  const { prefix, tone } = signed ? signOf(paise) : { prefix: '', tone: undefined }

  const body = (
    <>
      <p className="text-[0.6875rem] uppercase tracking-wide text-content-muted">{label}</p>
      <p data-testid={testId} className={tone}>
        {prefix}
        <Money paise={paise} />
      </p>
      {rows !== undefined && <p className="text-[0.6875rem] text-content-muted">{rows}</p>}
    </>
  )

  if (!onOpen) return <div>{body}</div>

  return (
    <button
      type="button"
      onClick={onOpen}
      // The figure and its label are the visible name; this says what a tap
      // does, after the fact rather than instead of it.
      aria-label={openLabel}
      data-testid={`open-${testId}`}
      // **The whole tile is the target, and it says so by pressing** — no
      // underline under the figure [owner, 2026-08-30]. A dotted rule under a
      // money amount reads as a mark on the number rather than as an offer, and
      // three of them in a row read as clutter. So the tile lifts on hover and
      // sinks on press, which is the one affordance that works the same under a
      // thumb as under a cursor: a phone has no hover, and `:active` fires on
      // the tap itself.
      //
      // Negative margin and matching padding, so the pressed surface is bigger
      // than the text without moving the three-up grid a pixel.
      className={cn(
        // **`flex flex-col`, because a button centres its own content and these
        // do not all hold the same number of lines.** The strip is a stretch
        // grid, so a tile with no row count under it is a shorter box in a cell
        // as tall as its neighbours — and the browser's button box centres that
        // short content, dropping its figure seven pixels below theirs. A column
        // of money that is not a column is the one thing this strip cannot be
        // [owner, 2026-08-30]. `display: block` does not fix it: the centring
        // comes from the anonymous button-content box, which only a flex or grid
        // display on the button itself replaces.
        'flex flex-col -m-1 rounded-lg p-1 text-center transition-[background-color,box-shadow,transform]',
        'hover:bg-surface-raised',
        // `brightness-95` is the same press this app's primary button already
        // uses; over `surface-raised` it lands darker than the card the tile
        // sits on, which is what reads as sunken rather than merely tinted.
        'active:translate-y-px active:bg-surface-raised active:shadow-inner active:brightness-95',
        'focus-visible:focus-ring',
      )}
    >
      {body}
    </button>
  )
}

/**
 * One recent count, as a Billing-style disclosure.
 *
 * Built the way `sync-event-row.tsx` builds one, because that is this app's
 * pattern for exactly this shape and a second implementation is a second thing
 * to keep in step: a full-width header button carrying `aria-expanded`, a
 * chevron that rotates, and a body that is **unmounted** while closed rather
 * than hidden — so find-in-page cannot lead a reader to text that is not there.
 *
 * **Closed, it carries what somebody is scanning for**: what was counted, what
 * was collected, what was left and the verdict, including `matched`, because a
 * clean night reading blank is indistinguishable from a row that has not
 * loaded. The opening break rides along, being the one condition that wants a
 * second look.
 *
 * Everything else — why they were away, the adjustments and the control to
 * adjust — is inside. Facts already visible in the closed summary are not
 * repeated in the detail.
 */
function ObservationRow({
  observation,
  locked,
  onAdjust,
  onEdit,
}: {
  observation: DrawerObservationRecord
  locked: boolean
  onAdjust: () => void
  onEdit: () => void
}) {
  const [open, setOpen] = useState(false)
  const collected = observation.ownCashOut.reduce((sum, movement) => sum + movement.amountPaise, 0)
  const left = nextOpeningPaise(observation.countedTotalPaise, collected)
  const verdict = verdictOf(observation)
  const movementNotes = observation.ownCashOut.flatMap((movement) =>
    movement.reason ? [movement.reason] : [],
  )
  const wasRecordedLater =
    !observation.isLegacyImprecise &&
    formatDayTime(observation.recordedAt) !== formatDayTime(observation.countedAt)

  return (
    <Card className="overflow-hidden p-0" data-testid={`observation-${observation.id}`}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        // Named explicitly: read from its own content this announces the three
        // amounts and the verdict as one summary, just as the visible row does.
        aria-label={`Counted ${formatPaise(observation.countedTotalPaise)} ${
          observation.isLegacyImprecise
            ? 'on a day whose hour was never recorded'
            : `at ${formatDayTime(observation.countedAt)}`
        }, ${verdict.spoken}. Collected ${formatPaise(collected)}. Left ${formatPaise(
          left,
        )}. ${open ? 'Hide' : 'Show'} the detail.`}
        className="grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left focus-visible:focus-ring"
      >
        {/*
          The Billing-history hierarchy: the counted figure and verdict lead on
          the left, while the two amounts that explain where that cash went sit
          together at the right with the disclosure chevron.

          It WRAPS rather than truncating, and the direction of the give is
          deliberate. The right-hand figures are `shrink-0`, so a long summary
          pushes the counted line instead of clipping money.
        */}
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-black text-content">
              Counted:{' '}
              <Money
                paise={observation.countedTotalPaise}
                data-testid={`observation-counted-${observation.id}`}
              />
            </span>
            {verdict.chip}
            {observation.openingBreakPaise !== null && (
              <Chip tone="warn" icon={TriangleAlert} data-testid={`break-${observation.id}`}>
                break <Money paise={observation.openingBreakPaise} />
              </Chip>
            )}
          </span>
          <span className="mt-1 block text-sm font-normal text-content-muted">
            {observation.isLegacyImprecise
              ? 'Hour was never recorded'
              : formatDayTime(observation.countedAt)}
            {observation.recordedByName && ` · by ${observation.recordedByName}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="grid grid-cols-2 gap-x-2 text-right leading-tight">
            <span>
              <span className="block text-[0.6875rem] text-content-muted">Collected</span>
              <Money
                paise={collected}
                className="text-base font-black text-content"
                data-testid={`observation-collected-${observation.id}`}
              />
            </span>
            <span>
              <span className="block text-[0.6875rem] text-content-muted">Left</span>
              <Money
                paise={left}
                className="text-base font-black text-content"
                data-testid={`observation-left-${observation.id}`}
              />
            </span>
          </span>
          <ChevronDown
            aria-hidden
            size={18}
            className={cn('shrink-0 text-content-muted transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {open && (
        <div
          className="space-y-3 border-t border-border px-3 pb-3 pt-3"
          data-testid={`observation-detail-${observation.id}`}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {observation.expectedPaise !== null && (
              <div>
                <dt className="text-xs text-content-muted">Expected at count</dt>
                <dd className="mt-0.5 font-bold text-content">
                  <Money paise={observation.expectedPaise} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-content-muted">Recorded from</dt>
              <dd className="mt-0.5 flex items-center gap-1 font-semibold text-content">
                {observation.onSite ? (
                  <MapPin aria-hidden size={14} />
                ) : (
                  <MapPinOff aria-hidden size={14} />
                )}
                {observation.onSite ? 'At the outlet' : 'Away from the outlet'}
              </dd>
            </div>
            {wasRecordedLater && (
              <div>
                <dt className="text-xs text-content-muted">Saved</dt>
                <dd className="mt-0.5 font-semibold text-content">
                  {formatDayTime(observation.recordedAt)}
                </dd>
              </div>
            )}
            {observation.awayReason && (
              <div className="col-span-2 border-t border-border pt-3">
                <dt className="text-xs text-content-muted">Why away</dt>
                <dd className="mt-0.5 text-content">{observation.awayReason}</dd>
              </div>
            )}
            {observation.note && (
              <div className="col-span-2 border-t border-border pt-3">
                <dt className="text-xs text-content-muted">Note</dt>
                <dd className="mt-0.5 text-content">{observation.note}</dd>
              </div>
            )}
            {observation.adjustments.length === 0 && observation.correctedByName && (
              <div>
                <dt className="text-xs text-content-muted">Last fixed by</dt>
                <dd className="mt-0.5 font-semibold text-content">{observation.correctedByName}</dd>
              </div>
            )}
            {movementNotes.length > 0 && (
              <div className="col-span-2 border-t border-border pt-3">
                <dt className="text-xs text-content-muted">Cash movement note</dt>
                <dd className="mt-0.5 space-y-1 text-content">
                  {movementNotes.map((note, index) => (
                    <p key={`${note}-${index}`}>{note}</p>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {(observation.isAnchor || observation.openingBreakPaise !== null) && (
            <div className="border-t border-border pt-3">
              <ChipRow>
                {/*
                  These explain triggers sit in the body because the row header
                  is already a disclosure button and cannot contain another
                  interactive control.
                */}
                {observation.isAnchor && (
                  <Explain
                    label="what a first count means"
                    className="text-[0.6875rem] text-content-muted"
                    explanation={
                      <>
                        The drawer began here — there is nothing before it to compare against, so
                        this count records no difference at all.
                      </>
                    }
                  >
                    why no difference?
                  </Explain>
                )}
                {observation.openingBreakPaise !== null && (
                  <Explain
                    label="why the break is not repaired"
                    className="text-[0.6875rem] text-content-muted"
                    explanation={
                      <>
                        This count opened at a figure the previous one does not carry to. It is
                        reported and not repaired: a figure somebody&rsquo;s count produced is
                        evidence, and a recomputed one is not.
                      </>
                    }
                  >
                    why is the break left alone?
                  </Explain>
                )}
              </ChipRow>
            </div>
          )}

          {observation.adjustments.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-xs text-content-muted">Correction history</p>
              <div className="mt-1 space-y-1 text-sm text-content">
                {observation.adjustments.map((adjustment) => (
                  <div key={adjustment.id} data-testid={`observation-adjustment-${adjustment.id}`}>
                    <p>
                      Adjusted to <Money paise={adjustment.correctedCountedTotalPaise} />
                    </p>
                    <p className="text-xs text-content-muted">
                      {adjustment.reason}
                      {adjustment.adjustedByName && ` · by ${adjustment.adjustedByName}`}
                      {` · ${formatDayTime(adjustment.adjustedAt)}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3">
            {observation.isLegacyImprecise ? (
              <p className="text-xs text-content-muted">
                Carried historical count — its recorded figures remain visible and are not restated
                with an invented hour.
              </p>
            ) : locked ? (
              <Button
                size="phone"
                variant="secondary"
                onClick={onAdjust}
                data-testid={`adjust-${observation.id}`}
              >
                <Lock aria-hidden size={14} /> Adjust this count
              </Button>
            ) : (
              // Nothing has anchored on this one yet, so correcting it is an edit
              // rather than an adjustment: no reason, no trail, no correction on
              // the record for a figure nobody has read.
              <Button
                size="phone"
                variant="secondary"
                onClick={onEdit}
                data-testid={`edit-${observation.id}`}
              >
                <Pencil aria-hidden size={14} /> Fix this count
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
