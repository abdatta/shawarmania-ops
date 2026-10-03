## ADDED Requirements

### Requirement: A receipt link carries its token after a question mark

Every receipt link the app hands out SHALL take the form
`<receipt base>/bill?t=<token>`, so that everything before the `?` is identical for
every bill and the token is the only part that varies. In production that prefix is
`https://shawarmania.in/bill?`, the address registered with the telecom operator as
the sender's dynamic call-to-action URL, against which an SMS carrying the link is
validated.

The token SHALL be the link's only query parameter as handed out. A surface MAY
add a parameter of its own when it opens the link, such as the counter asking for
its view, and SHALL keep `t` unchanged when it does.

The receipt SHALL be served at that address, its counter view at the same address
with `view=counter`, and its PDF from an address of its own.

A request to `/bill` whose `t` is absent, empty, repeated or not of the token's
shape SHALL receive the same refusal as a token that resolves to no bill.

A request to `/bill/<token>` for a token of the right shape SHALL be redirected to
`/bill?t=<token>`, keeping any other query parameter, before any lookup is made, so
that the redirect discloses nothing about whether the bill exists.

#### Scenario: A link is handed out

- **WHEN** a bill's receipt link is sent, opened or viewed from the app
- **THEN** it reads `https://shawarmania.in/bill?t=<token>`, and opens that bill's
  receipt

#### Scenario: The counter views a receipt

- **WHEN** the counter opens a receipt in its own view
- **THEN** the address carries `t` and `view=counter`, and the counter view is
  served

#### Scenario: A link with its token mangled

- **WHEN** `/bill` is requested with no `t`, an empty `t`, two `t` parameters, or a
  `t` that is not a token's shape
- **THEN** the refusal is identical to the refusal for an unknown token

#### Scenario: A link in the old shape

- **WHEN** `/bill/<token>?view=counter` is requested
- **THEN** it redirects to `/bill?t=<token>&view=counter`, whether or not the token
  names a bill

#### Scenario: A filled-in receipt message

- **WHEN** the receipt message is filled with a ten-character token and a
  four-digit balance
- **THEN** it fits one 160-character GSM-7 SMS segment
