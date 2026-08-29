/** A tablet heartbeat older than this is evidence that the tablet is out of touch. */
export const COUNTER_TELEMETRY_FRESH_MS = 30 * 60 * 1000

export function isCounterTelemetryFresh(lastSeenAt: string | null, nowMs = Date.now()): boolean {
  if (!lastSeenAt) return false
  const seenAtMs = Date.parse(lastSeenAt)
  return Number.isFinite(seenAtMs) && nowMs - seenAtMs <= COUNTER_TELEMETRY_FRESH_MS
}
