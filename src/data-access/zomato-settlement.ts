import type { Tables } from './database.types'
import type { ZomatoSettlement } from './adapters'

/**
 * A ledger day row's Zomato settlement columns, as one value or none.
 *
 * Shared by the mock and the Supabase adapter so both answer identically. The
 * columns travel in groups the database already keeps consistent — the triple is
 * all-or-nothing, the state is present exactly when the triple is, and the
 * retained figures travel with the moment they were retained — so a single null
 * check per group is the whole of the mapping and cannot disagree with what is
 * stored.
 */
export function toZomatoSettlement(row: Tables<'manual_ledger_days'>): ZomatoSettlement | null {
  if (
    row.zomato_gross_paise === null ||
    row.zomato_commission_paise === null ||
    row.zomato_net_paise === null ||
    row.zomato_settlement_state === null
  ) {
    return null
  }

  return {
    grossPaise: row.zomato_gross_paise,
    commissionPaise: row.zomato_commission_paise,
    netPaise: row.zomato_net_paise,
    // The database constrains this to the three known words. Narrowing here
    // rather than validating: a fourth would be a schema change, and pretending
    // to handle one would be pretending the check constraint might not hold.
    state: row.zomato_settlement_state as ZomatoSettlement['state'],
    supersededTyped:
      row.zomato_superseded_at === null ||
      row.zomato_typed_revenue_paise === null ||
      row.zomato_typed_commission_bp === null
        ? null
        : {
            revenuePaise: row.zomato_typed_revenue_paise,
            commissionBp: row.zomato_typed_commission_bp,
            at: row.zomato_superseded_at,
          },
    revisedFrom:
      row.zomato_revised_at === null ||
      row.zomato_provisional_gross_paise === null ||
      row.zomato_provisional_commission_paise === null ||
      row.zomato_provisional_net_paise === null
        ? null
        : {
            grossPaise: row.zomato_provisional_gross_paise,
            commissionPaise: row.zomato_provisional_commission_paise,
            netPaise: row.zomato_provisional_net_paise,
          },
    revisedAt: row.zomato_revised_at,
  }
}
