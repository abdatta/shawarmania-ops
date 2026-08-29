import { liveQuery, type Subscription } from 'dexie'

import { BillingDeliveryStore, type BillingUnresolvedSummary } from './store'

const HEARTBEAT_INTERVAL_MS = 60_000
type TimerHandle = number | ReturnType<typeof setInterval>

interface VisibilityTarget {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface BillingUnsentReporterOptions {
  store: BillingDeliveryStore
  tabletId: string
  reportState: (summary: BillingUnresolvedSummary) => Promise<void>
  visibilityTarget?: VisibilityTarget | null
  setInterval?: (callback: () => void, intervalMs: number) => TimerHandle
  clearInterval?: (timer: TimerHandle) => void
}

/**
 * Publishes one integer and nothing else. The reporting boundary has no access
 * to command payloads, so a customer phone cannot reach telemetry by accident.
 */
export class BillingUnsentReporter {
  private subscription: Subscription | null = null
  private interval: TimerHandle | null = null
  private latest: BillingUnresolvedSummary | null = null
  private reporting: Promise<void> | null = null
  private reading: Promise<void> | null = null
  private readAgain = false
  private running = false

  constructor(private readonly options: BillingUnsentReporterOptions) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.subscription = liveQuery(() =>
      this.options.store.unresolvedSummary(this.options.tabletId),
    ).subscribe({
      next: (summary) => this.queue(summary),
      // The next database change retries the read. Telemetry failure must not
      // interrupt billing or expose the underlying record in a log.
      error: () => undefined,
    })
    const setTimer = this.options.setInterval ?? setInterval
    this.interval = setTimer(() => this.requestRead(), HEARTBEAT_INTERVAL_MS)
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  async stop(): Promise<void> {
    this.running = false
    this.subscription?.unsubscribe()
    this.subscription = null
    if (this.interval !== null) {
      const clearTimer = this.options.clearInterval ?? clearInterval
      clearTimer(this.interval as ReturnType<typeof setInterval>)
      this.interval = null
    }
    this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibilityChange)
    await this.reading?.catch(() => undefined)
    await this.reporting?.catch(() => undefined)
    this.latest = null
  }

  private get visibilityTarget(): VisibilityTarget | null {
    if (this.options.visibilityTarget !== undefined) return this.options.visibilityTarget
    return typeof document === 'undefined' ? null : document
  }

  private readonly onVisibilityChange = () => {
    if (this.visibilityTarget?.visibilityState === 'visible') this.requestRead()
  }

  /** Every external nudge re-reads IndexedDB; a cached zero is never resent. */
  private requestRead(): void {
    if (!this.running) return
    if (this.reading) {
      this.readAgain = true
      return
    }
    this.reading = this.readCurrent().finally(() => {
      this.reading = null
      if (this.readAgain && this.running) {
        this.readAgain = false
        this.requestRead()
      }
    })
  }

  private async readCurrent(): Promise<void> {
    try {
      const summary = await this.options.store.unresolvedSummary(this.options.tabletId)
      if (this.running) this.queue(summary)
    } catch {
      // A later heartbeat or database change tries the local read again.
    }
  }

  private queue(summary: BillingUnresolvedSummary): void {
    if (!this.running) return
    this.latest = summary
    if (this.reporting) return
    this.reporting = this.flush().finally(() => {
      this.reporting = null
      if (this.latest !== null) this.queue(this.latest)
    })
  }

  private async flush(): Promise<void> {
    while (this.latest !== null && this.running) {
      const summary = this.latest
      this.latest = null
      try {
        await this.options.reportState(summary)
      } catch {
        // The counter adapter deliberately treats heartbeat failure as stale
        // telemetry. The command queue remains the source of truth.
      }
    }
  }
}
