/**
 * The one health record a Hyperpure statement reader may write.
 *
 * Hyperpure is a supply channel, so it never crosses the payout-cycle ingest
 * boundary. It still needs an honest health line: a failed statement read must
 * not look like a quiet day. This parser keeps that smaller write constrained to
 * an allowlisted outlet and the outcomes a supplier reader can truthfully make.
 */

import { emptySummary, readRunOrigin, type RunOrigin, type RunSummary } from './run-summary.ts'

export const HYPERPURE_RUN_OUTCOMES = ['ok', 'session_lapsed', 'shape_changed'] as const

export type HyperpureRunOutcome = (typeof HYPERPURE_RUN_OUTCOMES)[number]

export interface HyperpureRunRecord {
  outletId: string
  startedAt: string
  outcome: HyperpureRunOutcome
  detail: string | null
  /** How the run began, or null where the reader did not say (#48). */
  startedBy: RunOrigin | null
  /** What the statement read moved, from the ingest that moved it. */
  summary: RunSummary
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function parseHyperpureRunRecord(
  body: Record<string, unknown>,
  permittedOutlets: readonly string[],
): { value: HyperpureRunRecord } | { error: string } {
  const outletId = text(body['outlet_id'])
  if (!outletId || !permittedOutlets.includes(outletId)) {
    return { error: 'outlet_not_permitted' }
  }

  const startedAt = text(body['started_at'])
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) {
    return { error: 'started_at_required' }
  }

  const outcome = text(body['outcome'])
  if (!outcome || !HYPERPURE_RUN_OUTCOMES.includes(outcome as HyperpureRunOutcome)) {
    return { error: 'unknown_outcome' }
  }

  // Two constrained words or nothing. An unknown one is refused rather than
  // stored, for the same reason the cycle boundary refuses it.
  const startedBy = body['started_by'] === undefined ? null : readRunOrigin(body['started_by'])
  if (body['started_by'] !== undefined && startedBy === null) {
    return { error: 'unknown_started_by' }
  }

  /*
   * What the read moved, as `ingest_supply_statement` reported it.
   *
   * Only the counts are taken. The reader posts the ingest's own answer back
   * here; anything else in the body is ignored, so a caller cannot invent
   * movements the ledger never saw.
   */
  const summary = emptySummary()
  const supply = (body['supply_orders'] ?? {}) as Record<string, unknown>
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
  summary.supply_orders = { added: count(supply['added']), amended: count(supply['amended']) }

  return {
    value: {
      outletId,
      startedAt,
      outcome: outcome as HyperpureRunOutcome,
      detail: text(body['detail']),
      startedBy,
      summary,
    },
  }
}
