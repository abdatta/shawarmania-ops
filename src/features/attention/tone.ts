/**
 * How loudly money owed asks in Overview's Needs attention (owner, 2026-10-20):
 * amber while it is still the days it is normally paid in, red once it is late.
 * Overview alone, where it must stand apart from the approvals beside it; once
 * on a page, a badge and an overdue line read as every other alert does, in the
 * app's own badge and amber (owner, the same day).
 */
export type AttentionTone = 'warning' | 'danger'

/** A row or a line: a tint and a hairline in the tone. */
export const TONE_SURFACE: Record<AttentionTone, string> = {
  warning: 'bg-warning/10 ring-1 ring-inset ring-warning/40',
  danger: 'bg-danger/10 ring-1 ring-inset ring-danger/40',
}

/** An icon's chip beside a toned line. */
export const TONE_ICON: Record<AttentionTone, string> = {
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
}
