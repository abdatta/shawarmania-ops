import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingBlock } from '@/components/ui/loading'
import type {
  AggregatorSyncEventRow,
  AggregatorSyncHealth,
  HyperpureHealth,
} from '@/data-access/adapters'

import { attentionChanged } from '@/features/attention/attention'
import { cn } from '@/lib/cn'

import type { AggregatorChannelConfig } from './channel-config'
import { needsOwner } from './needs-you-count'
import { RunHistory } from './run-history'
import { readAgainAfterHours, readsPerDayPhrase, whenItRan } from './when'
import { SyncEventRow } from './sync-event-row'

/**
 * What a restaurant channel's sync has done, and the two things the owner can
 * do about it.
 *
 * **A row here is something that happened, not a time the job ran.** The sync
 * runs several times a day against every outlet, which is hundreds of runs a
 * month of which nearly all change nothing. (How many exactly is the runner's to
 * report, not this file's to claim — see `when.ts`.) A row per run would bury the
 * two that matter inside a hundred and eighteen that say "nothing", and a log
 * nobody reads is the same as no log. The line at the top carries "it ran, it
 * was fine"; the list carries only what moved.
 *
 * One implementation serves every restaurant channel through its
 * {@link AggregatorChannelConfig}: the questions are the same — what was read,
 * what moved, what wants a decision, how do I sign back in — and only the
 * portal answering them differs. What genuinely differs beyond wording is
 * Hyperpure: it rides Zomato's login, so only Zomato's page carries its health
 * line and their shared repair ladder. Swiggy owns its session outright, so
 * nothing here can render or repair another channel on its behalf.
 *
 * **Nothing on this page can make a discrepancy disappear.** A week that will
 * not reconcile offers checking again and accepting the gap on the record. There
 * is no button that writes the figures and says nothing, because that is the one
 * outcome the whole capability exists to prevent.
 */

/**
 * Whether reading again could tell the owner anything new, in hours.
 *
 * Two conditions withhold the button and they are different in kind [owner,
 * 2026-08-18]. A run in progress is about correctness, and is handled at the
 * button: two readers would race for one session, and the sliding idle window
 * means the loser can invalidate the winner's token. A SUCCESSFUL run in the
 * last six hours is this one, and it is about not offering a control whose only
 * effect is to make somebody wait for figures they already have.
 *
 * A FAILED run does not count. Pressing this after a failure is exactly the point,
 * and a six-hour lockout on a lapsed session would leave the owner staring at a
 * disabled button on the one screen built to fix it.
 */
export function readAgainInHours(health: AggregatorSyncHealth, now = Date.now()): number | null {
  if (health.lastOutcome !== 'ok' || !health.lastRunAt) return null
  // One read interval, from the cadence the runner reported — not a constant six
  // beside it. Six was one interval while the readers ran four times a day and
  // silently became half of one when they did not.
  const window = readAgainAfterHours(health.readsPerDay)
  const since = (now - new Date(health.lastRunAt).getTime()) / 3_600_000
  if (!Number.isFinite(since) || since >= window) return null
  return Math.max(1, Math.ceil(window - since))
}

export function AggregatorSyncSurface({
  config,
  heading,
  channelSwitch,
  outletId,
  outletSelector,
}: {
  config: AggregatorChannelConfig
  /**
   * The word at the top of the page. Defaults to the channel's own.
   *
   * The Delivery container overrides it, because the switch directly below
   * already names the channel and a header repeating it is a wasted line on a
   * phone — two rows of controls sit between the title and the first figure as
   * it is.
   */
  heading?: string
  /**
   * Which channel this screen is about, rendered directly under the header.
   *
   * Above the loading block rather than inside the loaded body, so switching
   * channels moves the selection immediately and the panel beneath it fills in
   * afterwards. A switch that disappeared while its own channel loaded would be
   * a control that cannot be used twice in a row.
   */
  channelSwitch?: ReactNode
  /**
   * Which outlet this is about, chosen by the container above.
   *
   * **The scope is not this component's**, since #48 gave the surface two
   * controls that have to agree: the outlet chips and the channel switch nest,
   * and a component that owned one of them while the container owned the other
   * could not make their arithmetic line up. Null while the outlets load.
   */
  outletId: string | null
  /** The chips themselves, rendered in this surface's header. */
  outletSelector: ReactNode
}) {
  const adapter = config.adapter
  const { pathname } = useLocation()

  // Each chip carries its own outlet's waiting work, from the same read the tab
  // badge uses. Without it the tab says three, the page shows one, and the other
  // two are somewhere the reader has to go looking for by switching outlets and
  // hoping.
  const [health, setHealth] = useState<AggregatorSyncHealth | null>(null)
  const [hyperpure, setHyperpure] = useState<HyperpureHealth | null>(null)
  const [events, setEvents] = useState<AggregatorSyncEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  /*
   * Hours until reading again could say anything new, or null if it could now.
   *
   * Held in state rather than derived at render, because deciding it needs the
   * current time and reading a clock during render is impure: two renders of the
   * same data would disagree, and React is entitled to render whenever it likes.
   */
  const [readAgainIn, setReadAgainIn] = useState<number | null>(null)
  /**
   * Bumped when a run finishes or the owner does something, so the history
   * re-reads from its first page.
   *
   * Deliberately not tied to `refresh`, which polls every 700ms while a run is
   * going: a list that reset itself twice a second would be unscrollable while
   * anything was happening. The two moments the history can actually have
   * changed are a run ending and an action landing.
   */
  const [historyKey, setHistoryKey] = useState(0)
  const historyChanged = useCallback(() => setHistoryKey((key) => key + 1), [])

  /**
   * When this channel's reconnect was dispatched, or null.
   *
   * Set the moment a dispatch is confirmed, then resolved against what a newer
   * run reports. Held as a ref rather than state: nothing renders from the tap
   * itself — verdicts render, derived against this timestamp in the refresh
   * chain below.
   */
  const reconnectAskedAtRef = useRef<number | null>(null)
  /**
   * Whether a VERDICT (a run newer than the tap) has confirmed the repair did
   * not follow — distinct from a mere tap, which proves nothing yet.
   */
  const [halfFailure, setHalfFailure] = useState(false)

  // Written as a promise chain rather than an awaited async call, matching the
  // ledger surface beside it: state set inside a `then` is set after the render
  // that started it, which is what keeps this out of the cascading-render
  // pattern the lint rule watches for.
  const refresh = useCallback(() => {
    if (!outletId) return Promise.resolve()
    return Promise.all([
      adapter.getHealth(outletId),
      adapter.listEvents(outletId),
      // Account-level Hyperpure health exists for the Zomato variant alone; the
      // Swiggy surface never reads another channel's state at all.
      config.showsHyperpure ? adapter.getHyperpureHealth() : Promise.resolve(null),
    ])
      .then(([nextHealth, nextEvents, nextHyperpure]) => {
        setHealth(nextHealth)
        setEvents(nextEvents)
        setHyperpure(nextHyperpure)
        setReadAgainIn(readAgainInHours(nextHealth))
        const askedAt = reconnectAskedAtRef.current
        if (askedAt !== null && nextHealth.lastRunAt && !nextHealth.running) {
          const ranAfterTap = new Date(nextHealth.lastRunAt).getTime() >= askedAt
          const healed = ranAfterTap && nextHealth.lastOutcome !== 'session_lapsed' ? askedAt : null
          if (healed !== null) reconnectAskedAtRef.current = null
        }
        if (!config.showsHyperpure) return
        setHalfFailure(() => {
          if (reconnectAskedAtRef.current === null) return false
          const askedAt = reconnectAskedAtRef.current
          if (!nextHyperpure || nextHyperpure.running) return false
          if (!nextHyperpure.lastRunAt) return false
          if (new Date(nextHyperpure.lastRunAt).getTime() < askedAt) return false
          return !nextHyperpure.hasSession || nextHyperpure.lastOutcome === 'session_lapsed'
        })
      })
      .catch(() => {
        setError('Could not read the sync. Try again in a moment.')
      })
  }, [adapter, config.showsHyperpure, outletId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * While a run is going, ask again.
   *
   * The surface follows the run rather than the request that started it: asking
   * for a run succeeds within a moment, long before the reader has read
   * anything, so a screen that settled on the request would report a finished
   * sync about a job that had not begun.
   */
  const wasRunning = useRef(false)
  useEffect(() => {
    // On the Zomato side a capture-only repair never touches the Zomato run
    // rows, so following the surface means watching EITHER channel's running
    // state there. Swiggy has no child to tow, so its own flag is the whole
    // story.
    const anyRunning =
      (health?.running ?? false) || (config.showsHyperpure ? (hyperpure?.running ?? false) : false)
    if (!anyRunning) {
      // A run that has just finished is the moment the work it did becomes
      // visible, and the tab's badge is somewhere else on the screen. Nudging
      // when the action was *asked for* would be too early: asking succeeds
      // immediately and the reader has not read anything yet.
      if (wasRunning.current) {
        wasRunning.current = false
        attentionChanged()
        // A run that just finished is a new line at the top of the history, and
        // the one it replaces read as under way.
        historyChanged()
      }
      return
    }
    wasRunning.current = true
    const timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, 700)
    return () => clearInterval(timer)
  }, [health?.running, hyperpure?.running, refresh, config.showsHyperpure, historyChanged])

  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      // Tell the tab's badge to re-read. Resolving the last week that would
      // not reconcile should take the number away, and the number is on the
      // other side of the screen from the button that cleared it.
      attentionChanged()
      historyChanged()
    } catch {
      setError('That did not go through. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!outletId || code.trim() === '') return
    const entered = code
    // Cleared before it is sent, and never put in a URL or a log. It is a
    // credential passing through, and it should live on this screen for as
    // little time as possible.
    setCode('')
    await act(() => adapter.answerOneTimePassword(outletId, entered))
  }

  const [uploadWrote, setUploadWrote] = useState<readonly string[] | null>(null)

  /**
   * The disaster-recovery upload: a file supplied by hand when the reader cannot run.
   *
   * It does not go through `act`, because its failure is worth showing in the
   * file's own words — "this matches no known statement shape" is actionable in a
   * way "that did not go through" is not — and its success is a per-outlet list
   * rather than a silent refresh. The file is read to base64 and handed to the
   * one parser every caller shares.
   */
  const onUpload = async (file: File) => {
    // Uploading parses and writes server-side, so it needs a connection. Said
    // outright rather than left to fail as a timeout, and it does not queue: a
    // statement is a deliberate recovery act, not something to replay silently
    // later against figures that may have moved in between.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('Uploading a statement needs a connection. Try again once you are back online.')
      return
    }
    setBusy(true)
    setError(null)
    setUploadWrote(null)
    try {
      const base64 = await fileToBase64(file)
      const result = await adapter.uploadStatement({ filename: file.name, base64 })
      setUploadWrote(result.wrote)
      await refresh()
      attentionChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That upload did not go through.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Where a day lives in the ledger.
   *
   * Derived from this page's own address rather than hard-coded, because the
   * role segment differs per shell and demo mode carries the persona in the URL:
   * a fixed path would walk the reader into somebody else's shell mid-flow. The
   * outlet needs no parameter, since the ledger reads the same remembered scope
   * this page is already set to.
   */
  const ledgerDayLink = (businessDate: string) =>
    `${pathname.replace(new RegExp(`${config.pathSegment}$`), '')}?date=${businessDate}`

  /** Nothing may be started while something is running. */
  const acting =
    busy ||
    (health?.running ?? false) ||
    (config.showsHyperpure ? (hyperpure?.running ?? false) : false)

  const waiting = health?.awaitingOneTimePassword ?? null
  const actionable = events?.filter((row) => needsOwner(row)) ?? []
  /**
   * Resolved rows that record a DECISION rather than a write.
   *
   * The history below covers everything a run did. These two are the rows a run
   * cannot reproduce, because the run is not what settled them — the owner is.
   */
  const decided =
    events?.filter(
      (row) =>
        row.resolvedAt !== null &&
        (row.event.kind === 'possible-duplicate-expense' || row.event.kind === 'week-disputed'),
    ) ?? []

  /**
   * Who is signed out, collapsed into ONE repair per family.
   *
   * On the Zomato side a lapse arrives as event rows and the Hyperpure line —
   * two vocabularies for what is usually one problem, since a dead parent takes
   * the child with it; when both are out the owner gets one card and one
   * button. Swiggy answers to itself alone: its lapsed card dispatches Swiggy's
   * own login, and no code typed for Swiggy can ever close another channel's
   * request or the reverse.
   */
  const missingConfiguredSwiggySession =
    config.channel === 'swiggy' &&
    health !== null &&
    !health.running &&
    health.syncedFrom !== null &&
    !health.hasSession
  const channelLapsed =
    missingConfiguredSwiggySession ||
    health?.lastOutcome === 'session_lapsed' ||
    (actionable.some((row) => row.event.kind === 'session-lapsed') ?? false)
  const hyperpureLapsed =
    config.showsHyperpure &&
    hyperpure !== null &&
    (!hyperpure.hasSession || hyperpure.lastOutcome === 'session_lapsed') &&
    !hyperpure.running
  const reconnectCopy = reconnectCardCopy(config, channelLapsed, hyperpureLapsed, halfFailure) // The card carries the action, so the event row that would duplicate it steps
  // aside while the card is up; it resolves itself once the sign-in lands.
  const actionableCovered = actionable.filter(
    (row) => !(reconnectCopy !== null && row.event.kind === 'session-lapsed'),
  )

  /*
   * A login is worth watching while a repair card is on screen.
   *
   * The full-login rung does all its work before anything lands in
   * `aggregator_sync_runs`, so neither channel's running flag rises while the
   * robot boots — and without a watch the code card would appear only whenever
   * somebody happened to reload. Keyed to the repair state, the watch survives
   * navigation and refreshes, and stops the moment both lines go quiet.
   */
  const watchForLogin = reconnectCopy !== null || waiting !== null
  useEffect(() => {
    if (!watchForLogin) return
    const timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, 5_000)
    return () => clearInterval(timer)
  }, [watchForLogin, refresh])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title={heading ?? config.title}
        subtitle={config.subtitle}
      />

      {channelSwitch}

      {error && (
        <p className="mb-4 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-content">
          {error}
        </p>
      )}

      {!health || !events ? (
        <LoadingBlock label="Reading the sync" />
      ) : (
        <div className="space-y-4">
          <HealthLine
            config={config}
            health={health}
            busy={acting}
            readAgainIn={readAgainIn}
            onRun={() => act(() => adapter.requestRun(outletId!))}
          />

          {config.showsHyperpure && hyperpure && (
            <HyperpureHealthLine health={hyperpure} halfFailed={halfFailure} />
          )}

          <UploadStatement config={config} busy={acting} wrote={uploadWrote} onUpload={onUpload} />

          {waiting && (
            <Card className="border-warning/60 bg-warning/5 p-4">
              <h2 className="text-sm font-medium text-content">{config.otpHeading}</h2>
              <p className="mt-1 text-sm text-content-muted">
                Check the phone the account is registered to. It expires in a few minutes.
              </p>
              <form onSubmit={submitCode} className="mt-3 flex flex-wrap gap-2">
                <label htmlFor={`${config.testIdPrefix}-otp`} className="sr-only">
                  The one time password {config.label} sent for this outlet
                </label>
                <input
                  id={`${config.testIdPrefix}-otp`}
                  value={code}
                  onChange={(changed) => setCode(changed.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  // 16px floor: anything smaller makes a mobile browser zoom the
                  // viewport on focus, and this field is typed on a phone by
                  // definition.
                  className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-base tabular-nums text-content"
                />
                <Button type="submit" disabled={busy || code.trim() === ''}>
                  Sign back in
                </Button>
              </form>
            </Card>
          )}

          {(reconnectCopy !== null || actionableCovered.length > 0) && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
                Needs you
              </h2>
              {reconnectCopy !== null && (
                <ReconnectCard copy={reconnectCopy} busy={acting} onReconnect={onReconnect} />
              )}
              {actionableCovered.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </section>
          )}

          {/*
            The decisions the owner has already taken.

            The merged derived list retired into two halves: anything still
            unresolved is above in Needs you, and the runs are below. A dismissed
            duplicate pair and an accepted difference are neither — they are
            decisions, and they must not simply vanish when the list that carried
            them does. They are the only rows here a run cannot reproduce: a run
            says what it wrote, and these say what a person concluded about it.

            Only the two that were decided. A settled week and a revised day
            were also resolved rows, and both are now runs that say what moved
            and by how much, so listing them here as well would be the same fact
            twice under two headings.
          */}
          {decided.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
                What you decided
              </h2>
              {decided.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
              What has happened
            </h2>
            {/*
              Keyed, so switching channel or outlet — or a run finishing — gives
              a fresh list rather than one that has to unpick itself. A history
              that could outlive its own subject is a history that can splice two
              of them together.
            */}
            <RunHistory
              key={`${config.channel}:${outletId}:${historyKey}`}
              adapter={adapter}
              outletId={outletId!}
              channelLabel={config.label}
            />
          </section>
        </div>
      )}
    </div>
  )

  function onReconnect() {
    void act(() =>
      adapter
        .requestReconnect(outletId!, reconnectCopy!.channel)
        .then((result) => {
          if (result.outcome === 'dispatched') {
            reconnectAskedAtRef.current = Date.now()
            setHalfFailure(false)
          }
        })
        .then(() => undefined),
    )
  }

  function Row({ row }: { row: AggregatorSyncEventRow }) {
    return (
      <SyncEventRow
        row={row}
        channelLabel={config.label}
        busy={acting}
        onRecheck={(from, to) => void act(() => adapter.recheckWeek(outletId!, from, to))}
        onAccept={(from, to) => void act(() => adapter.acceptDifference(outletId!, from, to))}
        onReconnect={() =>
          void act(() => adapter.requestReconnect(outletId!).then(() => undefined))
        }
        onNotDuplicate={() => void act(() => adapter.markNotDuplicate(outletId!, row.id))}
        ledgerDayLink={ledgerDayLink}
      />
    )
  }
}

/**
 * The reconnect card's words, or null when nothing is signed out.
 *
 * Computed rather than embedded so the shared surface stays ignorant of each
 * channel's family: Zomato tows Hyperpure and collapses two outages into one
 * repair; Swiggy stands alone and says exactly that. `halfFailed` names the
 * moment Zomato came back but the child did not follow — a verdict, never a tap.
 */
function reconnectCardCopy(
  config: AggregatorChannelConfig,
  channelLapsed: boolean,
  hyperpureLapsed: boolean,
  halfFailed: boolean,
): {
  title: string
  body: string
  action: string
  testId: string
  /** Which channel's repair this card dispatches. */
  channel: 'zomato' | 'swiggy' | 'hyperpure'
} | null {
  if (config.channel === 'swiggy') {
    if (!channelLapsed) return null
    return {
      title: config.lapsedTitle,
      body: 'Nothing was written while it was out, so no figure is wrong.',
      action: `Reconnect ${config.label}`,
      testId: `needs-reconnect-${config.testIdPrefix}`,
      channel: 'swiggy',
    }
  }

  if (channelLapsed && hyperpureLapsed) {
    return {
      title: 'Zomato and Hyperpure are signed out',
      body: 'Nothing was written while they were out, so no figure is wrong. One sign-in brings both back.',
      action: 'Reconnect Zomato & Hyperpure',
      testId: 'needs-reconnect-both',
      channel: 'zomato',
    }
  }
  if (hyperpureLapsed) {
    return {
      title: "Hyperpure's session ended",
      body: 'Zomato is still signed in, so this repairs quietly — no code needed.',
      action: 'Reconnect Hyperpure',
      testId: 'needs-reconnect-hyperpure',
      channel: 'hyperpure',
    }
  }
  if (channelLapsed) {
    return {
      title: config.lapsedTitle,
      body: halfFailed
        ? 'Signed into Zomato, but Hyperpure didn’t follow — try again.'
        : 'Nothing was written while it was out, so no figure is wrong.',
      action: `Reconnect ${config.label}`,
      testId: `needs-reconnect-${config.testIdPrefix}`,
      channel: 'zomato',
    }
  }
  return null
}

/** One line for every run that changed nothing. */
function HealthLine({
  config,
  health,
  busy,
  readAgainIn,
  onRun,
}: {
  config: AggregatorChannelConfig
  health: AggregatorSyncHealth
  busy: boolean
  readAgainIn: number | null
  onRun: () => void
}) {
  const when = health.lastRunAt ? whenItRan(health.lastRunAt) : null

  // No status dot. A round mark in the primary colour is what a badge looks
  // like everywhere else in this app, and a badge means exactly one thing here:
  // somebody is waiting on you.
  const [word, wrong] = health.running
    ? (['Reading', false] as const)
    : health.lastOutcome === 'ok'
      ? (['All quiet', false] as const)
      : health.lastOutcome === null
        ? (['Never run', false] as const)
        : (['Stuck', true] as const)

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="flex items-center gap-2.5">
        <div>
          <p className={cn('text-sm font-medium', wrong ? 'text-danger' : 'text-content')}>
            {word}
          </p>
          <p className="text-xs text-content-muted">
            {!health.syncedFrom
              ? `Not switched on here yet`
              : when
                ? `${when} · ${readsPerDayPhrase(health.readsPerDay)}`
                : `Reads ${readsPerDayPhrase(health.readsPerDay)}`}
          </p>
        </div>
      </div>
      <div className="text-right">
        <Button
          variant="secondary"
          onClick={onRun}
          disabled={busy || health.running || readAgainIn !== null}
          data-testid={`${config.testIdPrefix}-read-now`}
        >
          {health.running ? 'Reading…' : 'Read now'}
        </Button>
        {readAgainIn !== null && !health.running && (
          <p
            className="mt-1 text-xs text-content-muted"
            data-testid={`${config.testIdPrefix}-read-now-why`}
          >
            {/*
              Not "just read": the lockout runs for six hours after a SUCCESSFUL
              run, so this sat under a button saying "just" about something that
              happened five hours ago. When it last ran is on the line to the
              left; what this has to say is only when pressing would be worth
              anything again.
            */}
            Ready again in {readAgainIn}h.
          </p>
        )}
      </div>
    </Card>
  )
}

/**
 * Hyperpure's health, beside Zomato's but thinner. Rendered on Zomato's page
 * only — account level, towing child, and never shown where it would be noise.
 */
function HyperpureHealthLine({
  health,
  halfFailed,
}: {
  health: HyperpureHealth
  halfFailed: boolean
}) {
  const when = health.lastRunAt ? whenItRan(health.lastRunAt) : null

  const stale = !health.hasSession || health.lastOutcome === 'session_lapsed'
  const [word, wrong] = health.running
    ? (['Reading', false] as const)
    : stale
      ? (['Session ended', true] as const)
      : health.lastOutcome === 'shape_changed'
        ? (['Stuck', true] as const)
        : health.lastOutcome === 'ok'
          ? (['All quiet', false] as const)
          : (['Never run', false] as const)

  let note: string
  if (health.running) {
    note = 'Repairing the session — this can take a few minutes'
  } else if (halfFailed) {
    note = 'Signed into Zomato, but Hyperpure didn’t follow — try again'
  } else if (stale) {
    note = 'Upload the Hyperpure account statement below to bring its figures in'
  } else if (word === 'Stuck') {
    note = 'A statement could not be read — a maintainer has been told'
  } else {
    note = when
      ? `${when} · ${readsPerDayPhrase(health.readsPerDay)}`
      : `Reads ${readsPerDayPhrase(health.readsPerDay)}`
  }

  return (
    <Card
      className="flex flex-wrap items-center justify-between gap-3 p-3"
      data-testid="hyperpure-health"
    >
      <div>
        <p className={cn('text-sm font-medium', wrong ? 'text-danger' : 'text-content')}>
          Hyperpure · {word}
        </p>
        <p className="text-xs text-content-muted">{note}</p>
      </div>
    </Card>
  )
}

function ReconnectCard({
  copy,
  busy,
  onReconnect,
}: {
  copy: { title: string; body: string; action: string; testId: string }
  busy: boolean
  onReconnect: () => void
}) {
  return (
    <Card className="border-warning/60 bg-warning/5 p-4">
      <h2 className="text-sm font-medium text-content">{copy.title}</h2>
      <p className="mt-1 text-sm text-content-muted">{copy.body}</p>
      {/* The default variant is the alert fill: this is a Needs-you action, and
          Needs-you actions are the loud ones, matching every row below. */}
      <Button disabled={busy} onClick={onReconnect} className="mt-3" data-testid={copy.testId}>
        {copy.action}
      </Button>
    </Card>
  )
}

/** A file's bytes as base64, for handing to the parser through the adapter. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** The fallback made visible: bring a period in by hand when the reader is blocked. */
function UploadStatement({
  config,
  busy,
  wrote,
  onUpload,
}: {
  config: AggregatorChannelConfig
  busy: boolean
  wrote: readonly string[] | null
  onUpload: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Card className="p-4" data-testid={`${config.testIdPrefix}-upload-statement`}>
      <h2 className="text-sm font-medium text-content">Upload a statement</h2>
      <p className="mt-1 text-sm text-content-muted">{config.uploadHint}</p>
      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          accept={config.uploadAccept}
          className="sr-only"
          aria-label={`Upload a ${config.label} statement file`}
          data-testid={`${config.testIdPrefix}-upload-input`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so the same file can be chosen again after a fix.
            event.target.value = ''
            if (file) onUpload(file)
          }}
        />
        <Button
          variant="secondary"
          disabled={busy}
          data-testid={`${config.testIdPrefix}-upload-choose`}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </Button>
      </div>
      {wrote && wrote.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid={`${config.testIdPrefix}-upload-result`}>
          {wrote.map((line, index) => (
            <li key={index} className="text-sm text-content">
              {line}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
