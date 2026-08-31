import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Card } from '@/components/ui/card'
import { LoadingList } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { formatPaise } from '@/domain'
import type {
  AggregatorSyncAdapter,
  AggregatorSyncRunRow,
  AggregatorRunSummary,
} from '@/data-access/adapters'
import { summaryMoved } from '@/data-access/aggregator-run-summary'
import { cn } from '@/lib/cn'

import { collapseRuns, type RunGroup } from './collapse-runs'
import { dayInWords, kolkataClock, readsPerDayPhrase, shortDate } from './when'

/**
 * Every run the sync has made, newest first (#48).
 *
 * **This overturns the surface's founding rule**, which said a row here is an
 * event rather than a run, and gave a sound reason: over a hundred runs a month,
 * nearly all quiet. What replaces that reason is compression plus laziness — the
 * quiet majority costs one line, and a page loads only when somebody scrolls to
 * it — and the fourth absence it closes is the one that costs the most. The
 * adapter deliberately heals: one successful run ends every failure older than
 * it. That is right for *Needs you* and wrong for history, where a session that
 * died at 4:10 am and was repaired at noon generated nine failed reads that
 * nobody can find afterwards.
 *
 * Anything that still wants a person keeps its louder home in *Needs you*,
 * which this change does not touch.
 */

/**
 * What one run says, in owner words.
 *
 * Four states, and the failure one deliberately speaks the vocabulary *Needs
 * you* already uses — a failure healed an hour ago is still findable an hour
 * later, and it should not need a second glossary to be understood.
 */
interface RunLine {
  tag: string
  tone: 'quiet' | 'attention' | 'wrong'
  /** The sentence a screen reader gets: a tag beside a time is not one. */
  spoken: string
}

function lineFor(run: AggregatorSyncRunRow, channelLabel: string): RunLine {
  if (run.finishedAt === null) {
    return { tag: 'Reading', tone: 'attention', spoken: 'A read is under way' }
  }
  switch (run.outcome) {
    case 'session_lapsed':
      return { tag: 'Signed out', tone: 'wrong', spoken: `${channelLabel} signed us out` }
    case 'awaiting_one_time_password':
      // "code" rather than "one time password", matching the card that asks for
      // it — and deliberately not the field's own label, which names the outlet
      // and is the thing a reader is meant to type into.
      return { tag: 'Code wanted', tone: 'attention', spoken: 'Waiting for a sign-in code' }
    case 'shape_changed':
      return { tag: 'Unreadable', tone: 'wrong', spoken: 'The reply could not be read' }
    case 'reconciliation_failed':
      return { tag: 'Does not add up', tone: 'wrong', spoken: 'The payout did not add up' }
    default:
      return summaryMoved(run.summary)
        ? { tag: 'Moved', tone: 'quiet', spoken: 'Figures moved' }
        : { tag: 'Nothing moved', tone: 'quiet', spoken: 'Read, and nothing moved' }
  }
}

const TONE_TAG = {
  quiet: 'bg-surface text-content-muted',
  attention: 'bg-warning/15 text-content',
  wrong: 'bg-danger/15 text-content',
} as const

/**
 * What moved, as a line to look at and a sentence to hear.
 *
 * Both, from one pass over the same figures, because they differ on purpose:
 * the visible line is scanned — `12 Aug revised ₹9,410.00 → ₹9,286.50` — and
 * the spoken one has to be a sentence, since an arrow is not read aloud as
 * anything. The pattern is the event row's beside it, and building both here
 * rather than in two functions is what stops them drifting.
 */
interface Movement {
  spoken: string
  node: React.ReactNode
}

function describeMovements(summary: AggregatorRunSummary): Movement[] {
  const lines: Movement[] = []

  for (const day of summary.days) {
    const to = day.to.revenuePaise
    const from = day.from?.revenuePaise ?? null
    const when = shortDate(day.businessDate)

    if (day.movement === 'revised' && from !== null && to !== null) {
      lines.push({
        spoken: `${when} revised from ${formatPaise(from)} to ${formatPaise(to)}`,
        node: (
          <span key={`day-${day.businessDate}`}>
            {when} revised <Money paise={from} /> → <Money paise={to} />
          </span>
        ),
      })
    } else if (to !== null) {
      lines.push({
        spoken: `${when} measured ${formatPaise(to)}`,
        node: (
          <span key={`day-${day.businessDate}`}>
            {when} measured <Money paise={to} />
          </span>
        ),
      })
    } else {
      lines.push({
        spoken: `${when} measured`,
        node: <span key={`day-${day.businessDate}`}>{when} measured</span>,
      })
    }
  }

  for (const cycle of summary.cyclesSettled) {
    const paid = cycle.statedPayoutPaise ?? cycle.computedPaise
    const week = `${shortDate(cycle.cycleStart)}–${shortDate(cycle.cycleEnd)}`
    lines.push({
      spoken: `Week ${week} paid ${formatPaise(paid)}`,
      node: (
        <span key={`cycle-${cycle.cycleStart}`}>
          Week {week} paid <Money paise={paid} />
        </span>
      ),
    })
  }

  const { added, amended } = summary.supplyOrders
  for (const [count, verb] of [
    [added, 'added'],
    [amended, 'amended'],
  ] as const) {
    if (count === 0) continue
    const said = `${count} Hyperpure order${count === 1 ? '' : 's'} ${verb}`
    lines.push({ spoken: said, node: <span key={`supply-${verb}`}>{said}</span> })
  }

  return lines
}

/**
 * The window a run considered, in one short phrase.
 *
 * **This is what a quiet run has to say.** "Nothing moved" on its own is a
 * shrug; "read 7 days, 24–30 Aug and nothing moved" is a report. It is also the
 * only thing that differs between the runs inside a collapsed group — they
 * collapsed precisely because everything else about them matched — so it is what
 * makes opening one worth the tap.
 *
 * Kept to a phrase rather than a sentence because it sits on a row beside a
 * time, on a phone. One day reads as the day; a span reads as the span, with the
 * month said once where both ends share it.
 */
function readSpan(summary: AggregatorRunSummary | null): string | null {
  const read = summary?.read
  if (!read) return null
  if (read.from === read.to) return `${read.days} day, ${shortDate(read.to)}`

  const [, fromMonth] = read.from.split('-')
  const [, toMonth] = read.to.split('-')
  // `24–30 Aug` rather than `24 Aug–30 Aug`: the month twice in six characters
  // of row is width spent saying nothing.
  const from =
    fromMonth === toMonth ? String(Number(read.from.split('-')[2])) : shortDate(read.from)
  return `${read.days} days, ${from}–${shortDate(read.to)}`
}

function RunCard({ group, channelLabel }: { group: RunGroup; channelLabel: string }) {
  const [open, setOpen] = useState(false)
  const line = lineFor(group.lead, channelLabel)
  const many = group.runs.length > 1
  const oldest = group.runs[group.runs.length - 1] ?? group.lead
  const moved = group.lead.summary !== null ? describeMovements(group.lead.summary) : []

  /**
   * What the line is about.
   *
   * A collapsed group says how many it stands for and the span it covers, and
   * that count is always visible — a group that hid its size would be a group
   * that hid a run somebody was looking for.
   */
  const subject = many
    ? `${group.runs.length} reads · ${kolkataClock(oldest.startedAt)}–${kolkataClock(group.lead.startedAt)}`
    : group.lead.startedBy === 'owner'
      ? `${kolkataClock(group.lead.startedAt)} · you asked`
      : `${kolkataClock(group.lead.startedAt)}${group.lead.startedBy === 'schedule' ? ` · ${readsPerDayPhrase(group.lead.readsPerDay)}` : ''}`

  /*
   * What moved is on the CLOSED row, including what it changed from.
   *
   * The question this surface exists to answer is "why did this day's number
   * move", and a line that only reports movement has sent the reader looking
   * for the answer. So the movements are always rendered; expanding is for the
   * runs inside a collapsed group and for the failure's own words.
   */
  // A quiet run says what it looked at, where a moving one says what it moved.
  // Never both: a run that moved something has already said the interesting half
  // and the window would be a second line nobody reads.
  const span = moved.length === 0 ? readSpan(group.lead.summary) : null

  const expandable = many || group.lead.detail !== null

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        aria-label={[
          line.spoken,
          subject,
          // What moved is spoken as part of the row rather than left inside it.
          // A reader told only that a day was revised has been told less than
          // the screen says.
          ...moved.map((movement) => movement.spoken),
          span === null ? '' : `Read ${span}`,
          expandable ? `${open ? 'Hide' : 'Show'} the detail.` : '',
        ]
          .filter(Boolean)
          .join('. ')}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-100"
      >
        <span
          className={cn(
            'w-[6.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium',
            TONE_TAG[line.tone],
          )}
        >
          {line.tag}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-content">{subject}</span>
        {expandable && (
          <ChevronDown
            aria-hidden
            size={14}
            className={cn('shrink-0 text-content-muted transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {moved.length > 0 && (
        <ul className="space-y-1 px-3 pb-2.5 text-sm text-content" data-testid="run-moved">
          {moved.map((entry, index) => (
            <li key={index}>{entry.node}</li>
          ))}
        </ul>
      )}

      {/*
        Beneath the row rather than beside it. A tag, a subject, a window and a
        chevron do not fit across 375px, and this surface is read on a phone by
        definition — so what the run did takes its own line, exactly as the
        movements above do.
      */}
      {span !== null && (
        <p className="px-3 pb-2.5 text-sm text-content-muted" data-testid="run-read">
          Read {span}
        </p>
      )}

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3 text-sm text-content-muted">
          {group.lead.detail && <p className="text-content">{group.lead.detail}</p>}
          {group.lead.summary !== null &&
            group.lead.summary.datesWithoutARecordedDay.length > 0 && (
              <p>
                No day was recorded yet for{' '}
                {group.lead.summary.datesWithoutARecordedDay.map(shortDate).join(', ')}, so the
                figures are waiting on one.
              </p>
            )}
          {many && (
            /*
             * One line per run, and each says what IT looked at.
             *
             * A bare column of times was the first version and it answered
             * nothing: the reader already knew there were six, and the span was
             * on the line above. What actually differs between runs in a group
             * is the window each one read, which is also the only thing that
             * can differ — everything else matched, which is why they collapsed.
             */
            <ul className="space-y-1">
              {group.runs.map((run) => (
                <li key={run.id} className="flex items-baseline justify-between gap-3">
                  <span className="shrink-0 tabular-nums">{kolkataClock(run.startedAt)}</span>
                  {/*
                    The window, but only where it is not the one already stated
                    above. Collapsing breaks at a day boundary, so runs in a
                    group almost always read the same rolling window — printing
                    it against every time would be the same string four times
                    and would bury the one occasion it differs.
                  */}
                  {readSpan(run.summary) !== span && (
                    <span className="min-w-0 truncate text-right">
                      {readSpan(run.summary) ?? 'nothing read'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * The list itself.
 *
 * Pages arrive as the reader approaches the end, and the groups are recomputed
 * over everything accumulated so far on every arrival — so a group of seven
 * straddling a page edge reads as one group of seven rather than three above
 * four (design D6).
 */
/**
 * **Remounted rather than reset.** The caller keys this component on the
 * channel, the outlet and its own nudge, so switching any of them gives a fresh
 * instance with fresh state — rather than an effect that clears five things and
 * has to get every one of them right. That is not a style preference: the reset
 * version had a real defect, where a page already in flight resolved after the
 * clear and moved the cursor into the middle of a history whose first page had
 * never been fetched. A component that cannot outlive its own subject cannot
 * have that bug.
 */
export function RunHistory({
  adapter,
  outletId,
  channelLabel,
}: {
  adapter: AggregatorSyncAdapter
  outletId: string
  channelLabel: string
}) {
  const [runs, setRuns] = useState<AggregatorSyncRunRow[] | null>(null)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  /**
   * Whether a page is already out.
   *
   * A ref rather than state, and this is the one place it matters: two callers
   * can ask for a page in the same tick — the first-page effect and the
   * sentinel — and a state flag they both read is still `false` for both,
   * because setting state does not change what a closure already captured. Two
   * requests with the same cursor then append the same runs twice, which React
   * reports as duplicate keys and the reader sees as a list that doubled.
   */
  const inFlight = useRef(false)
  /** Where the next page continues from. Keyset, so it is a run's own time. */
  const cursor = useRef<string | null>(null)

  const loadMore = useCallback(() => {
    if (inFlight.current || done) return
    inFlight.current = true
    adapter
      .listRuns(outletId, { before: cursor.current })
      .then((page) => {
        setRuns((current) => [...(current ?? []), ...page.runs])
        cursor.current = page.before
        if (page.before === null) setDone(true)
      })
      .catch(() => setFailed(true))
      .finally(() => {
        inFlight.current = false
      })
  }, [adapter, done, outletId])

  /** How much is already on screen, which is what re-arms the sentinel. */
  const loaded = runs?.length ?? 0

  // The first page, and every later one the sentinel asks for.
  useEffect(() => {
    if (runs === null && !failed) loadMore()
  }, [runs, failed, loadMore])

  useEffect(() => {
    const node = sentinel.current
    if (!node || done || failed) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      // A little ahead of the viewport, so the next page is usually already
      // there by the time the reader reaches the bottom of this one.
      { rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
    // Re-observed after every page, and that is load-bearing rather than
    // defensive: an observer fires on a CHANGE in intersection, so a sentinel
    // that was already in view when a short page landed under it would sit
    // there intersecting and never fire again. Re-creating it re-asks the
    // question, and the chase stops on its own when the last page comes back
    // short and `done` turns the whole effect off.
  }, [done, failed, loadMore, loaded])

  const groups = useMemo(() => collapseRuns(runs ?? []), [runs])

  if (runs === null) {
    // The shape of what is arriving: run cards, not a generic block. The list
    // below is the only thing on this part of the surface, so a placeholder of
    // another shape would reflow it as the first page lands.
    return <RunHistoryPlaceholder />
  }

  if (runs.length === 0) {
    return (
      <Card className="p-4 text-sm text-content-muted">
        Nothing has run here yet. The line above says when it last tried.
      </Card>
    )
  }

  /** Where the recorded summaries stop, said out loud rather than implied. */
  const firstCoarse = groups.findIndex((group) => group.lead.summary === null)

  return (
    <div className="space-y-2" data-testid="run-history-list">
      {groups.map((group, index) => (
        <div key={group.lead.id} className="space-y-2">
          {(index === 0 || groups[index - 1]?.day !== group.day) && (
            <h3
              className="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-content-muted"
              data-testid={`run-day-${group.day}`}
            >
              {dayInWords(group.day)}
            </h3>
          )}
          {index === firstCoarse && (
            <p className="px-1 py-1 text-xs text-content-muted" data-testid="run-history-cut-off">
              Runs older than this say when they ran and how they went, and nothing more — what a
              run changed could not be worked out after the fact.
            </p>
          )}
          <RunCard group={group} channelLabel={channelLabel} />
        </div>
      ))}

      {failed && (
        <Card className="p-4 text-sm text-content-muted">
          Could not read any further back. Try again in a moment.
        </Card>
      )}

      {!done && !failed && (
        <div ref={sentinel} data-testid="run-history-more">
          <RunHistoryPlaceholder rows={2} />
        </div>
      )}
    </div>
  )
}

/**
 * The silhouette of arriving run cards.
 *
 * A run card is a fixed-height row — a tag, a subject, no figure column — so
 * the placeholder is that height and nothing under it moves when a page lands.
 */
function RunHistoryPlaceholder({ rows = 4 }: { rows?: number }) {
  return (
    <LoadingList
      label="the run history"
      rows={rows}
      // A run card is one row of controls tall — a tag, a subject, no figure
      // column — so the placeholder is that height rather than the tall-card
      // default, and nothing under it moves when a page lands.
      blockHeight="h-11"
      className="space-y-2"
      data-testid="run-history-loading"
    />
  )
}
