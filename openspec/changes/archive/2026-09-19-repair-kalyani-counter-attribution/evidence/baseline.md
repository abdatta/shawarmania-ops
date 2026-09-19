# Frozen incident baseline

Owner decision recorded on 2026-09-17 after the 04:00 Asia/Kolkata cutover:
the Kanchrapara-enrolled tablet was physically used at Kalyani for business
date **2026-09-16**. All trade from the identified tablet and shift on that
business date, including the five expenses recorded by the same operator,
belongs to Kalyani. The two reviewed menu aliases are approved. The existing
tablet is to continue at Kalyani without setup.

The selection is always the literal business date `2026-09-16`; it is never
derived from `today`, the host timezone, or the time at which the repair runs.

## Aggregate fingerprint

| Fact | Frozen value |
|---|---:|
| Source bill numbers | 742–778 |
| Settled bills | 37 |
| Bill total | 906,000 paise |
| Cash | 213,000 paise |
| UPI | 693,000 paise |
| Bill items | 43 |
| Payment allocations | 41 |
| Orders | 39 |
| Paid / cancelled orders | 37 / 2 |
| Order items | 45 |
| Billing commands | 115 |
| Expenses | 5 |
| Expense total | 38,000 paise |
| Earlier Kanchrapara bills | 741 |
| Kanchrapara high-water mark | 778 |
| Kalyani high-water before later trade | 989 |
| Kalyani incident-date bills before repair | 0 |
| Later Kalyani bill numbers / count | 990–1024 / 35 |
| Later Kalyani total | 753,000 paise |
| Later items / payments / public links | 40 / 37 / 35 |
| Later payment corrections / allocations | 1 / 1 |
| Later bill-bearing commands | 36 |
| Final pre-repair Kalyani high-water | 1024 |
| Incident target bill numbers | 990–1026 |
| Shifted later Kalyani bill numbers | 1027–1061 |
| Final repaired Kalyani high-water / next bill | 1061 / 1062 |

When work resumed, normal Kalyani trade had legitimately issued bills 990–1024.
No incident row had moved. The owner chose to preserve the original incident
placement at 990–1026 and shift that complete later block upward to 1027–1061.
The operator binds both opaque-ID mappings and the entire later dependency graph
to its plan digest and targeted recovery bundle. It refuses any count, status,
void, money, correction, command or counter drift and never voids or recreates
an existing bill.

UTC-normalized SHA-256 row-set fingerprints from the production snapshot:

- Bills: `898143662612cdd36470f85e58b631ed3918db149e5e009d3fd0e892bb04828d`
- Orders: `3f09277442d426560d2204388ee80047b510b47aa13d5edddc854ef962a8a869`
- Expenses: `c35e555e3489d25cc95240283ff39ddc66c6b14a1f6f43e3b369d60219d336a2`

The operator has active Biller assignments at both outlets. The tablet is
proven, not removed, last reported zero unresolved work, and the incident shift
is expired but not yet explicitly ended. No opaque identifier, customer fact,
employee identity, public-receipt token, or credential is recorded here.

## Approved menu aliases

| Kanchrapara snapshot | Kalyani menu item | Unit price |
|---|---|---:|
| Classic Chicken Shawarma [S] | Classic Chicken Shawarma [SAAJ] | 11,000 paise |
| Chicken Shawarma Salad | Shawarma Salad | 20,000 paise |

The other eleven products on settled bills are exact name-and-price matches.
The cancelled-order graph adds `Double Chicken Shawarma [T]` at 17,000 paise,
also an exact Kalyani match, so the repair requires 14 menu mappings in total.
