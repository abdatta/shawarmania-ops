import type { CounterDeviceSummary } from '@/data-access/adapters'
import { isCounterTelemetryFresh } from '@/domain'

export type DrawerTabletTelemetry =
  | { kind: 'clear' }
  | {
      kind: 'unresolved' | 'out-of-touch'
      tabletCount: number
      unresolvedCount: number
      reportedAt: string | null
      oldestUnresolvedAt: string | null
    }

/**
 * A fresh zero is the only clear verdict. A tablet whose heartbeat is absent or
 * old makes the drawer provisional even when the last integer happened to be
 * zero, because silence is not evidence that its local queue stayed empty.
 */
export function classifyDrawerTabletTelemetry(
  devices: readonly CounterDeviceSummary[],
  outletId: string,
  nowMs = Date.now(),
): DrawerTabletTelemetry {
  const atOutlet = devices.filter((device) => device.outletId === outletId)
  const affected = atOutlet.filter(
    (device) =>
      !isCounterTelemetryFresh(device.lastSeenAt, nowMs) || device.lastReportedUnresolved > 0,
  )
  if (affected.length === 0) return { kind: 'clear' }

  const oldest = (values: (string | null)[]) =>
    values
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null
  return {
    kind: affected.some((device) => !isCounterTelemetryFresh(device.lastSeenAt, nowMs))
      ? 'out-of-touch'
      : 'unresolved',
    tabletCount: affected.length,
    unresolvedCount: affected.reduce((total, device) => total + device.lastReportedUnresolved, 0),
    reportedAt: oldest(affected.map((device) => device.lastSeenAt)),
    oldestUnresolvedAt: oldest(affected.map((device) => device.lastReportedOldestUnresolvedAt)),
  }
}
