import type { Tables } from './database.types'
import type { ZomatoSettlement } from './adapters'

/**
 * Where a ledger day's Zomato figures came from, as one value or none.
 *
 * Shared by the mock and the Supabase adapter so both answer identically.
 *
 * It carries no figures. Since commission became an amount [owner, 2026-08-17] a
 * synced day and a typed day store the same two numbers in the same two columns,
 * so the only thing this has to report is which source wrote them and what they
 * moved from. Copying the live figures in here as well would create a second
 * place for them to be read from, and eventually a place for them to disagree.
 *
 * The remaining columns travel in groups the database already keeps consistent —
 * the retained figures travel with the moment they were retained, the revision
 * pre-image with the moment of revision — so a single null check per group is the
 * whole of the mapping and cannot disagree with what is stored.
 */
export function toZomatoSettlement(row: Tables<'manual_ledger_days'>): ZomatoSettlement | null {
  if (row.zomato_settlement_state === null) return null

  return {
    // The database constrains this to the three known words. Narrowing here
    // rather than validating: a fourth would be a schema change, and pretending
    // to handle one would be pretending the check constraint might not hold.
    state: row.zomato_settlement_state as ZomatoSettlement['state'],
    supersededTyped:
      row.zomato_superseded_at === null ||
      row.zomato_superseded_revenue_paise === null ||
      row.zomato_superseded_commission_paise === null
        ? null
        : {
            revenuePaise: row.zomato_superseded_revenue_paise,
            commissionPaise: row.zomato_superseded_commission_paise,
            at: row.zomato_superseded_at,
          },
    revisedFrom:
      row.zomato_revised_at === null ||
      row.zomato_provisional_revenue_paise === null ||
      row.zomato_provisional_commission_paise === null
        ? null
        : {
            revenuePaise: row.zomato_provisional_revenue_paise,
            commissionPaise: row.zomato_provisional_commission_paise,
          },
    revisedAt: row.zomato_revised_at,
  }
}
