/**
 * How loudly money owed asks in Overview's Needs attention (owner, 2026-10-20):
 * `due` in amber while it is still the days it is normally paid in, `late` in
 * the app's own orange once it is late. Both warm and in the theme; red was
 * refused as out of it. Overview alone, where it must stand apart from the
 * approvals beside it; once on a page, a badge and an overdue line read as every
 * other alert does (owner, the same day).
 */
export type AttentionTone = 'due' | 'late'

/** A row or a line: a tint and a hairline in the tone. */
export const TONE_SURFACE: Record<AttentionTone, string> = {
  due: 'bg-warning/10 ring-1 ring-inset ring-warning/40',
  late: 'bg-primary/15 ring-1 ring-inset ring-primary/60',
}

/** An icon's chip beside a toned line. */
export const TONE_ICON: Record<AttentionTone, string> = {
  due: 'bg-warning/15 text-warning',
  late: 'bg-primary/20 text-accent-text',
}
