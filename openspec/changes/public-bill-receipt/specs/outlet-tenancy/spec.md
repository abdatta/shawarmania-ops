## ADDED Requirements

### Requirement: The public receipt reader grants the anonymous role nothing

The anonymous database role SHALL gain no new read access to any table as a
consequence of public receipts. No policy SHALL be added that permits an
anonymous session to select a bill, a bill line, a payment allocation, a discount
record or a public link record by token or by any other means.

A public receipt SHALL be reachable only through a single `security definer`
function, and that function SHALL be the only privileged entry point the public
reader may call.

The credential the public reader uses to call it SHALL be held server-side and
SHALL NOT reach any browser.

#### Scenario: An anonymous session reads a bill directly

- **WHEN** an anonymous session issues a hand-crafted request against bills, bill
  lines, payments, discounts or link records
- **THEN** it is refused, whether or not it holds a valid receipt token

### Requirement: The public reader reaches one bill and nothing adjacent

The public receipt function SHALL accept a token and nothing else. It SHALL NOT
accept an outlet, a bill identifier, a bill number, a date or a range, and SHALL
NOT expose a listing, a count, an aggregate, or any bill other than the one its
token names.

It SHALL refuse a revoked token, and SHALL return the same refusal for a token
that resolves to no bill.

Because its only input names one bill, the function SHALL NOT resolve an outlet,
and the outlet boundary SHALL therefore be unreachable through it.

#### Scenario: Attempting to widen the public reader

- **WHEN** a caller attempts to obtain more than one bill, or a bill other than the
  one their token names, through the public function
- **THEN** no argument or call permits it

#### Scenario: The link table is outlet-scoped like every other

- **WHEN** a Franchise Admin, Biller or Employee session issues a hand-crafted
  request against another outlet's public link records
- **THEN** it is refused, as for every other outlet-scoped table
