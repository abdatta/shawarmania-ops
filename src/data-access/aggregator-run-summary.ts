import type {
  AggregatorRunCycleSettled,
  AggregatorRunRead,
  AggregatorRunDayFigures,
  AggregatorRunDayMovement,
  AggregatorRunSummary,
} from './adapters'
import type { Tables } from './database.types'

/**
 * Reading the summary the write contract wrote (#48).
 *
 * **One reader for the mock and the Supabase adapter, and it starts from the
 * generated schema type.** `Stored` below is literally the column's type, so a
 * migration that changed `summary` from `jsonb` to something else would fail to
 * compile here rather than at the first owner who opened the page. It is the
 * same property the mocks already have — a fixture the database could not serve
 * does not compile — carried onto the one column whose contents the schema
 * cannot describe.
 *
 * `jsonb` is where that property runs out, and this is where it is picked back
 * up: the column's *shape* is checked at runtime, once, here. Anything that is
 * not the shape below reads as null — a run whose summary cannot be trusted
 * says nothing rather than saying something wrong, and the surface already has
 * an honest way to render a run that carries no summary.
 *
 * Money stays integer paise the whole way through. Rupees are the surface's.
 */
type Stored = Tables<'aggregator_sync_runs'>['summary']

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Integer paise or nothing. A fraction here is a bug upstream, not a figure. */
function paise(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function count(value: unknown): number {
  const n = paise(value)
  return n !== null && n >= 0 ? n : 0
}

function date(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function figures(value: unknown): AggregatorRunDayFigures | null {
  const held = record(value)
  if (!held) return null
  return {
    revenuePaise: paise(held['revenue_paise']),
    commissionPaise: paise(held['commission_paise']),
    netPaise: paise(held['net_paise']),
  }
}

function day(value: unknown): AggregatorRunDayMovement | null {
  const held = record(value)
  const businessDate = date(held?.['business_date'])
  const movement = held?.['movement']
  const to = figures(held?.['to'])
  if (!businessDate || !to) return null
  if (movement !== 'first_measured' && movement !== 'revised') return null
  return { businessDate, movement, from: figures(held?.['from']), to }
}

function cycle(value: unknown): AggregatorRunCycleSettled | null {
  const held = record(value)
  const cycleStart = date(held?.['cycle_start'])
  const cycleEnd = date(held?.['cycle_end'])
  const computedPaise = paise(held?.['computed_paise'])
  if (!cycleStart || !cycleEnd || computedPaise === null) return null
  return {
    cycleStart,
    cycleEnd,
    computedPaise,
    statedPayoutPaise: paise(held?.['stated_payout_paise']),
  }
}

function read(value: unknown): AggregatorRunRead | null {
  const held = record(value)
  const from = date(held?.['from'])
  const to = date(held?.['to'])
  const days = paise(held?.['days'])
  if (!from || !to || days === null || days <= 0) return null
  return { from, to, days }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Null in, null out — and that is a sentence the surface says out loud. A run
 * recorded before summaries were carries none, which is not the same as a run
 * that changed nothing; that one carries a summary with nothing in it.
 */
export function parseRunSummary(stored: Stored): AggregatorRunSummary | null {
  const held = record(stored)
  if (!held) return null

  const supply = record(held['supply_orders'])
  return {
    read: read(held['read']),
    days: list(held['days'])
      .map(day)
      .filter((entry): entry is AggregatorRunDayMovement => entry !== null),
    cyclesSettled: list(held['cycles_settled'])
      .map(cycle)
      .filter((entry): entry is AggregatorRunCycleSettled => entry !== null),
    supplyOrders: {
      added: count(supply?.['added']),
      amended: count(supply?.['amended']),
    },
    datesWithoutARecordedDay: list(held['dates_without_a_recorded_day'])
      .map(date)
      .filter((entry): entry is string => entry !== null),
  }
}

/** Whether a summary says anything moved at all. */
export function summaryMoved(summary: AggregatorRunSummary | null): boolean {
  if (!summary) return false
  return (
    summary.days.length > 0 ||
    summary.cyclesSettled.length > 0 ||
    summary.supplyOrders.added > 0 ||
    summary.supplyOrders.amended > 0
  )
}
