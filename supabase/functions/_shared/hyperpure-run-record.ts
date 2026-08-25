/**
 * The one health record a Hyperpure statement reader may write.
 *
 * Hyperpure is a supply channel, so it never crosses the payout-cycle ingest
 * boundary. It still needs an honest health line: a failed statement read must
 * not look like a quiet day. This parser keeps that smaller write constrained to
 * an allowlisted outlet and the outcomes a supplier reader can truthfully make.
 */

export const HYPERPURE_RUN_OUTCOMES = ['ok', 'session_lapsed', 'shape_changed'] as const

export type HyperpureRunOutcome = (typeof HYPERPURE_RUN_OUTCOMES)[number]

export interface HyperpureRunRecord {
  outletId: string
  startedAt: string
  outcome: HyperpureRunOutcome
  detail: string | null
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

  return {
    value: {
      outletId,
      startedAt,
      outcome: outcome as HyperpureRunOutcome,
      detail: text(body['detail']),
    },
  }
}
