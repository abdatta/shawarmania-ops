import { CloudOff, TriangleAlert } from 'lucide-react'

import { formatTime } from '@/domain'

import { useCounterState } from './use-counter-state'

/**
 * The two pieces of counter chrome: who is on shift, and where the queue is.
 *
 * Both read the billing adapter directly rather than taking props the shell
 * would have to thread. That keeps `CounterShell` mode-agnostic: it asks the
 * adapter it was given, and in real mode that adapter honestly answers "no
 * shift, nothing pending" — exactly what the header said before this change, and
 * exactly what will still be true until #10.
 */

/**
 * Who holds the counter, and since when.
 *
 * **Silent when there is no shift**, which since counter-devices-and-offline is
 * not a stylistic choice. A shift is now a fact about a *tablet*, and this
 * chrome is the Biller shell on somebody's own phone — so "No shift open" was a
 * claim about hardware this screen knows nothing about, and it appeared directly
 * above the card saying "You are on the counter" the moment a person opened one.
 * Two sentences contradicting each other a thumb's width apart is worse than one
 * sentence missing.
 */
export function ShiftStatus() {
  const { shift } = useCounterState()

  if (!shift) return null

  return (
    <span className="text-xs text-content-muted" data-testid="shift-status">
      {`${shift.billerName} · since ${formatTime(shift.openedAt)}`}
    </span>
  )
}

/**
 * The queue, as a small persistent indicator and never as a dialog — a modal in
 * front of a queue is a modal in front of a customer (docs/SCREENS.md).
 *
 * Three states, and the third is the one worth building: a count that has
 * stopped moving means the tablet has lost the shop's connection, and the person
 * standing at it should know before the end of the day rather than after it.
 */
export function SyncIndicator() {
  const { sync } = useCounterState()

  if (sync.kind === 'stalled') {
    return (
      <span
        className="flex items-center gap-1.5 text-xs font-semibold text-warning"
        data-testid="sync-indicator"
        data-sync="stalled"
      >
        <TriangleAlert aria-hidden size={14} />
        {sync.pending} waiting — not sending
      </span>
    )
  }

  if (sync.kind === 'pending') {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-content-muted"
        data-testid="sync-indicator"
        data-sync="pending"
      >
        <CloudOff aria-hidden size={14} />
        {sync.pending} pending
      </span>
    )
  }

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-content-muted"
      data-testid="sync-indicator"
      data-sync="synced"
    >
      <span aria-hidden className="size-2 rounded-full bg-success" />
      synced
    </span>
  )
}
