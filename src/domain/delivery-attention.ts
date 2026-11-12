/**
 * The outcomes of a run that read the portal with the session it held.
 *
 * `reconciliation_failed` is one: a run only gets as far as reconciling once it
 * has read and written its weeks, so the reads are working, and the week that
 * did not add up asks the owner on its own row. Treating only `ok` as working
 * kept a lapse asking for a Reconnect the owner had just done, and the health
 * line reading "Stuck" beside a channel that was reading fine (2026-11-12).
 */
export const READING_WORKED = ['ok', 'reconciliation_failed'] as const

export function readingWorked(outcome: string | null): boolean {
  return (READING_WORKED as readonly string[]).includes(outcome ?? '')
}

/** A normal running sync is not work for a person. Failures and missing
 * credentials on a configured integration are; a never-configured one is not.
 * Stored expiry is advisory: the provider, through a failed read, decides when
 * a session has actually lapsed. */
export function integrationNeedsAttention(
  health: {
    running: boolean
    hasSession: boolean
    lastOutcome: string | null
    lastRunAt: string | null
    syncedFrom?: string | null
    /** Advisory provider estimate; never sufficient evidence of a lapse. */
    sessionExpiresAt?: string | null
    awaitingOneTimePassword?: unknown
  },
  now = Date.now(),
): boolean {
  const configured = Boolean(health.syncedFrom || health.lastRunAt || health.hasSession)
  const timedOut =
    health.running && health.lastRunAt !== null && now - Date.parse(health.lastRunAt) > 30 * 60_000
  if (health.awaitingOneTimePassword) return true
  if (health.running && !timedOut) return false
  return (
    configured &&
    (timedOut ||
      !health.hasSession ||
      health.lastOutcome === 'session_lapsed' ||
      health.lastOutcome === 'shape_changed')
  )
}

/** Outlet chips include their connection issue; the page counts that issue once. */
export function deliveryAttentionTotal(
  counts: readonly { needing: number; integrationIssue?: boolean }[],
): number {
  return (
    counts.reduce((sum, row) => sum + row.needing - Number(Boolean(row.integrationIssue)), 0) +
    Number(counts.some((row) => row.integrationIssue))
  )
}
