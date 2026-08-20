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

A person holding the relevant authority SHALL be able to bring a period's
aggregator and supply figures into the ledger by supplying a file the operator
itself issues, without any reader running.

An accepted file SHALL be **self-sufficient**: every figure written from it SHALL
come from the file, and the ingest SHALL make no request to the operator to
complete it. This is the whole point of the path, which exists for the case where
the operator is unreachable or the reader is blocked.

The same parser SHALL serve the reader and the upload, so the recovery path is
exercised by every scheduled run rather than only when it is needed.

#### Scenario: An upload with no operator reachable

- **WHEN** a statement is supplied while the operator cannot be reached at all
- **THEN** the period's figures are written from the file alone, and nothing is left pending on a lookup

#### Scenario: The reader and the upload agree

- **WHEN** the same statement is processed by the reader and by an upload
- **THEN** both produce identical rows, because both used the same parser

### Requirement: A file is recognised by what is inside it

An uploaded file SHALL be identified by its content: the sheets it carries, or the
shape of the rows inside an archive. It SHALL NOT be identified by its filename or
its extension, because two accepted shapes share one extension and a downloaded
file is commonly renamed.

A file matching no known shape SHALL be refused with the shapes it did not match
named, and SHALL write nothing.

#### Scenario: A renamed file is still recognised

- **WHEN** a statement is supplied under a filename that says nothing about its origin
- **THEN** it is recognised from its content and processed

#### Scenario: An unrecognised file writes nothing

- **WHEN** a file matching no known shape is supplied
- **THEN** it is refused, the shapes it did not match are named, and no row is written or altered

### Requirement: An upload may carry no personal data into storage

Where an accepted file carries personal data about customers, the parser SHALL
discard it at parse time. It SHALL NOT be stored, logged or returned.

A customer identifier and a customer telephone number SHALL be treated as
personal data. Their presence in a file SHALL NOT be a reason to refuse it,
because the file is the operator's own export and the figures beside them are
needed.

#### Scenario: Customer details are dropped

- **WHEN** a file carrying a customer identifier and telephone number per row is supplied
- **THEN** the figures are written and neither the identifier nor the number is stored anywhere

### Requirement: A stored statement is reachable only from the outlets it concerns

A supplied file SHALL be retained, and SHALL be reachable only by a reader
entitled to the outlets whose figures it carries. The rule SHALL be enforced where
the file is stored rather than only by the screen that offers it, so a guessed
path is refused.

#### Scenario: A guessed path is refused

- **WHEN** a person entitled to one outlet requests a stored statement belonging to another by constructing its path directly
- **THEN** the request is refused

### Requirement: Restating a period a settlement already closed asks first

A supplied file that would replace figures a settlement had already closed SHALL
require confirmation before anything is written, and that confirmation SHALL name
the period and what would change.

Supplying the same file twice SHALL change nothing and SHALL NOT ask. The
confirmation SHALL be structured for a glance rather than written as prose:
what changes SHALL be visible without reading a paragraph.

#### Scenario: The same file twice is inert

- **WHEN** an already-processed file is supplied again
- **THEN** nothing changes and no confirmation is requested

#### Scenario: A different file for a closed period asks first

- **WHEN** a file carrying different figures for a period a settlement had closed is supplied
- **THEN** the person is asked to confirm, the period and the changing figures are named, and nothing is written until they do
