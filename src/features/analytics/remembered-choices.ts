import type { Session } from '@/session/session'
import { periodDays, shiftDate } from '@/domain/sales-analytics'

/**
 * Which date shortcut each Analytics page opens on, and whether its trend reads
 * as a chart, a running total or a table, remembered between visits
 * (each-analytics-page-remembers-its-range-and-view). Items and Sales keep their
 * own: one reader watches today by the hour, another the month as a table.
 *
 * Kept like the remembered outlet (`remembered-outlet.ts`): per person, so a
 * handed-over phone opens on its new reader's choice; per mode, so a demo
 * cannot reach a real session; and silent when storage refuses. Unlike the
 * outlet it is not forgotten at sign-out, because that would reach the sign-in
 * code the counter runs (design D3); the key is per person, so nothing leaks.
 */
export type RangeShortcut = '1d' | '7d' | '30d' | 'month'
export type TrendView = 'chart' | 'cumulative' | 'table'
export type AnalyticsPage = 'items' | 'sales'

const SHORTCUTS: readonly RangeShortcut[] = ['1d', '7d', '30d', 'month']
const VIEWS: readonly TrendView[] = ['chart', 'cumulative', 'table']

function keyFor(choice: 'range' | 'view', session: Session, page: AnalyticsPage): string {
  return `shawarmania.analytics-${choice}.${session.mode}.${session.userId}.${page}`
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function read<T extends string>(
  choice: 'range' | 'view',
  session: Session | undefined,
  page: AnalyticsPage,
  values: readonly T[],
): T | null {
  if (!session) return null
  try {
    const raw = store()?.getItem(keyFor(choice, session, page))
    return values.find((value) => value === raw) ?? null
  } catch {
    return null
  }
}

function write(
  choice: 'range' | 'view',
  session: Session | undefined,
  page: AnalyticsPage,
  value: string,
): void {
  if (!session) return
  try {
    store()?.setItem(keyFor(choice, session, page), value)
  } catch {
    // A refused write means the next visit opens as it always did: 7d, as a chart.
  }
}

/** The shortcut this person last chose on this page, or null for the 7d default. */
export function readRememberedRange(session: Session | undefined, page: AnalyticsPage) {
  return read('range', session, page, SHORTCUTS)
}

export function rememberRange(
  session: Session | undefined,
  page: AnalyticsPage,
  shortcut: RangeShortcut,
): void {
  write('range', session, page, shortcut)
}

/** How this person last read this page's trend, or null for the chart. */
export function readRememberedView(session: Session | undefined, page: AnalyticsPage) {
  return read('view', session, page, VIEWS)
}

export function rememberView(
  session: Session | undefined,
  page: AnalyticsPage,
  view: TrendView,
): void {
  write('view', session, page, view)
}

/** The shortcut a range is, ending on the business date `today`; null for any other range. */
export function shortcutOf(
  from: string,
  to: string,
  today: string,
  month: boolean,
): RangeShortcut | null {
  if (to !== today) return null
  if (month) return from === `${today.slice(0, 7)}-01` ? 'month' : null
  const days = periodDays(from, to)
  return days === 1 ? '1d' : days === 7 ? '7d' : days === 30 ? '30d' : null
}

/**
 * A shortcut's range on the business date `today`, as its button sets it. Where
 * Month is offered it stands in for 30d, and where it is not, 30d stands in for it.
 */
export function shortcutRange(
  shortcut: RangeShortcut,
  today: string,
  monthOffered: boolean,
): { from: string; to: string; grain: 'hour' | 'day'; month: boolean } {
  const kind =
    shortcut === 'month' && !monthOffered
      ? '30d'
      : shortcut === '30d' && monthOffered
        ? 'month'
        : shortcut
  if (kind === 'month')
    return { from: `${today.slice(0, 7)}-01`, to: today, grain: 'day', month: true }
  const days = kind === '1d' ? 1 : kind === '7d' ? 7 : 30
  return {
    from: shiftDate(today, 1 - days),
    to: today,
    grain: days === 1 ? 'hour' : 'day',
    month: false,
  }
}
