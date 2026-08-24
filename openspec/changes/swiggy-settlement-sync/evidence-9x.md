## 9.x live-rehearsal evidence log

### Backup of typed prod Swiggy facts (pre-handover)
- File: shawarmania-sync/test/fixtures/swiggy/private/prod-manual-ledger-swiggy-typed.json (gitignored)
- Rows: 38 day-rows across both outlets; nonzero typed figures ONLY at
  Kanchrapara: Aug 06 Rs.896/c331.52, Aug 07 Rs.586/c216.82,
  Aug 08 Rs.1172/c433.64, Aug 17 Rs.1292/c478.04. All other rows typed zero.
- sha256: 749C11C50AFF8D7125D861490B5ACA98AB35B70CBC7729D2953D5EB2B33A2FFC

### RID identity probe (live composer, 2026-08-24)
- Account owns exactly two restaurants: 1096540, 1084659.
- 1096540: four payouts in last month window (three PAID ~Rs.4050-6122 net,
  one PENDING Rs.3891.75); annexure address CENTRAL PARK, Kolkata => KALYANI.
- 1084659: zero payout records in the same window => carries no trading
  history; it is NOT the source of Kanchraparas typed Swiggy sales.
- Zomato channel-days exist for both outlets Aug 03-23, so zomato presence
  does not discriminate outlet identity here.

### Open decision blocking 9.4/9.5
Kanchrapara's typed Swiggy sales must originate from a DIFFERENT Swiggy
account (its own partner login/RID) - unreachable by this Vault session.
Proposal: map only 1096540 -> Kalyani enabled; leave Kanchrapara unmapped
(surface reads "not connected"); revisit second account as a future change.
Awaiting owner confirmation before planting mappings or writing anything.
