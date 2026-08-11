import type { BillingCommand } from '../../shared/billing-command'
import type { BillingCommandResult } from '@/domain'
import { BillingDeliveryStore } from './store'

export const BILLING_DRAIN_LOCK_NAME = 'shawarmania-billing-delivery-drain'
export const MAX_BILLING_RETRY_MS = 60_000
const DEFAULT_LEASE_MS = 5_000
const DEFAULT_TICK_MS = 2_000
const RETRY_BASE_MS = 1_000

interface BillingLock {
  readonly name: string
}

export interface BillingLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: BillingLock | null) => Promise<T>,
  ): Promise<T>
}

export interface BillingDrainCoordinatorOptions {
  store: BillingDeliveryStore
  tabletId: string
  ownerId: string
  execute: (command: BillingCommand) => Promise<BillingCommandResult>
  locks?: BillingLockManager | null
  now?: () => number
  isVisible?: () => boolean
  leaseMs?: number
  tickMs?: number
  random?: () => number
  connectivityTarget?: EventTarget | null
  onReachability?: (reachable: boolean) => void
}

export function billingRetryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(16, attempt - 1))
  const withoutJitter = Math.min(MAX_BILLING_RETRY_MS, RETRY_BASE_MS * 2 ** exponent)
  const jitter = 0.75 + Math.min(1, Math.max(0, random())) * 0.5
  return Math.min(MAX_BILLING_RETRY_MS, Math.round(withoutJitter * jitter))
}

/**
 * One visible page schedules drain attempts. Web Locks is the primary mutex;
 * the renewable IndexedDB lease is the fallback. Browser connectivity events
 * only wake a retryâ€”reachability changes solely after an actual request.
 */
export class BillingDrainCoordinator {
  private readonly now: () => number
  private readonly isVisible: () => boolean
  private readonly leaseMs: number
  private readonly tickMs: number
  private readonly random: () => number
  private readonly connectivityTarget: EventTarget | null
  private interval: ReturnType<typeof setInterval> | null = null
  private running: Promise<number> | null = null
  private stopped = false

  constructor(private readonly options: BillingDrainCoordinatorOptions) {
    this.now = options.now ?? Date.now
    this.isVisible =
      options.isVisible ??
      (() => typeof document === 'undefined' || document.visibilityState === 'visible')
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS
    this.random = options.random ?? Math.random
    this.connectivityTarget =
      options.connectivityTarget ?? (typeof window === 'undefined' ? null : window)
  }

  start(): void {
    if (this.interval !== null) return
    this.stopped = false
    this.connectivityTarget?.addEventListener('online', this.onConnectivityHint)
    this.interval = globalThis.setInterval(() => void this.trigger(), this.tickMs)
    void this.trigger()
  }

  async runOnce(): Promise<number> {
    if (this.stopped || !this.isVisible()) return 0
    if (this.options.locks) {
      return this.options.locks.request(
        BILLING_DRAIN_LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => (lock ? this.drainAvailable() : 0),
      )
    }

    const acquired = await this.options.store.acquireLease(
      BILLING_DRAIN_LOCK_NAME,
      this.options.ownerId,
      this.now(),
      this.leaseMs,
    )
    if (!acquired) return 0

    const renewal = globalThis.setInterval(
      () => {
        void this.options.store.acquireLease(
          BILLING_DRAIN_LOCK_NAME,
          this.options.ownerId,
          this.now(),
          this.leaseMs,
        )
      },
      Math.max(1, Math.floor(this.leaseMs / 2)),
    )
    try {
      return await this.drainAvailable()
    } finally {
      globalThis.clearInterval(renewal)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.interval !== null) globalThis.clearInterval(this.interval)
    this.interval = null
    this.connectivityTarget?.removeEventListener('online', this.onConnectivityHint)
    await this.running?.catch(() => undefined)
    if (!this.options.locks) {
      await this.options.store.releaseLease(BILLING_DRAIN_LOCK_NAME, this.options.ownerId)
    }
  }

  private readonly onConnectivityHint = () => {
    void this.options.store.hintRetry(this.options.tabletId, this.now()).then(() => this.trigger())
  }

  private trigger(): Promise<number> {
    if (this.running) return this.running
    this.running = this.runOnce().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async drainAvailable(): Promise<number> {
    let delivered = 0
    while (!this.stopped) {
      const ready = await this.options.store.listReady(this.options.tabletId, this.now())
      if (ready.length === 0) break

      let progressed = false
      for (const envelope of ready) {
        try {
          const result = await this.options.execute(envelope.command)
          this.options.onReachability?.(true)
          if (result.status === 'retryable_failure') {
            const delay = billingRetryDelayMs(envelope.attemptCount + 1, this.random)
            await this.options.store.scheduleRetry(envelope.commandId, this.now() + delay)
          } else {
            await this.options.store.recordResult(envelope.commandId, result, this.now())
            if (result.status === 'accepted' || result.status === 'replay') delivered += 1
          }
          progressed = true
        } catch {
          this.options.onReachability?.(false)
          const delay = billingRetryDelayMs(envelope.attemptCount + 1, this.random)
          await this.options.store.scheduleRetry(envelope.commandId, this.now() + delay)
          progressed = true
        }
      }
      if (!progressed) break
    }
    return delivered
  }
}
