/**
 * What a run changed, and how it began.
 *
 * Both are posted or produced at the boundary and stored on the run's row, and
 * both are constrained here rather than believed. The vocabulary is two words
 * wide on purpose: a run began because the schedule said so, or because the
 * owner asked. Nothing else is a thing that can happen, and free text crossing
 * this boundary would end up rendered to the owner unread by anybody.
 *
 * The summary itself is produced by the write contract, inside the transaction
 * that wrote the figures — see `20260831000001_a_run_says_what_moved.sql` for
 * why it cannot be derived afterwards. This module only carries it: one run may
 * ingest several cycles, and the run's row holds one summary, so the per-cycle
 * summaries are merged in the order the cycles were ingested.
 */

/** How a run began. Posted by the process that ran it, never inferred. */
export const RUN_ORIGINS = ['schedule', 'owner'] as const

export type RunOrigin = (typeof RUN_ORIGINS)[number]

export function readRunOrigin(value: unknown): RunOrigin | null {
  return typeof value === 'string' && (RUN_ORIGINS as readonly string[]).includes(value)
    ? (value as RunOrigin)
    : null
}

export interface RunDayFigures {
  revenue_paise: number | null
  commission_paise: number | null
  net_paise: number | null
}

export interface RunDayMovement {
  business_date: string
  movement: 'first_measured' | 'revised'
  /** Null for a first measurement: there was no figure to come from. */
  from: RunDayFigures | null
  to: RunDayFigures
}

export interface RunCycleSettled {
  cycle_start: string
  cycle_end: string
  operator_cycle_ref: string | null
  computed_paise: number
  stated_payout_paise: number | null
}

export interface RunSummary {
  version: 1
  days: RunDayMovement[]
  cycles_settled: RunCycleSettled[]
  supply_orders: { added: number; amended: number }
  /** Business dates whose figures were written with no recorded day to sit on. */
  dates_without_a_recorded_day: string[]
}

/**
 * A run that changed nothing.
 *
 * Not null — null on the column means "recorded before #48", which is a
 * different sentence and the surface says it differently. A run that ran and
 * moved nothing says so.
 */
export function emptySummary(): RunSummary {
  return {
    version: 1,
    days: [],
    cycles_settled: [],
    supply_orders: { added: 0, amended: 0 },
    dates_without_a_recorded_day: [],
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * One run's summary from the cycles it ingested.
 *
 * Anything that is not the shape this contract describes is dropped rather than
 * carried through: the column is read by a surface that renders it as prose,
 * and a half-shaped object there is a sentence nobody can act on.
 */
export function mergeSummaries(results: readonly unknown[]): RunSummary {
  const merged = emptySummary()
  const dates = new Set<string>()

  for (const result of results) {
    const summary = (result as { summary?: unknown } | null)?.summary
    if (!summary || typeof summary !== 'object') continue
    const part = summary as Record<string, unknown>

    merged.days.push(...(asArray(part['days']) as RunDayMovement[]))
    merged.cycles_settled.push(...(asArray(part['cycles_settled']) as RunCycleSettled[]))

    const supply = part['supply_orders'] as Record<string, unknown> | undefined
    merged.supply_orders.added += asCount(supply?.['added'])
    merged.supply_orders.amended += asCount(supply?.['amended'])

    for (const date of asArray(part['dates_without_a_recorded_day'])) {
      if (typeof date === 'string') dates.add(date)
    }
  }

  merged.dates_without_a_recorded_day = [...dates].sort()
  return merged
}
