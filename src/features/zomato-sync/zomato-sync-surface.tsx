import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { LoadingBlock } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type {
  AggregatorSyncEventRow,
  AggregatorSyncHealth,
  HyperpureHealth,
} from '@/data-access/adapters'
import { useLocation } from 'react-router'

import { attentionChanged } from '@/features/attention/attention'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

import { needsOwner, useNeedsYouCounts, zomatoAttentionLabel } from './needs-you-count'
import { SyncEventRow } from './sync-event-row'

/**
 * What the Zomato sync has done, and the two things the owner can do about it.
 *
 * **A row here is something that happened, not a time the job ran.** The sync
 * runs twice a day against every outlet, which is roughly a hundred and twenty
 * runs a month of which nearly all change nothing. A row per run would bury the
 * two that matter inside a hundred and eighteen that say "nothing", and a log
 * nobody reads is the same as no log. The line at the top carries "it ran, it
 * was fine"; the list carries only what moved.
 *
 * The shape is the attendance screen's: closed by default, open when it wants
 * something. The owner asked for it by name, and it is the right answer for the
 * same reason it was there: most rows are a record and a few are a job.
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
 * button: two readers would race for one Zomato session, and the sliding idle
 * window means the loser can invalidate the winner's token. A SUCCESSFUL run in the
 * last six hours is this one, and it is about not offering a control whose only
 * effect is to make somebody wait for figures they already have.
 *
 * A FAILED run does not count. Pressing this after a failure is exactly the point,
 * and a six-hour lockout on a lapsed session would leave the owner staring at a
 * disabled button on the one screen built to fix it.
 *
 * The schedule is untouched by any of this. A job that skipped itself because
 * somebody had pressed a button would leave the gap invisible until a figure was
 * missing.
 */
const READ_AGAIN_AFTER_HOURS = 6

export function readAgainInHours(health: AggregatorSyncHealth, now = Date.now()): number | null {
  if (health.lastOutcome !== 'ok' || !health.lastRunAt) return null
  const since = (now - new Date(health.lastRunAt).getTime()) / 3_600_000
  if (!Number.isFinite(since) || since >= READ_AGAIN_AFTER_HOURS) return null
  return Math.max(1, Math.ceil(READ_AGAIN_AFTER_HOURS - since))
}

export function ZomatoSyncSurface() {
  const { aggregatorSync } = useAdapters()
  const { pathname } = useLocation()

  // Each chip carries its own outlet's waiting work, from the same read the tab
  // badge uses. Without it the tab says three, the page shows one, and the other
  // two are somewhere the reader has to go looking for by switching outlets and
  // hoping.
  const needing = useNeedsYouCounts()
  const { outletId, selector: outletSelector } = useOutletScope({
    badgeFor: (candidate, selected) => {
      const count = needing?.find((entry) => entry.outletId === candidate)?.needing ?? 0
      return (
        <Badge
          data-testid={`zomato-needing-${candidate}`}
          count={count}
          // The chip already names the outlet, so the label does not repeat it.
          label={zomatoAttentionLabel(count)}
          // A selected chip is filled with `--primary`, which is the badge's own
          // colour, so an unswapped badge sits invisibly on top of it. Inverting
          // to the same asserted pair the other way round is what attendance's
          // chips already do, and it is the contrast the validator checks.
          className={selected ? 'bg-on-primary text-primary' : ''}
        />
      )
    },
  })

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
   * It is recomputed wherever the health is, which is on mount, while a run is
   * going, and when one finishes — every moment it could actually change.
   */
  const [readAgainIn, setReadAgainIn] = useState<number | null>(null)

  // Written as a promise chain rather than an awaited async call, matching the
  // ledger surface beside it: state set inside a `then` is set after the render
  // that started it, which is what keeps this out of the cascading-render
  // pattern the lint rule watches for.
  const refresh = useCallback(() => {
    if (!outletId) return Promise.resolve()
    return Promise.all([
      aggregatorSync.getHealth(outletId),
      aggregatorSync.listEvents(outletId),
      // Account-level, so it does not depend on the outlet in scope; read here so
      // it refreshes on the same beat as the Zomato health, including mid-run.
      aggregatorSync.getHyperpureHealth(),
    ])
      .then(([nextHealth, nextEvents, nextHyperpure]) => {
        setHealth(nextHealth)
        setEvents(nextEvents)
        setHyperpure(nextHyperpure)
        setReadAgainIn(readAgainInHours(nextHealth))
      })
      .catch(() => {
        setError('Could not read the sync. Try again in a moment.')
      })
  }, [aggregatorSync, outletId])

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
    if (!health?.running) {
      // A run that has just finished is the moment the work it did becomes
      // visible, and the tab's badge is somewhere else on the screen. Nudging
      // when the action was *asked for* would be too early: asking succeeds
      // immediately and the reader has not read anything yet.
      if (wasRunning.current) {
        wasRunning.current = false
        attentionChanged()
      }
      return
    }
    wasRunning.current = true
    const timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, 700)
    return () => clearInterval(timer)
  }, [health?.running, refresh])

  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      // Tell the tab's badge to re-read. Resolving the last week that would not
      // reconcile should take the number away, and the number is on the other
      // side of the screen from the button that cleared it.
      attentionChanged()
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
    await act(() => aggregatorSync.answerOneTimePassword(outletId, entered))
  }

  const [uploadWrote, setUploadWrote] = useState<readonly string[] | null>(null)

  /**
   * The disaster-recovery upload: a statement supplied by hand when the reader
   * cannot run.
   *
   * It does not go through `act`, because its failure is worth showing in the
   * file's own words — "this matches no known statement shape" is actionable in a
   * way "that did not go through" is not — and its success is a per-outlet list
   * rather than a silent refresh. The file is read to base64 and handed to the
   * one parser both callers share.
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
      const result = await aggregatorSync.uploadStatement({ filename: file.name, base64 })
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
    `${pathname.replace(/\/zomato$/, '')}?date=${businessDate}`

  /**
   * Nothing may be started while something is running.
   *
   * Tracking the request alone is not enough: asking for a run succeeds immediately by
   * design, so the buttons would come back to life while the reader was still
   * out reading Zomato, and a second Check again would race the first.
   */
  const acting = busy || (health?.running ?? false)

  const waiting = health?.awaitingOneTimePassword ?? null
  const actionable = events?.filter((row) => needsOwner(row)) ?? []
  const rest = events?.filter((row) => !needsOwner(row)) ?? []

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Zomato"
        subtitle="What was read, and anything that needs you."
      />

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
            health={health}
            busy={acting}
            readAgainIn={readAgainIn}
            onRun={() => act(() => aggregatorSync.requestRun(outletId!))}
          />

          {hyperpure && (
            <HyperpureHealthLine
              health={hyperpure}
              busy={acting || waiting !== null}
              onReconnect={() => act(() => aggregatorSync.requestReconnect(outletId!))}
            />
          )}

          <UploadStatement busy={acting} wrote={uploadWrote} onUpload={onUpload} />

          {waiting && (
            <Card className="border-warning/60 bg-warning/5 p-4">
              <h2 className="text-sm font-medium text-content">Zomato sent you a code</h2>
              <p className="mt-1 text-sm text-content-muted">
                Check the phone the account is registered to. It expires in a few minutes.
              </p>
              <form onSubmit={submitCode} className="mt-3 flex flex-wrap gap-2">
                <label htmlFor="zomato-otp" className="sr-only">
                  The one time password Zomato sent for this outlet
                </label>
                <input
                  id="zomato-otp"
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

          {actionable.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
                Needs you
              </h2>
              {actionable.map((row) => (
                <SyncEventRow
                  key={row.id}
                  row={row}
                  busy={acting}
                  onRecheck={(from, to) =>
                    void act(() => aggregatorSync.recheckWeek(outletId!, from, to))
                  }
                  onAccept={(from, to) =>
                    void act(() => aggregatorSync.acceptDifference(outletId!, from, to))
                  }
                  onReconnect={() => void act(() => aggregatorSync.requestReconnect(outletId!))}
                  onNotDuplicate={() =>
                    void act(() => aggregatorSync.markNotDuplicate(outletId!, row.id))
                  }
                  ledgerDayLink={ledgerDayLink}
                />
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-content-muted">
              What changed
            </h2>
            {rest.length === 0 ? (
              <Card className="p-4 text-sm text-content-muted">
                Nothing yet. The line above says when it last ran.
              </Card>
            ) : (
              rest.map((row) => (
                <SyncEventRow
                  key={row.id}
                  row={row}
                  busy={acting}
                  onRecheck={(from, to) =>
                    void act(() => aggregatorSync.recheckWeek(outletId!, from, to))
                  }
                  onAccept={(from, to) =>
                    void act(() => aggregatorSync.acceptDifference(outletId!, from, to))
                  }
                  onReconnect={() => void act(() => aggregatorSync.requestReconnect(outletId!))}
                  onNotDuplicate={() =>
                    void act(() => aggregatorSync.markNotDuplicate(outletId!, row.id))
                  }
                  ledgerDayLink={ledgerDayLink}
                />
              ))
            )}
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * One line for every run that changed nothing.
 *
 * This is what stops the list below filling with silence. "It ran at 11:02 and
 * was fine" is the whole of what a hundred and eighteen quiet runs have to say
 * between them, and saying it once is the difference between a page somebody
 * reads and a page somebody scrolls past.
 */
function HealthLine({
  health,
  busy,
  readAgainIn,
  onRun,
}: {
  health: AggregatorSyncHealth
  busy: boolean
  /** Hours until reading again could say anything new, or `null` if it could now. */
  readAgainIn: number | null
  onRun: () => void
}) {
  const when = health.lastRunAt
    ? new Date(health.lastRunAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  // No status dot. A round mark in the primary colour is what a badge looks
  // like everywhere else in this app, and a badge means exactly one thing here:
  // somebody is waiting on you. Putting one beside "All quiet" said both at
  // once. The word carries the status, and a failure gets the danger colour on
  // the word itself rather than on a shape beside it.
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
              ? 'Not switched on here yet'
              : when
                ? `${when} · twice a day`
                : 'Twice a day'}
          </p>
        </div>
      </div>
      <div className="text-right">
        <Button
          variant="secondary"
          onClick={onRun}
          disabled={busy || health.running || readAgainIn !== null}
          data-testid="read-now"
        >
          {health.running ? 'Reading…' : 'Read now'}
        </Button>
        {readAgainIn !== null && !health.running && (
          // The reason, beside the button rather than inside it. A disabled control
          // with no explanation reads as broken, and this one is deliberate.
          <p className="mt-1 text-xs text-content-muted" data-testid="read-now-why">
            Just read. Again in {readAgainIn}h.
          </p>
        )}
      </div>
    </Card>
  )
}

/**
 * Hyperpure's health, beside Zomato's but thinner.
 *
 * It has no "Read now" of its own, and its reconnect is the Zomato one: Hyperpure
 * rides the Zomato login, so one sign-in restores both. But a channel that is down
 * must offer the way to fix it wherever the owner is looking — and a healthy Zomato
 * shows no reconnect anywhere, so a lapsed Hyperpure with only a Zomato session
 * still alive would strand the owner with a broken line and no button. So when
 * Hyperpure's session has ended, this line carries the reconnect itself: the same
 * action, which signs back into Zomato and captures Hyperpure in the same pass.
 * Account level, so it says nothing about which outlet is in scope. Before this
 * line existed, a broken Hyperpure read was a red CI job the owner never saw.
 */
function HyperpureHealthLine({
  health,
  busy,
  onReconnect,
}: {
  health: HyperpureHealth
  busy: boolean
  onReconnect: () => void
}) {
  const when = health.lastRunAt
    ? new Date(health.lastRunAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  // A session that has ended, or a read that failed on it, is the owner's to fix,
  // and this is where they fix it. A shape change is a maintainer's. Everything
  // else is quiet. Same vocabulary as the Zomato line, so the two read as one.
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

  const note = stale
    ? 'Signs back into Zomato and restores Hyperpure in the same step'
    : word === 'Stuck'
      ? 'A statement could not be read — a maintainer has been told'
      : when
        ? `${when} · twice a day`
        : 'Twice a day'

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
      {stale && (
        <Button
          variant="secondary"
          onClick={onReconnect}
          disabled={busy}
          data-testid="hyperpure-reconnect"
        >
          Reconnect
        </Button>
      )}
    </Card>
  )
}

/**
 * A file's bytes as base64, for handing to the parser through the adapter.
 *
 * `FileReader` rather than reading into a buffer, because this runs in the
 * browser and the data-URL prefix is stripped so only the payload travels.
 */
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

/**
 * The fallback made visible: bring a period in by hand when the reader is blocked.
 *
 * Deliberately quiet — a control, not a call to action — because the automation
 * is the normal path and this is the one for the day it stops. It says which
 * three files it takes and what each is for, so a person reaching for it under
 * pressure is not guessing, and it reports back per outlet rather than resolving
 * into silence.
 */
function UploadStatement({
  busy,
  wrote,
  onUpload,
}: {
  busy: boolean
  wrote: readonly string[] | null
  onUpload: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Card className="p-4" data-testid="upload-statement">
      <h2 className="text-sm font-medium text-content">Upload a statement</h2>
      <p className="mt-1 text-sm text-content-muted">
        If the automation is blocked, bring a period in by hand: a Zomato order history, a Zomato
        settlement report, or a Hyperpure statement. The file is read the same way the robot reads
        it.
      </p>
      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.zip,.csv"
          className="sr-only"
          aria-label="Upload a Zomato or Hyperpure statement file"
          data-testid="upload-input"
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
          data-testid="upload-choose"
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </Button>
      </div>
      {wrote && wrote.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="upload-result">
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
