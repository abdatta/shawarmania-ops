/**
 * Taking a waiting build, at a moment that costs nothing.
 *
 * Runs outside React on purpose: it needs no rendering, it must work before the
 * app mounts, and it must work identically in the demo tree, which renders no
 * app-owned action at all.
 *
 * The loop is a poll rather than a subscription because occupancy changes on
 * every keystroke, and a notification per keystroke would be a great deal of
 * work to arrive at the same answer a second later.
 */

import { isOccupied } from './occupancy'
import { getUpdateState, markUpdateDeferred, subscribeToUpdates } from './update-store'

/** How often to re-ask whether the page has become free. */
export const OCCUPANCY_POLL_MS = 1_000

/**
 * How long the page must stay free before the reload lands.
 *
 * Counter billing is continuous. Reloading the instant one order settles would
 * arrive as the next one begins, which is the interruption this change exists
 * to remove, merely relocated. The re-confirmation after the wait is what makes
 * the wait mean something (design D8).
 */
export const SETTLE_MS = 3_000

let reloadRequested = false

/**
 * Take the update. Guarded so that no edge — a second detection, a racing
 * timer, a re-entrant tick — can reload an unattended tablet more than once.
 */
function applyUpdate(reload: () => void): void {
  if (reloadRequested) return
  reloadRequested = true
  reload()
}

export type ApplyLoopOptions = {
  /** Injected so a test can observe the decision without navigating. */
  reload?: () => void
  now?: () => number
}

/**
 * Watch for a ready update and take it at the first moment that costs nothing.
 *
 * Returns a disposer.
 */
export function startApplyLoop(options: ApplyLoopOptions = {}): () => void {
  const reload = options.reload ?? (() => window.location.reload())

  let timer: number | undefined
  /** When the page was first seen free in the current stretch. */
  let freeSince: number | null = null
  const now = options.now ?? (() => performance.now())

  const tick = () => {
    if (!getUpdateState().ready || reloadRequested) return

    if (isOccupied()) {
      // Both the reason the action appears and the reason a settle in progress
      // is abandoned: work resuming during the wait must not be interrupted.
      freeSince = null
      markUpdateDeferred()
      return
    }

    if (freeSince === null) {
      freeSince = now()
      return
    }

    if (now() - freeSince >= SETTLE_MS) applyUpdate(reload)
  }

  const start = () => {
    if (timer !== undefined) return
    // Evaluated immediately as well as on the interval, so an idle page takes
    // the update on the next settle rather than waiting out a poll first.
    tick()
    timer = window.setInterval(tick, OCCUPANCY_POLL_MS)
  }

  const stop = () => {
    if (timer === undefined) return
    window.clearInterval(timer)
    timer = undefined
  }

  const unsubscribe = subscribeToUpdates(() => {
    if (getUpdateState().ready) start()
  })

  if (getUpdateState().ready) start()

  return () => {
    unsubscribe()
    stop()
  }
}

/** Take the update now, because somebody asked for it. */
export function requestUpdateNow(reload: () => void = () => window.location.reload()): void {
  applyUpdate(reload)
}

/** Test seam. */
export function resetApplyState(): void {
  reloadRequested = false
}
