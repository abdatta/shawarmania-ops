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

/**
 * Whether the caller said anything at all about how the run began.
 *
 * **Absent and null mean the same thing here, deliberately.** The runner omits
 * the key when it has no trigger context — run from a laptop, say — and the
 * honest reading of that is "it did not say", which renders as a blank origin.
 * Treating an explicit null as a *wrong* answer instead would turn a serialiser
 * that writes nulls for undefined into a boundary that 400s every run and stops
 * the sync recording itself at all: the exact silence this record exists to end.
 */
export function saidHowItBegan(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * The most reads a day anybody could plausibly have scheduled.
 *
 * Every five minutes. Past that the runner has misparsed its own cron, and a
 * wrong cadence is worse than none: the surface would tell the owner the sync
 * runs 1,440 times a day and quietly derive a nonsense lockout from it. The
 * column's check constraint holds the same ceiling.
 */
export const MAX_READS_PER_DAY = 288

/**
 * How often the runner says it is scheduled, or null where it did not say.
 *
 * Not believed blindly: the runner parses its own workflow cron, and a parse is
 * a thing that can go wrong. A value outside the sane range is dropped rather
 * than stored, so the surface falls back to its own constant instead of
 * repeating a number nobody could have meant.
 */
export function readReadsPerDay(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value > 0 && value <= MAX_READS_PER_DAY ? value : null
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

/** The window of business days a run considered, or null if it read none. */
export interface RunRead {
  from: string
  to: string
  days: number
}

export interface RunSummary {
  version: 1
  /**
   * What the run LOOKED AT, as against what it changed.
   *
   * Without it "nothing moved" is a shrug: a run that considered seven days and
   * found none of them changed has said something, and one that reached no data
   * at all has said something else. The payload is gone by the time anybody
   * asks, so the window is recorded with the rest.
   */
  read: RunRead | null
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
    read: null,
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

    // One run may ingest several cycles, so the window it considered spans all
    // of them: the earliest day any cycle reached to the latest, and the days
    // added up. Cycles for one outlet and channel do not overlap.
    const read = part['read'] as Record<string, unknown> | null | undefined
    if (read && typeof read['from'] === 'string' && typeof read['to'] === 'string') {
      const from = merged.read && merged.read.from < read['from'] ? merged.read.from : read['from']
      const to = merged.read && merged.read.to > read['to'] ? merged.read.to : read['to']
      merged.read = { from, to, days: (merged.read?.days ?? 0) + asCount(read['days']) }
    }

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
