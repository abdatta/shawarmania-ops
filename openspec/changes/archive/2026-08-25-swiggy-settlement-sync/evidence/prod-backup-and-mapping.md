# Production backup & mapping decision (pre-backfill)

> **Correction record (2026-08-24):** an earlier version of this note attributed
> the typed nonzero Swiggy figures to Kanchrapara and mapped RID 1096540 there.
> That was a misreading of the backup dump; the database join below is
> authoritative. The mapping row was updated in place the same day. The specs'
> original naming — active **Kalyani**, unserved Kanchrapara — stands.

## Typed Swiggy data backup (2026-08-24)
- File: shawarmania-sync/test/fixtures/swiggy/private/prod-manual-ledger-swiggy-typed.json (gitignored)
- Rows: 38 recorded day-rows (19 per outlet); typed-nonzero: **4, all Kalyani**
  - 2026-08-06 ₹896.00 / 08-07 ₹586.00 / 08-08 ₹1,172.00 / 08-17 ₹1,292.00 revenue
- Verified against prod by joined aggregate before this note was written:
  - Kalyani `4d4fe480…`: 19 ledger rows, sum(swiggy_revenue_paise) = 394600
  - Kanchrapara `7c173db5…`: 19 ledger rows, sum = 0
- sha256: 749C11C50AFF8D7125D861490B5ACA98AB35B70CBC7729D2953D5EB2B33A2FFC

## Served-outlet determination (live portal + prod, 2026-08-24)
- RID **1096540**: 8 payout cycles since July, ₹36,666 net total, one PENDING → actively trading
- RID **1084659**: zero payouts ever → the dormant Kalyani identity the proposal describes
- Typed nonzero figures sit only at Kalyani ⇒ served outlet = **Kalyani = 1096540**
- Kanchrapara is NOT served by Swiggy: no mapping row exists for it, so it reads
  not connected rather than zero trade

## Mapping planted on production
- outlet_channel_restaurants: (Kalyani `4d4fe480…`, swiggy, `1096540`, enabled) — the only swiggy row
- No row for dormant `1084659` or for Kanchrapara: neither produces runs, figures or synthetic zeroes
