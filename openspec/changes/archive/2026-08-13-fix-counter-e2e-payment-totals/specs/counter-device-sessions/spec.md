## MODIFIED Requirements

### Requirement: Tablet management exposes operational facts without queued contents

An FA SHALL see the tablet for outlets they manage and an SA SHALL see every
tablet, each with its setup state, last seen time, last reported unsent count,
and removal. The surface SHALL NOT expose queued payload contents or customer
phone numbers.

Each tablet SHALL additionally carry only the counter status needed to manage
hardware: whether a shift is open, the name of the person holding it, and when
it opened. It SHALL NOT show bills rung, open-order counts, payment totals, or
cash contributed to the drawer. Managers read outlet-day Cash and UPI totals in
Billing History Totals and activity counts in their dedicated Billing views.

The reader's authority governs the tablet exactly as it governs its outlet. A
Franchise Admin SHALL receive it only for outlets they are assigned to, and the
database SHALL be what refuses a request for another outlet's — not the
surface. The operator's name is the only personal fact this surface carries;
customer names, phone numbers and bill contents SHALL remain absent.

The surface SHALL state **the moment its status was read**, and every value it
shows SHALL come from that one read. It SHALL offer an explicit re-read, and
SHALL re-read when it is opened. It SHALL NOT subscribe, poll or run a timer:
this is an oversight screen consulted occasionally on a battery-powered phone,
not the counter itself, and the app's badge convention already forbids both.

#### Scenario: Manager checks their tablet
- **WHEN** an FA opens Tablets
- **THEN** only their outlets' tablets and non-identifying status appear

#### Scenario: Telemetry is stale
- **WHEN** the tablet has not reported since its displayed timestamp
- **THEN** the surface labels the status as last reported rather than claiming it is current

#### Scenario: The owner checks a counter from away from the outlet
- **WHEN** an SA opens Tablets while a shift is open at Kalyani
- **THEN** the card names the person holding that counter and when it opened, without displaying bills, orders, payment totals or drawer cash

#### Scenario: No shift is open
- **WHEN** a tablet is set up but nobody holds its counter
- **THEN** the card says so plainly and shows no active-shift facts, rather than showing zeroes that read as a quiet day

#### Scenario: The status is asked for at an outlet the reader does not hold
- **WHEN** a hand-crafted request asks for another outlet's live shift status
- **THEN** the database refuses it, and refuses it whether or not the surface offered the request

#### Scenario: The reader wants the status again
- **WHEN** the reader re-reads the surface
- **THEN** every status fact and the stated reading time move together, and nothing on the card updates between reads
