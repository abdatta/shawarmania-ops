## MODIFIED Requirements

### Requirement: Tablet management exposes operational facts without queued contents

An FA SHALL see the tablet for outlets they manage and an SA SHALL see every
tablet, each with its setup state, last seen time, last reported unsent count,
and removal. The surface SHALL NOT expose queued payload contents or customer
phone numbers.

Each tablet SHALL additionally carry **the counter it is standing at right
now**: whether a shift is open, the name of the person holding it, and when it
opened; and that shift's **bills rung, effective Cash total, effective UPI
total, open orders waiting and cash contributed to the drawer**. Every figure
SHALL be derived through the same effective-allocation boundary the drawer and
manager history read, so a tablet card and a billing screen cannot disagree.

These figures SHALL NOT depend on the outlet's `billing_live_from`. That date
governs where the ledger sources revenue, not whether a tablet is ringing bills:
an outlet trading on its tablet while its bills are still also written by hand
SHALL report the same figures as a promoted one.

The reader's authority governs the figures exactly as it governs the tablet.
A Franchise Admin SHALL receive them only for outlets they are assigned to, and
the database SHALL be what refuses a request for another outlet's — not the
surface. The operator's name is the only personal fact this surface carries;
customer names, phone numbers and bill contents SHALL remain absent.

The surface SHALL state **the moment its figures were read**, and every value it
shows SHALL come from that one read. It SHALL offer an explicit re-read, and
SHALL re-read when it is opened. It SHALL NOT subscribe, poll or run a timer:
this is an oversight screen consulted occasionally on a battery-powered phone,
not the counter itself, and the app's badge convention already forbids both.

#### Scenario: Manager checks their tablet
- **WHEN** an FA opens Tablets
- **THEN** only their outlets' tablets and non-identifying telemetry are returned

#### Scenario: Telemetry is stale
- **WHEN** the tablet has not reported since its displayed timestamp
- **THEN** the surface labels the values as last reported rather than claiming a current count

#### Scenario: The owner checks a counter from away from the outlet
- **WHEN** an SA opens Tablets while a shift is open at Kalyani
- **THEN** the card names the person holding that counter, when it opened, and that shift's bills, effective Cash and UPI totals, open orders waiting and drawer cash, alongside the moment they were read

#### Scenario: The outlet is trading on its tablet but has not been promoted
- **WHEN** a tablet rings bills at an outlet whose `billing_live_from` is unset, during the parallel run where those bills are also recorded by hand
- **THEN** the card reports that shift and its figures exactly as it would after promotion

#### Scenario: No shift is open
- **WHEN** a tablet is set up but nobody holds its counter
- **THEN** the card says so plainly and shows no shift figures, rather than showing zeroes that read as a quiet day

#### Scenario: The figures are asked for at an outlet the reader does not hold
- **WHEN** a hand-crafted request asks for another outlet's live shift or shift figures
- **THEN** the database refuses it, and refuses it whether or not the surface offered the request

#### Scenario: The reader wants the figures again
- **WHEN** the reader re-reads the surface
- **THEN** every figure and the stated reading time move together, and nothing on the card updates between reads
