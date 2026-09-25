## ADDED Requirements

### Requirement: A ledger reading completes or says it could not

A day or month reading SHALL be presented only when every source it is derived
from was read successfully. Where any source fails to read, the reading SHALL
NOT be presented in part, and the surface SHALL say that the period could not be
read. A failed read SHALL NOT render as nought, as an absent section, or as a
drawer state it did not establish.

A read the reader has moved away from SHALL be cancelled, and its cancellation
SHALL NOT be reported as a failure.

A message that a period could not be read SHALL belong to that period, and SHALL
be withdrawn when the reader moves to another date, month, view or outlet.

#### Scenario: One source fails

- **WHEN** a day's aggregator figures fail to read while its bills and expenses succeed
- **THEN** the day is not shown with its channels missing, and the surface says the day could not be read

#### Scenario: A failure does not outlive its period

- **WHEN** a month fails to read and the reader steps to another month that reads successfully
- **THEN** the second month is shown with no failure message

#### Scenario: Stepping past a month mid-read

- **WHEN** the reader steps from one month to another before the first has finished reading
- **THEN** the first month's reads are cancelled and no failure is reported for it

### Requirement: A reading is shown only for the outlet and period on screen

The surface SHALL present a reading only when its outlet, and its date or month,
are the ones currently chosen. A reading for another outlet or another period
SHALL NOT be shown while the chosen one is being read, including a reading that
arrives late from an earlier choice.

#### Scenario: Switching outlet mid-read

- **WHEN** the reader switches from one outlet to another on the same date
- **THEN** the first outlet's figures are not shown under the second while the second is read

#### Scenario: Verifying and then stepping away

- **WHEN** a day is verified and the reader steps to another date before the reload finishes
- **THEN** the other date's reading is shown and the verified day's reload does not replace it

### Requirement: The chosen period survives an outlet switch

Switching outlet SHALL keep the chosen date and the chosen month. Where the chosen
date or month is later than the new outlet's own today, it SHALL be brought back
to that today; it SHALL NOT otherwise be changed.

#### Scenario: Reading an old month at two outlets

- **WHEN** the reader is on June's month at one outlet and switches outlet
- **THEN** June's month is read at the new outlet

#### Scenario: Reading a past day at two outlets

- **WHEN** the reader is on 12 September at one outlet and switches outlet
- **THEN** 12 September is read at the new outlet

### Requirement: A ledger reading costs a bounded number of round trips

A day SHALL be read in at most two sequential round trips to the server, and a
month in at most two, with the number of requests a month makes independent of
how many dates it holds. No stored day or month row SHALL be introduced to meet
this: the month SHALL remain derived on read from the same sources as its days.

The month and each of its days SHALL agree: every figure the month derives from a
date SHALL equal the figure that date's own reading derives, to the paisa.

The server reads that serve this SHALL admit exactly the readers the drawer
admits, and SHALL refuse any other reader rather than answering with an empty
period.

#### Scenario: A month on a slow connection

- **WHEN** every request to the server takes 250 ms
- **THEN** a month settles in under three round trips' time, and a day likewise

#### Scenario: A month agrees with its days

- **WHEN** a month is read and each of its dates is read as a day
- **THEN** cash, UPI, discount, every channel figure, every expense line and the drawer's state agree for every date

#### Scenario: Another outlet's month is refused, not emptied

- **WHEN** a Franchise Admin asks the server for the month of an outlet they are not assigned to
- **THEN** the request is refused, rather than answered with a month of no sales
