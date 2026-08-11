/**
 * When to look for a new build.
 *
 * Kept apart from registration so the schedule can be tested without a service
 * worker, and so every trigger is one more caller of one function. A future
 * trigger — a deployment announcing itself over the live connection, say — is
 * an addition here and nothing else (design D10, and `openspec/todos/`).
 *
 * There is deliberately **no cooldown**. Closing and reopening the app must be
 * a dependable way to force a check, and a cooldown is exactly what would make
 * it undependable. The check itself is one conditional request for a small
 * file, almost always answered "nothing new".
 */

/** Five minutes. The worst case for a device that stays open and connected. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * Wire every trigger to `check` and return a disposer.
 *
 * A background timer is throttled by the platform, sometimes to nothing; the
 * visibility trigger is what covers that, and the two compose rather than
 * duplicate. Reconnection is here because the common real sequence at an outlet
 * is a dropped connection, a deploy, and the connection returning.
 */
export function startUpdateWatch(check: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', check)
  const interval = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', check)
    window.clearInterval(interval)
  }
}
