import type { ChangeGateSummary, DeviceHealthReading } from '@/data-access/adapters'

/** A report older than this is a tablet that has gone quiet (design D13). */
export const HEALTH_STALE_AFTER_MS = 2 * 60_000

export interface TabletState {
  /**
   * `running` — the tablet loaded with this gate in its current state.
   * `waiting` — the state changed since, and it has not reloaded into it yet.
   */
  follows: 'running' | 'waiting'
  /** The dot: a live reading, so it may carry a colour. */
  health: 'ok' | 'failing' | 'stale'
}

/**
 * What a change gate's page says about one tablet for that gate.
 *
 * A stale tablet still says running or waiting, from its last report, because
 * that is the last thing it told anybody; the dot is what says not to trust it.
 */
export function tabletState(
  tablet: DeviceHealthReading,
  gate: Pick<ChangeGateSummary, 'key' | 'enabled'>,
  now: Date = new Date(),
): TabletState {
  const bootedOn = tablet.bootedGates.includes(gate.key)
  const follows = bootedOn === gate.enabled ? 'running' : 'waiting'
  const age = now.getTime() - new Date(tablet.reportedAt).getTime()
  const health = age > HEALTH_STALE_AFTER_MS ? 'stale' : tablet.failed > 0 ? 'failing' : 'ok'
  return { follows, health }
}
