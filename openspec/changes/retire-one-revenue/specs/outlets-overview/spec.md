## MODIFIED Requirements

### Requirement: Today's revenue names the sale in progress

Today's revenue SHALL show, beside its headline and after a separating dot, the total of the outlet's open, unpaid orders of its current
business date as the server resolves it, in integer paise summed by the server
and shown in exact rupees without compact notation, smaller than the headline
and in the size, weight and colour of the tender figures beneath. Where the cell
cannot hold both figures beside the tile's icon, the figure SHALL drop to half
the headline's size, and then the icon SHALL be left out, before either figure
is cut or wrapped. The figure SHALL carry
no label or icon of its own, SHALL be absent while the total is zero, and SHALL NOT be added
to revenue: paid orders still being prepared are already revenue and SHALL NOT be
counted in it, nor cancelled orders, nor open orders of an earlier business date.
It SHALL arrive in the same read as the tile's other figures, so the card makes
no further request.

#### Scenario: Orders are being made
- **WHEN** today's revenue is ₹35,630 and today has two open, unpaid orders of ₹840 and ₹400
- **THEN** the tile reads ₹35,630 · ₹1,240, the second figure smaller and muted, with no label

#### Scenario: A paid order is still cooking
- **WHEN** an order was paid ₹300 and is not yet prepared
- **THEN** its ₹300 is in today's revenue and not in the figure beside it

#### Scenario: Nothing is open
- **WHEN** today has no open, unpaid order
- **THEN** the tile shows its headline alone, with no dot and no ₹0

#### Scenario: A large amount in progress
- **WHEN** open orders come to ₹12,340
- **THEN** the figure reads ₹12,340, not ₹12.3k
