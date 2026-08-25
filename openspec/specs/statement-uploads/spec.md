# Statement Uploads

## Purpose

A hand-driven recovery path: a person with the relevant authority brings a period's
aggregator and supply figures into the ledger by supplying a file the operator
itself issues, without any reader running. The path exists for when the operator is
unreachable or the reader is blocked, so an accepted file is self-sufficient,
recognised by its content, stripped of personal data, stored under outlet isolation,
and made to ask before restating a period a settlement already closed.

## Requirements

### Requirement: A period can be recovered by hand from an operator-issued file

A Super Admin SHALL be able to bring a period's aggregator and supply figures
into the ledger by supplying a file the operator itself issues, without any
reader running.

Every figure written from an accepted file SHALL come from that file, and the
ingest SHALL make no request to the operator to complete it. Different official
files MAY establish different facts: a Swiggy business-metrics XLSX establishes
portal-calendar Net Sales evidence; a Swiggy payout-annexure XLSX establishes
its contained order and cycle facts; and a deterministic payment-advice PDF
establishes only the restaurant, portal-declared cycle and final payout facts it
actually contains. Portal-calendar evidence SHALL become an authoritative
business-date figure only when the file provides order timestamps or its
reporting window is proved to align with the outlet cutover.

A cycle-only PDF SHALL settle or verify a cycle only when the already stored
order/day evidence is sufficient to reconcile that exact final payout. It SHALL
NOT invent, allocate or fetch missing daily gross, order payout or undated
deductions. A tax invoice alone SHALL NOT be treated as proof of the full payout
unless its verified content actually states every required reconciliation fact.

API and file readers SHALL normalize equivalent source facts into the same
ingest contract and produce identical records from the same facts. They need not
parse the same transport representation.

#### Scenario: A daily report never bypasses the cutover

- **WHEN** a recognized Swiggy business-metrics XLSX contains only
  midnight-to-midnight Net Sales for an outlet whose cutover is 04:00
- **THEN** its portal-date evidence is parsed and reported but is not written as
  an authoritative ledger business date, and no gross, commission or net is
  invented

#### Scenario: An annexure recovers the full payout cycle

- **WHEN** a recognized Swiggy payout-annexure XLSX contains the required
  restaurant, order, timestamp, gross, payout, deduction, cycle and
  final-payout facts
- **THEN** it follows the same cutover and reconciliation contract as automation
  and can settle the cycle with no operator request

#### Scenario: A payment advice cannot invent days

- **WHEN** a recognized payment-advice PDF states an exact final payout but the
  stored cycle lacks sufficient order/day evidence to reconcile it
- **THEN** the upload is refused as cycle-only evidence and no daily or cycle
  value changes

#### Scenario: An upload with no operator reachable

- **WHEN** a recognized self-sufficient Swiggy annexure is supplied while the
  operator cannot be reached
- **THEN** every accepted order, day and cycle fact comes from that file and no
  portal request is made

#### Scenario: The reader and the upload agree

- **WHEN** API data and an uploaded file establish equivalent normalized source
  facts
- **THEN** both produce identical persisted rows through the same ingest contract

#### Scenario: API and upload facts agree

- **WHEN** API data and an uploaded file establish the same normalized Swiggy
  order and cycle facts
- **THEN** both produce identical ledger, deduction and reconciliation records

### Requirement: A file is recognised by what is inside it

An uploaded file SHALL be identified by validated MIME bytes and its internal
content: workbook sheet/row signatures, archive entries or deterministic PDF
text and field labels. It SHALL NOT be identified by filename, extension or a
claimed content type.

Accepted Swiggy shapes SHALL be limited to real, redacted fixtures proved from
the portal: Business Metrics Report XLSX, payout-annexure XLSX, and any payment
advice or other PDF whose stable fields are separately fixture-tested. A
scanned, password-protected, malformed, oversized or unknown-layout file SHALL
be refused, shall name the unsupported shape or condition and SHALL write
nothing. OCR SHALL NOT run.

#### Scenario: A renamed file is still recognised

- **WHEN** a verified Swiggy workbook or PDF is supplied under an unrelated
  filename or extension
- **THEN** its bytes and internal fields identify it and it is processed
  according to that verified shape

#### Scenario: A PDF with insufficient or unknown content writes nothing

- **WHEN** a PDF is scanned, malformed or does not match a fixture-proved
  Swiggy payment shape
- **THEN** it is refused with a useful reason and no row or stored evidence is
  written

#### Scenario: A forged extension is refused

- **WHEN** arbitrary bytes are named with an accepted spreadsheet or PDF
  extension
- **THEN** content validation refuses them and nothing changes

#### Scenario: An unrecognised file writes nothing

- **WHEN** a file matches none of the fixture-proved workbook, archive or PDF
  shapes
- **THEN** it is refused with the attempted shapes named and no row or evidence
  object is written

### Requirement: An upload may carry no personal data into storage

Where an accepted file carries personal data about customers, the parser SHALL
discard it before any normalized record, retained evidence, log or response is
created. A customer identifier, telephone number, name and address SHALL be
treated as personal data.

An external order reference MAY survive only as a non-reversible digest or
opaque idempotency value where replay safety requires it; it SHALL NOT be
displayed or reversible to a customer. Personal data's presence in an operator
export SHALL NOT itself be a reason to refuse the financial rows.

#### Scenario: Customer details are dropped

- **WHEN** a Swiggy order-level file carries customer identifiers, telephone
  numbers, names or addresses
- **THEN** the financial facts can be written but none of those customer details
  is stored, logged, returned or retained in evidence

#### Scenario: Replay does not require a customer identifier

- **WHEN** an order reference is needed to make a repeated upload idempotent
- **THEN** the system retains only a non-reversible or opaque replay value and
  exposes no customer identity

### Requirement: A stored statement is reachable only from the outlets it concerns

For an accepted upload, the system SHALL retain a content digest, parse metadata
and a PII-free evidence representation sufficient to audit what was accepted.
The raw original SHALL NOT be retained when it contains customer personal data.

Retained evidence SHALL be stored beneath every concerned outlet and channel's
private boundary and SHALL be reachable only to the Super Admin authority
entitled to those financial records. The storage rule SHALL enforce this reach
so a guessed path, cross-outlet request or client-supplied path cannot bypass it.

#### Scenario: A guessed path is refused

- **WHEN** a person entitled to one outlet requests a stored statement belonging to another by constructing its path directly
- **THEN** the request is refused

#### Scenario: Raw PII is absent from retained evidence

- **WHEN** an accepted statement contained customer personal data
- **THEN** its retained evidence can prove the parsed financial facts and digest
  but contains none of the raw personal fields

### Requirement: Restating a period a settlement already closed asks first

A supplied file that would replace daily figures or a cycle a final settlement
already closed SHALL require Super Admin confirmation before anything is
written, and that confirmation SHALL name the channel, outlet, period, source
kind, current values, proposed values and differences.

Supplying content with an already accepted digest or equivalent normalized facts
SHALL change nothing and SHALL NOT ask. Confirmation SHALL be structured for a
glance rather than written as prose. A confirmation token SHALL bind to the file
digest and computed proposal so a changed file cannot reuse it.

#### Scenario: The same file twice is inert

- **WHEN** an already processed Swiggy file is supplied again
- **THEN** nothing changes and no confirmation is requested

#### Scenario: A different file for a closed period asks first

- **WHEN** a file carries different figures for a final cycle or settled date
- **THEN** the owner sees the channel, outlet, period and before/after
  differences, and nothing is written until they confirm that exact digest and
  proposal

#### Scenario: A changed file cannot reuse confirmation

- **WHEN** a file or its normalized proposal changes after confirmation was
  issued
- **THEN** the old confirmation is refused and no record changes
