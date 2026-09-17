# Production cutover evidence

The owner confirmed both shops physically closed for the 2026-09-18 IST
maintenance window. Production remained unchanged until the reviewed operator
was pinned at commit `ca93b39c247d96df2aa4457f6b24968922e8d626` and the
fresh read-only plan matched the restored-production digest.

The genuine Kalyani 2026-09-17 shift was still database-live before its stored
04:00 expiry. The existing `end_counter_shift` function closed it normally only
after a locked transaction rechecked zero open orders, zero pending requests,
zero reported unsent work and a stored zero report after latest server work.

## Recovery artifacts

- Full backup root:
  `C:\Users\iamro\ShawarmaniaBackups\2026-09-18-kalyani-attribution-repair-final`
- Final targeted bundle: `production-targeted-final-v3`
- Plan digest:
  `2ddd9538e42cb0141885db927d471a6d74ecc58a6654ac4622db9f954ba4b5a2`
- Before-image SHA-256:
  `69108a1995fc35bc934bf661e57c3f4147beee63403789eabbca0771d56c7e07`

The targeted bundle and generated reversal remain outside Git through
first-use and next-day acceptance.

## Atomic apply result

Exactly one production `apply` committed:

| Fact | Result |
|---|---:|
| Incident bills / target range | 37 / 990–1026 |
| Incident total | 906,000 paise |
| Incident cash / UPI | 213,000 / 693,000 paise |
| Later Kalyani bills / shifted range | 35 / 1027–1061 |
| Later Kalyani total | 753,000 paise |
| Orders / expenses moved | 39 / 5 |
| Kalyani / Kanchrapara bill counters | 1061 / 778 |
| Device outlet/name and incident shift | Kalyani / reviewed label / closed |

Every stable commercial, receipt-link, correction/allocation and command-result
hash matched the frozen plan before commit. The transaction restored and
catalog-compared every temporarily changed guard.

## Independent postflights

The operator's `verify` mode passed from a fresh process. A second direct
read-only query from another connection independently confirmed:

- all 37 incident and 35 later bills are settled and unvoided;
- Kanchrapara retains zero incident bills, orders or effective expenses;
- no reserved staging number remains and no command bill number disagrees;
- the 37 incident and 35 later public links still resolve by their bill IDs;
- the incident graph has zero payment corrections or attribution reviews;
- both counters have zero live shifts;
- exactly one active device has the reviewed Kalyani label/outlet; and
- none of the reviewed triggers remains disabled.

No rollback was invoked because the authoritative postflights agreed. The
database cutover is complete; same-session/menu verification, genuine bill
1062 and next-day reconciliation remain future acceptance checkpoints.
