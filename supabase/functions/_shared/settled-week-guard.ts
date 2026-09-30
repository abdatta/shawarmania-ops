/**
 * Whether an uploaded week is one the ledger already holds settled.
 *
 * Design D5 of `zomato-upload-settles-like-the-sync`. An uploaded Zomato
 * workbook for a week the sync has already reconciled is not ingested: the
 * ingest would skip the settled days, but it would still rewrite the
 * reconciliation and insert the workbook's deductions under references the
 * sync never used, booking a cost twice. The uploader is told instead that the
 * week is settled, and whether the file agrees with the payout held.
 *
 * A disputed week that nobody has accepted is NOT settled, and the upload
 * proceeds: a dispute is exactly when a person reaches for the file, and the
 * contract already lets a later authoritative source resolve one.
 *
 * No third-party imports, so the Edge Function and a Node test share it.
 */

/** The reconciliation row this guard reads, as stored. */
export interface HeldReconciliation {
  outcome: string
  stated_payout_paise: number | string | null
  accepted_at: string | null
}

/** What the upload answers for a week it left alone. */
export interface AlreadySettled {
  already_settled: true
  cycle_start: string
  cycle_end: string
  held_payout_paise: number | null
  file_payout_paise: number | null
  agrees: boolean
}

/** The ingest's own tolerance, so "agrees" means what the gate would mean. */
const TOLERANCE_PAISE = 100

export function settledAlready(
  held: HeldReconciliation | null,
  cycle: { cycle_start: string; cycle_end: string; stated_payout_paise: number | null },
): AlreadySettled | null {
  if (!held) return null
  const settled = held.outcome === 'reconciled' || held.accepted_at !== null
  if (!settled) return null

  const heldPayout = held.stated_payout_paise === null ? null : Number(held.stated_payout_paise)
  const filePayout = cycle.stated_payout_paise
  return {
    already_settled: true,
    cycle_start: cycle.cycle_start,
    cycle_end: cycle.cycle_end,
    held_payout_paise: heldPayout,
    file_payout_paise: filePayout,
    agrees:
      heldPayout !== null &&
      filePayout !== null &&
      Math.abs(heldPayout - filePayout) <= TOLERANCE_PAISE,
  }
}

/**
 * A write-contract refusal is the uploader's to read.
 *
 * `ingest_aggregator_cycle` refuses a bad payload with SQLSTATE 22023 and a
 * forbidden outlet with 42501, each with a message naming a restaurant, an
 * outlet or a rule and never a customer. Anything else is an internal fault
 * and stays opaque.
 */
export function contractRefusal(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object') return null
  const { code, message } = cause as { code?: unknown; message?: unknown }
  if ((code === '22023' || code === '42501') && typeof message === 'string' && message) {
    return message
  }
  return null
}
