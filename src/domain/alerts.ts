/**
 * The alert lifecycle. Pure, no I/O.
 *
 * An alert is a small thing — a subject, a message, a priority and a thread —
 * and the only part of it worth defending is its **sequence**. An alert that
 * could jump from open to closed would demonstrate a product with no
 * acknowledgement step, which is precisely the step that tells a manager
 * somebody has seen what they raised.
 *
 * Kept as literal unions because the domain layer imports from nothing;
 * `fixtures.test-d.ts` proves they still match the database's `alert_status`
 * and `alert_priority` enums, so a schema change breaks the build rather than
 * the state machine.
 */

export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'closed'

export type AlertPriority = 'low' | 'normal' | 'high' | 'urgent'

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  closed: 'Closed',
}

/**
 * Where each status may go next.
 *
 * Forward one step at a time, with reopening allowed from anything that is not
 * finished. **`closed` is terminal**: it is the one status that says nobody is
 * coming back to this, and a closed alert that could be reopened would make
 * that promise worthless.
 */
const TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  open: ['acknowledged'],
  acknowledged: ['resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: [],
}

export function nextStatuses(from: AlertStatus): readonly AlertStatus[] {
  return TRANSITIONS[from]
}

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Most urgent first. Used for sorting, never for colour alone. */
export const ALERT_PRIORITY_ORDER: readonly AlertPriority[] = ['urgent', 'high', 'normal', 'low']

/**
 * How far up the inbox an alert belongs. Lower sorts first.
 *
 * Status outranks priority: a resolved urgent alert needs less from the owner
 * than an open normal one, because the open one has not been read yet. Within a
 * status, priority decides.
 */
export function alertAttentionRank(alert: {
  status: AlertStatus
  priority: AlertPriority
}): number {
  const statusRank: Record<AlertStatus, number> = {
    open: 0,
    acknowledged: 1,
    resolved: 2,
    closed: 3,
  }
  return statusRank[alert.status] * 10 + ALERT_PRIORITY_ORDER.indexOf(alert.priority)
}
