import type { Tables } from './database.types'
import type { ZomatoSettlement } from './adapters'

/**
 * A measured day, as the ledger reads one.
 *
 * Shared by the mock and the Supabase adapter so both answer identically.
 *
 * It now carries the figures, and that is a reversal worth explaining. While
 * these lived on the day row there were already two numbers in scope wherever
 * this was used, so copying them in here would have created a second place to
 * read them from and eventually a place for them to disagree. They live on their
 * own row now, which a caller holding a day row does not have, so this is the
 * only place they come from rather than a duplicate of somewhere else.
 *
 * The remaining columns travel in groups the database keeps consistent: a
 * retained figure with the moment it was retained, a revision pre-image with the
 * moment of revision. So one null check per group is the whole of the mapping and
 * cannot disagree with what is stored.
 */
export function toZomatoSettlement(
  row: Tables<'aggregator_channel_days'> | null | undefined,
): ZomatoSettlement | null {
  if (!row) return null

  return {
    revenuePaise: row.revenue_paise,

    // Null is UNDETERMINED and travels as null the whole way to the screen.
    // Coalescing it to nought here would state that the channel kept nothing,
    // which is the one wrong answer that looks like a figure.
    commissionPaise: row.commission_paise,

    // The database constrains both of these to their known words. Narrowing
    // rather than validating: a fourth value would be a schema change, and
    // pretending to handle one would pretend the check constraint might not hold.
    state: row.settlement_state as ZomatoSettlement['state'],
    origin: row.origin as ZomatoSettlement['origin'],

    supersededTyped:
      row.superseded_at === null || row.superseded_revenue_paise === null
        ? null
        : {
            revenuePaise: row.superseded_revenue_paise,
            commissionPaise: row.superseded_commission_paise,
            at: row.superseded_at,
          },
    revisedFrom:
      row.revised_at === null || row.provisional_revenue_paise === null
        ? null
        : {
            revenuePaise: row.provisional_revenue_paise,
            commissionPaise: row.provisional_commission_paise,
          },
    revisedAt: row.revised_at,

    // `aggregator-figures` asks a reading to name its as-of time, and
    // `as_of_at` is the column named for it. **It is null on every production
    // row**, including ones the reader wrote minutes ago: the live runner does
    // not send it in its payload, so the column the schema comment describes
    // has never actually been filled. Shipping the stamp against it alone put
    // a chip on the demo and nothing on the real screen, which the mock could
    // not catch because the mock seeds the column.
    //
    // `updated_at` is the honest stand-in. The ingest upserts every day it
    // covers whether or not the figures moved, so this advances on each run
    // that re-read the day — which is exactly *last confirmed*. A settled day
    // is skipped by that loop and keeps the moment its settlement wrote it,
    // which is also right: nothing has re-read it since.
    asOfAt: row.as_of_at ?? row.updated_at,
  }
}
