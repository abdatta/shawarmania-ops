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
  Minus,
  Pencil,
  Plus,
  Receipt,
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
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Why } from '@/components/ui/why'
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
  rupeesToPaise,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'
import { readPosition, type GeolocationFailureKind, type PositionReading } from '@/lib/geolocation'

import { countAdvice, expectedAtInstant } from './drawer-arithmetic'

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
 */

type Sheet = 'none' | 'count' | 'collect' | 'spend' | 'adjust' | 'edit'

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
  // Short enough that all four options share one row on a 375px phone. The
  // instant they produce is spelled out in full directly beneath them, so the
  // button carries the gesture and the line below carries the meaning; the
  // spoken label keeps the whole phrase for a reader who gets no line.
  { label: 'Now', spoken: 'Counted just now', minutes: 0 },
  { label: '15 min', spoken: 'Counted 15 minutes ago', minutes: 15 },
  { label: '30 min', spoken: 'Counted 30 minutes ago', minutes: 30 },
] as const

/** `datetime-local` speaks local wall-clock with no zone. Both directions here. */
function toLocalInput(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

export function CashDrawerSurface() {
  const { cashDrawer: adapter, counter, outlets: outletsAdapter } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()

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
  const [unsynced, setUnsynced] = useState<{ count: number; since: string | null }>({
    count: 0,
    since: null,
  })

  // The count sheet.
  const [counted, setCounted] = useState('')
  // Empty, not '0'. A pre-filled nought is a figure somebody has to clear
  // before typing, and leaving it alone already means nothing was collected.
  const [collecting, setCollecting] = useState('')
  const [countedAt, setCountedAt] = useState<Date>(() => new Date())
  const timePicker = useRef<HTMLInputElement | null>(null)
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

  // The standalone sheets.
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReason, setMovementReason] = useState('')

  // The adjustment sheet.
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [adjustedAmount, setAdjustedAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

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

  useEffect(() => {
    if (!outletId) return
    let active = true
    void counter
      .listDevices()
      .then((devices) => {
        if (!active) return
        const behind = devices.filter(
          (device) => device.outletId === outletId && device.lastReportedUnsent > 0,
        )
        setUnsynced({
          count: behind.length,
          // The OLDEST heartbeat: "since when" is the worst case rather than the
          // most recent, because that is what says how much cash could be
          // missing from the expected figure.
          since:
            behind
              .map((device) => device.lastSeenAt)
              .filter((seen): seen is string => seen !== null)
              .sort((a, b) => a.localeCompare(b))[0] ?? null,
        })
      })
      // Not something the collector can act on, and it must never stop a count.
      .catch(() => {})
    return () => {
      active = false
    }
  }, [counter, outletId])

  // Only while the count sheet is open: nowhere else on this surface asks what
  // time it is, and a timer running behind a closed sheet is a wakeup for nothing.
  useEffect(() => {
    if (sheet !== 'count') return
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
   * Which of the three relative options the stated instant currently is, or null
   * for a time picked out of the air. Drives which button reads as chosen.
   */
  const relativeChoice = useMemo(() => {
    const match = RELATIVE_TIMES.find(
      (option) =>
        Math.abs(countedAt.getTime() - (sheetOpenedAt - option.minutes * 60_000)) < 30_000,
    )
    return match?.minutes ?? null
  }, [countedAt, sheetOpenedAt])

  /** What the drawer should hold at the stated instant. Null before the anchor. */
  const expectedPaise = boundary && state?.lastObservation ? boundary.expectedPaise : null

  function openTimePicker() {
    const field = timePicker.current
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

  const collectingRupees = Number(collecting.trim())
  const collectingUsable = collecting.trim() !== '' && Number.isFinite(collectingRupees)
  const collectingPaise = collectingUsable ? rupeesToPaise(collectingRupees) : 0
  // **A negative is cash going IN.** Same field, same record, no second control —
  // and the meaning is stated on the keystroke that creates it.
  const collectingIsAdding = collectingUsable && collectingPaise < 0
  const leavingPaise = countedUsable ? rupeesToPaise(countedRupees) - collectingPaise : null

  const movementRupees = Number(movementAmount.trim())
  const movementUsable = movementAmount.trim() !== '' && Number.isFinite(movementRupees)
  const movementPaise = movementUsable ? rupeesToPaise(movementRupees) : 0
  const movementIsAdding = movementUsable && movementPaise < 0

  const reasonMissing = needsReason(where) && awayReason.trim() === ''

  function closeSheets() {
    setSheet('none')
    setCounted('')
    setCollecting('')
    setAwayReason('')
    setMovementAmount('')
    setMovementReason('')
    setAdjustingId(null)
    setAdjustedAmount('')
    setAdjustReason('')
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
    void locate()
  }

  function openMovement(kind: 'collect' | 'spend') {
    setMovementAmount('')
    setMovementReason('')
    setAwayReason('')
    setSheet(kind)
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

  async function submitMovement(event: FormEvent, kind: 'collection' | 'spend') {
    event.preventDefault()
    if (!outletId || !movementUsable || reasonMissing) return
    const ok = await run(async () => {
      await adapter.recordCashOut({
        outletId,
        amountPaise: movementPaise,
        kind,
        reason: movementReason.trim() || null,
        position: readingOf(where),
        // No constant standing in for a recorder's reason. A sentence true of
        // every row is evidence about none of them (design D20).
        awayReason: needsReason(where) ? awayReason.trim() : null,
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
    if (!adjustingId) return
    const rupees = Number(adjustedAmount.trim())
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError('Enter what the count should have been, in rupees.')
      return
    }
    const ok = await run(async () => {
      await adapter.editObservation(adjustingId, rupeesToPaise(rupees))
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
        <LoadingFigures label="the drawer" rows={[4, 4]} data-testid="drawer-loading" />
      ) : (
        <div className="space-y-3">
          {state.exceptions.length > 0 && (
            <Card className="space-y-2" data-testid="drawer-exception">
              <ChipRow>
                <Chip tone="warn" icon={TriangleAlert}>
                  Needs a look
                </Chip>
                <Why label="why a late arrival is not folded in">
                  A count is what somebody saw. Work landing afterwards is reported here rather than
                  folded in, because rewriting a recorded figure is the failure this whole chain
                  exists to prevent.
                </Why>
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
                  <Chip tone="neutral">not tracked yet</Chip>
                  <Why label="what not tracked yet means">
                    Count it once and the record begins there. Earlier days keep their revenue and
                    expenses and say the drawer was not being followed, rather than showing a
                    balance nobody checked.
                  </Why>
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
                    {formatDayTime(state.lastObservation.countedAt)}
                  </Chip>
                  {!state.lastObservation.onSite && (
                    <Chip tone="neutral" icon={MapPinOff}>
                      away
                    </Chip>
                  )}
                  {state.daysCovered > 1 && (
                    <>
                      <Chip tone="warn" icon={TriangleAlert} data-testid="days-covered">
                        {state.daysCovered} days uncounted
                      </Chip>
                      <Why label="what counting after several days means">
                        The next count covers all of them, so a difference cannot be pinned to one
                        night.
                      </Why>
                    </>
                  )}
                  {unsynced.count > 0 && (
                    <>
                      <Chip tone="warn" icon={TriangleAlert} data-testid="unsynced-chip">
                        {unsynced.count} tablet{unsynced.count === 1 ? '' : 's'} behind
                      </Chip>
                      <Why label="what an unsent tablet means for this figure">
                        The figure above may be understated by bills a tablet has not sent
                        {unsynced.since
                          ? `, last heard from ${formatDateTime(unsynced.since)}`
                          : ''}
                        . Count anyway — you are the one holding the cash.
                      </Why>
                    </>
                  )}
                </ChipRow>

                <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
                  <Figure label="Last Left" paise={state.leftInDrawerPaise ?? 0} testId="left" />
                  {/* Both through the same rule, so the two cannot disagree
                      about what a sign means. Expenses are negated on the way
                      in, which is the whole of the difference between them. */}
                  <Figure
                    label="Cash from Bills"
                    paise={state.cashReceiptsSincePaise}
                    rows={state.cashReceiptsSinceCount}
                    testId="receipts-since"
                    signed
                  />
                  <Figure
                    label="Cash Expenses"
                    paise={-state.cashExpensesSincePaise}
                    rows={state.cashExpensesSinceCount}
                    testId="expenses-since"
                    signed
                  />
                </div>
              </>
            )}
          </Card>

          {/* ── The actions ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Button className="w-full" onClick={openCount} data-testid="open-count">
              <Banknote aria-hidden size={16} /> Count &amp; Collect
            </Button>
            {/* The escape hatch keeps the distance decision 5 asked for — the
                quieter row, after the collection — but not the invisibility.
                Rendered `ghost` it was text with no boundary, and the owner
                could not tell it was a control at all (design D22). */}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="phone"
                className="flex-1"
                onClick={() => openMovement('collect')}
                data-testid="open-collect"
              >
                <Minus aria-hidden size={14} /> Only Collect
              </Button>
              <Button
                variant="secondary"
                size="phone"
                className="flex-1"
                onClick={() => openMovement('spend')}
                data-testid="open-spend"
              >
                <Receipt aria-hidden size={14} /> Other Spend
              </Button>
            </div>
          </div>

          {/* ── Recent counts ───────────────────────────────────────────── */}
          {observations.length > 0 && (
            <Card className="space-y-2" data-testid="recent-counts">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
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
                    setAdjustedAmount('')
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
            </Card>
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
            <legend className="text-sm font-bold text-content">Collection time</legend>
            <div className="grid grid-cols-4 gap-2">
              {RELATIVE_TIMES.map((option) => {
                const candidate = new Date(sheetOpenedAt - option.minutes * 60_000)
                return (
                  <Button
                    key={option.label}
                    type="button"
                    size="phone"
                    className="px-0"
                    aria-label={option.spoken}
                    variant={relativeChoice === option.minutes ? 'primary' : 'secondary'}
                    onClick={() => setCountedAt(candidate)}
                    data-testid={`when-${option.minutes}`}
                  >
                    {option.label}
                  </Button>
                )
              })}
              {/*
                The fourth option, in the space beside the other three, for a
                count being caught up on days later — which has no relative name.

                **It opens the platform's own picker and takes no typing.** The
                input is present and bound, because that is what `showPicker()`
                acts on and what carries the value, but it is not somewhere a
                person puts a caret: a half-typed date is a date, and this field
                decides which cash a count is measured against.
              */}
              <div className="relative">
                <Button
                  type="button"
                  size="phone"
                  className="w-full px-0"
                  aria-label="Pick another date and time"
                  variant={relativeChoice === null ? 'primary' : 'secondary'}
                  onClick={openTimePicker}
                  data-testid="when-other"
                >
                  Other
                </Button>
                <input
                  ref={timePicker}
                  type="datetime-local"
                  value={toLocalInput(countedAt)}
                  onChange={(event) => {
                    const picked = new Date(event.target.value)
                    if (!Number.isNaN(picked.getTime())) setCountedAt(picked)
                  }}
                  // Reachable through the button above, which is the labelled
                  // control; a second tab stop for the same value is one control
                  // too many, and the picker itself is keyboard-navigable.
                  tabIndex={-1}
                  aria-hidden
                  // Rendered rather than `display:none`, so the picker has
                  // somewhere to anchor, and inert to the pointer so a stray tap
                  // lands on the button.
                  className="pointer-events-none absolute inset-0 size-full opacity-0"
                  data-testid="counted-at-picker"
                />
              </div>
            </div>
            {/*
              The chosen instant, as the value of the field above rather than as
              a chip. Chips are for facts ABOUT a thing; this IS the thing, and
              at chip size the one number the reader is choosing was the smallest
              text in the sheet.
            */}
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-content">
              <span className="font-semibold" data-testid="counted-at-echo">
                {formatDayTime(countedAt.toISOString())}
              </span>
              {/* Every count carries this window, so it is stated rather than
                  used to mark some counts out from others (design D19). */}
              <span className="text-content-muted" data-testid="tolerance-window">
                give or take {APPROXIMATE_WINDOW_MINUTES} min
              </span>
              <Why label="why every count time is approximate">
                Counting takes a few minutes and the counter keeps selling while you do it, so no
                stated time is exact. The window is the same whichever option you pick.
              </Why>
            </p>
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
                    <Why label="what short and over mean here">
                      {advice.direction === 'short'
                        ? 'This much is missing from the drawer against what was expected.'
                        : 'This much more than expected was counted.'}
                    </Why>
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
                          <Chip tone="neutral">
                            <Money paise={advice.timingCouldExplainPaise} /> moved nearby
                          </Chip>
                          <Why label="what nearby cash means for this difference">
                            Your time is approximate, so the timing could account for part of the
                            difference. Nothing here proposes a time — move the count time only if
                            you recognise the bills.
                          </Why>
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

      {/* ── Only Collect, and the rare Other Spend ─────────────────────── */}
      <FormSheet
        open={sheet === 'collect' || sheet === 'spend'}
        onClose={closeSheets}
        title={
          sheet === 'spend' ? 'Other spend' : movementIsAdding ? 'Add to drawer' : 'Collect cash'
        }
        error={error}
        footer={
          <Button
            type="submit"
            form="movement-form"
            className="w-full"
            disabled={busy || !movementUsable || movementPaise === 0 || reasonMissing}
            data-testid="save-movement"
          >
            {sheet === 'spend' ? 'Record spend' : movementIsAdding ? 'Add to drawer' : 'Collect'}
          </Button>
        }
      >
        <form
          id="movement-form"
          onSubmit={(event) => submitMovement(event, sheet === 'spend' ? 'spend' : 'collection')}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="movement-amount" className="text-sm font-bold text-content">
              How much?
            </label>
            <Input
              id="movement-amount"
              inputMode="decimal"
              value={movementAmount}
              onChange={(event) => setMovementAmount(event.target.value)}
              placeholder="5000"
              data-testid="movement-amount"
            />
            {movementIsAdding && sheet !== 'spend' && (
              <p
                role="alert"
                className="rounded-lg bg-warning px-2 py-1 text-sm font-bold text-on-warning"
                data-testid="movement-negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}
            {movementUsable && state && (
              <ChipRow>
                <Chip tone="neutral" data-testid="movement-preview">
                  <Money paise={state.expectedNowPaise ?? 0} /> →{' '}
                  <Money paise={(state.expectedNowPaise ?? 0) - movementPaise} />
                </Chip>
              </ChipRow>
            )}
          </div>

          {sheet === 'spend' ? (
            <div className="space-y-2">
              <label htmlFor="movement-reason" className="text-sm font-bold text-content">
                What did it buy?
              </label>
              <Input
                id="movement-reason"
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                placeholder="Chest freezer for the prep counter"
                data-testid="movement-reason"
              />
              <ChipRow>
                <Chip tone="neutral" data-testid="spend-not-an-expense">
                  not in the month&rsquo;s expenses
                </Chip>
                <Why label="why a spend is not an expense">
                  The drawer is genuinely lighter, but a fridge is not a running cost. Putting it
                  through expenses would move the drawer correctly and wreck the month.
                </Why>
              </ChipRow>
            </div>
          ) : (
            <ChipRow>
              <Chip tone="neutral" data-testid="collect-not-verified">
                nothing verified
              </Chip>
              <Why label="what collecting without counting does not do">
                You are not counting, so no difference is recorded and nothing is checked against
                the drawer.
              </Why>
            </ChipRow>
          )}

          <WhereaboutsPanel
            where={where}
            outletName={outlet?.name ?? null}
            reason={awayReason}
            onReason={setAwayReason}
          />
        </form>
      </FormSheet>

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
            disabled={busy || adjustedAmount.trim() === ''}
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
                label={formatDayTime(adjusting.countedAt)}
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

              <ChipRow>
                <Chip tone="good" icon={Check} data-testid="edit-leaves-no-trail">
                  no reason needed
                </Chip>
                <Why label="why this one takes no reason">
                  Nothing has been counted since, so no later figure was worked out from this one
                  and nobody has read it as settled. Correcting it now simply replaces it. Once a
                  later count opens at this figure the offer changes to an adjustment, which does
                  ask why and does stay on the record.
                </Why>
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
                  <Chip tone="neutral" icon={Lock}>
                    locked
                  </Chip>
                  <Why label="why this count is locked">
                    A later count read this figure as its own opening, which is the moment it became
                    load-bearing. Both figures stay on the record, and the later count re-anchors
                    the balance on what was physically there — so nothing after it moves.
                  </Why>
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
    <Input
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      data-testid={testId}
      className="h-[var(--size-control-phone)] w-44 shrink-0 text-base text-right"
    />
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
}: {
  label: string
  paise: number
  rows?: number
  testId: string
  /** Read this figure as a movement, so its sign and tone follow its value. */
  signed?: boolean
}) {
  const { prefix, tone } = signed ? signOf(paise) : { prefix: '', tone: undefined }
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-content-muted">{label}</p>
      <p data-testid={testId} className={tone}>
        {prefix}
        <Money paise={paise} />
      </p>
      {rows !== undefined && <p className="text-[0.6875rem] text-content-muted">{rows}</p>}
    </div>
  )
}

/** What a count came to, in the fewest words that say it. */
function verdictOf(observation: DrawerObservationRecord): {
  chip: ReactNode
  spoken: string
} {
  if (observation.isAnchor) {
    return {
      chip: (
        <Chip tone="neutral" data-testid={`anchor-${observation.id}`}>
          first count
        </Chip>
      ),
      spoken: 'first count',
    }
  }
  const difference = observation.differencePaise ?? 0
  if (difference === 0) {
    return {
      chip: (
        <Chip tone="good" icon={Check}>
          matched
        </Chip>
      ),
      spoken: 'matched',
    }
  }
  return {
    chip: (
      <Chip tone="bad" icon={difference < 0 ? ArrowDownRight : ArrowUpRight}>
        <Money paise={Math.abs(difference)} /> {difference < 0 ? 'short' : 'over'}
      </Chip>
    ),
    spoken: `${formatPaise(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}`,
  }
}

/**
 * One recent count, as a disclosure.
 *
 * Built the way `sync-event-row.tsx` builds one, because that is this app's
 * pattern for exactly this shape and a second implementation is a second thing
 * to keep in step: a full-width header button carrying `aria-expanded`, a
 * chevron that rotates, and a body that is **unmounted** while closed rather
 * than hidden — so find-in-page cannot lead a reader to text that is not there.
 *
 * **Closed, it carries what somebody is scanning for**: when, how much, and the
 * verdict, including `matched`, because a clean night reading blank is
 * indistinguishable from a row that has not loaded. The opening break rides
 * along, being the one condition that wants a second look.
 *
 * Everything else — the collection, the recorder, why they were away, the
 * adjustments and the control to adjust — is inside. Rendered together they were
 * five lines per count and a wall by the fourth (design D21).
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
  const verdict = verdictOf(observation)

  return (
    <div
      className="border-t border-border first:border-t-0"
      data-testid={`observation-${observation.id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        // Named explicitly: read from its own content this announces as a date,
        // a figure and a chip running into one another.
        aria-label={`Count of ${formatPaise(observation.countedTotalPaise)} at ${formatDayTime(
          observation.countedAt,
        )}, ${verdict.spoken}. ${open ? 'Hide' : 'Show'} the detail.`}
        className="flex w-full items-center gap-2 py-2 text-left focus-visible:focus-ring"
      >
        {/*
          One line: the instant, the verdict beside it, then the amount and the
          chevron held at the right edge. The verdict was a second line under
          the date, which cost a line per count for a chip that fits next to it.

          It WRAPS rather than truncating, and the direction of the give is
          deliberate. The amount and the chevron are `shrink-0`, so a long date
          against two chips — a short count that also broke its opening — pushes
          the chips onto a second line instead of clipping money. `ChipRow`'s own
          rule, and the one thing on this row that must never be cut off.
        */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs text-content-muted">
            {formatDayTime(observation.countedAt)}
          </span>
          {verdict.chip}
          {observation.openingBreakPaise !== null && (
            <Chip tone="warn" icon={TriangleAlert} data-testid={`break-${observation.id}`}>
              break <Money paise={observation.openingBreakPaise} />
            </Chip>
          )}
        </span>
        <Money
          paise={observation.countedTotalPaise}
          className="shrink-0 whitespace-nowrap text-sm font-semibold"
        />
        <ChevronDown
          aria-hidden
          size={16}
          className={cn('shrink-0 text-content-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-2 pb-2" data-testid={`observation-detail-${observation.id}`}>
          <ChipRow>
            {collected !== 0 && (
              <Chip tone="neutral" icon={collected < 0 ? Plus : Minus}>
                <Money paise={Math.abs(collected)} /> {collected < 0 ? 'in' : 'out'}
              </Chip>
            )}
            {!observation.onSite && (
              <Chip tone="neutral" icon={MapPinOff}>
                away
              </Chip>
            )}
            {observation.isAnchor && (
              <Why label="what a first count means">
                The drawer began here — there is nothing before it to compare against, so this count
                records no difference at all.
              </Why>
            )}
            {observation.openingBreakPaise !== null && (
              <Why label="why the break is not repaired">
                This count opened at a figure the previous one does not carry to. It is reported and
                not repaired: a figure somebody&rsquo;s count produced is evidence, and a recomputed
                one is not.
              </Why>
            )}
          </ChipRow>

          {(observation.recordedByName || observation.awayReason) && (
            <p className="text-[0.6875rem] text-content-muted">
              {observation.recordedByName}
              {observation.correctedByName &&
                observation.correctedByName !== observation.recordedByName &&
                ` · corrected by ${observation.correctedByName}`}
              {observation.awayReason && ` · ${observation.awayReason}`}
            </p>
          )}

          {observation.adjustments.map((adjustment) => (
            <p key={adjustment.id} className="text-[0.6875rem] text-content-muted">
              → <Money paise={adjustment.correctedCountedTotalPaise} /> (was{' '}
              <Money paise={adjustment.originalCountedTotalPaise} />) · {adjustment.reason}
            </p>
          ))}

          {locked ? (
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
      )}
    </div>
  )
}
