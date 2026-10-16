/**
 * How fresh is fresh enough, named once (the-app-asks-the-server-less, D2).
 *
 * Every request the app makes costs a log line at Supabase, and on the smallest
 * compute it costs the counter too. A screen re-reads when something says the
 * data changed — a change notice, its own write, its first load — and on a
 * return to the foreground only when what it holds is stale. It never re-reads
 * on a fixed timer without waiting for the last read. These are the numbers
 * that rule uses, so the next screen takes them instead of inventing its own.
 * `docs/ARCHITECTURE.md` → *How a screen keeps its data fresh*.
 */

/** A count already on screen is re-read on returning to the foreground only when older than this. */
export const FOREGROUND_REREAD_AFTER_MS = 120_000

/**
 * How old the counter's menu may be before a sale notice reloads it. Discounts
 * and the outlet's settings have no change notice of their own, so a sale is
 * still how they reach a running counter; a menu edit reloads it at once.
 */
export const MENU_REREAD_ON_SALE_AFTER_MS = 120_000

/** Change notices this close together are one burst, answered by one read. */
export const NOTICE_BURST_MS = 300

/** How often a running aggregator sync is checked for its finish. */
export const RUNNING_SYNC_CHECK_MS = 3_000

/** Whether a read made at `at` (epoch ms, or null for never) is older than `ms`. */
export function olderThan(at: number | null, ms: number, now: number = Date.now()): boolean {
  return at === null || now - at > ms
}

export interface BurstMerger {
  /** Note one change; `run` happens once, `ms` after the last notice of the burst. */
  notice(): void
  /** Forget a pending run, for an unmounting screen. */
  cancel(): void
}

/**
 * Answers a burst of change notices with one call. One sale sends two or three
 * notices — the order, the bill, the order again — and each used to cost a full
 * refresh of its own.
 */
export function mergeBursts(
  run: () => void,
  ms: number = NOTICE_BURST_MS,
  timers: {
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  } = {
    setTimeout: (callback, wait) => globalThis.setTimeout(callback, wait),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): BurstMerger {
  let pending: unknown = null
  return {
    notice() {
      if (pending !== null) timers.clearTimeout(pending)
      pending = timers.setTimeout(() => {
        pending = null
        run()
      }, ms)
    },
    cancel() {
      if (pending !== null) timers.clearTimeout(pending)
      pending = null
    },
  }
}
