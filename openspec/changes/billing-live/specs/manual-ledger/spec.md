## MODIFIED Requirements

### Requirement: A live outlet's cash and UPI revenue comes from bills, while its aggregator revenue stays typed

Each outlet SHALL carry an explicit **billing go-live date**, null until that
outlet is promoted and set by a Super Admin. It SHALL NOT be derived from billing
data: shadow smoke-test bills are rung before any customer money, so a derived
boundary would move itself onto a day whose revenue was already typed by hand.
Setting it to a business date that has already started SHALL be refused, because a
day that begins hand-typed and ends sourced from bills is counted twice.

From that date, the manual ledger SHALL source that outlet's **cash and UPI**
revenue from paid bills rather than from a typed figure, SHALL state on screen
that each figure came from the counter, and SHALL NOT offer a second field
inviting the same money to be entered again.

**Zomato and Swiggy revenue SHALL remain typed, at every outlet, on every
business date, whether or not that outlet is live.** V1 billing accepts Cash and
UPI only, so an aggregator order is never rung at the counter and there are no
bills to source that figure from. Removing those fields on go-live would delete
the only record of that trade. Each aggregator group SHALL keep its stated
revenue field, its per-day commission rate and its computed net exactly as the
capability already defines them, and a live outlet's day SHALL read as two
figures from the counter beside two entered by hand, each labelled for what it
is.

Every other part of the ledger SHALL keep working by hand until #12 and #13
retire it: aggregator commission, cash in and out, expenses, and the counted
drawer. A business date before that outlet went live SHALL keep its typed figure
exactly as recorded.

Sourcing aggregator revenue from bills SHALL NOT be added by a later change
without also deciding what happens to the commission rate stored on the same
day, because a day holding a rate and no stated revenue computes a net from
nothing.

#### Scenario: Go-live is set mid-trade
- **WHEN** a Super Admin tries to set an outlet's go-live date to a business date that outlet is already trading
- **THEN** it is refused, naming the next date that has not started, so no day is ever part typed and part billed

#### Scenario: Shadow tests before go-live
- **WHEN** test bills are rung at an outlet before its go-live date is set
- **THEN** the ledger keeps reading that outlet's typed cash and UPI revenue for those dates, because the boundary is the recorded date and not the presence of bills

#### Scenario: The night an outlet goes live
- **WHEN** the owner opens the ledger for a live outlet's business date
- **THEN** cash and UPI revenue are shown as coming from the counter and are not editable there, while Zomato and Swiggy revenue, both commission rates, the cash movements, the expenses and the drawer count are entered as before

#### Scenario: Aggregator revenue survives the handover
- **WHEN** the owner records a live outlet's day
- **THEN** the Zomato and Swiggy groups are present with their stated revenue fields, their per-day rates and their computed net, and the day is storable with aggregator revenue and no typed cash or UPI figure

#### Scenario: An earlier month is reopened
- **WHEN** the owner opens a business date from before that outlet went live
- **THEN** every typed revenue figure is unchanged and still editable, including cash and UPI

#### Scenario: The other outlet is not live yet
- **WHEN** one outlet is live and the other is not
- **THEN** the live outlet's cash and UPI come from bills and the other outlet's are still entered by hand, each labelled for what it is, while both outlets type their aggregator revenue

#### Scenario: The same money cannot be counted twice
- **WHEN** a live outlet's day is read in the month view
- **THEN** cash and UPI revenue each appear exactly once, whatever was previously typed for that outlet on that date, and the month's aggregator figures are the typed ones netted by each day's own stored rate
