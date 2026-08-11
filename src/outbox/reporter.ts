import { liveQuery, type Subscription } from 'dexie'

import { BillingDeliveryStore } from './store'

export interface BillingUnsentReporterOptions {
  store: BillingDeliveryStore
  tabletId: string
  reportState: (unsent: number) => Promise<void>
}

/**
 * Publishes one integer and nothing else. The reporting boundary has no access
 * to command payloads, so a customer phone cannot reach telemetry by accident.
 */
export class BillingUnsentReporter {
  private subscription: Subscription | null = null
  private latest: number | null = null
  private reporting: Promise<void> | null = null

  constructor(private readonly options: BillingUnsentReporterOptions) {}

  start(): void {
    if (this.subscription) return
    this.subscription = liveQuery(() =>
      this.options.store.countUnsent(this.options.tabletId),
    ).subscribe({
      next: (count) => this.queue(count),
      // The next database change retries the read. Telemetry failure must not
      // interrupt billing or expose the underlying record in a log.
      error: () => undefined,
    })
  }

  async stop(): Promise<void> {
    this.subscription?.unsubscribe()
    this.subscription = null
    await this.reporting?.catch(() => undefined)
  }

  private queue(count: number): void {
    this.latest = count
    if (this.reporting) return
    this.reporting = this.flush().finally(() => {
      this.reporting = null
      if (this.latest !== null) this.queue(this.latest)
    })
  }

  private async flush(): Promise<void> {
    while (this.latest !== null) {
      const count = this.latest
      this.latest = null
      try {
        await this.options.reportState(count)
      } catch {
        // The counter adapter deliberately treats heartbeat failure as stale
        // telemetry. The command queue remains the source of truth.
      }
    }
  }
}
