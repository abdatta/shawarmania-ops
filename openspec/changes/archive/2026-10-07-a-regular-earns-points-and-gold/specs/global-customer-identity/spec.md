## MODIFIED Requirements

### Requirement: Billing contexts lookup only by complete exact phone

> **This clause has been widened twice, each time by what the counter must act
> on, and each widening is stated with its cost.** #57 added membership, because
> a biller who cannot see it cannot act on it. `a-regular-earns-points-and-gold`
> (#62) made that membership the **caller's own outlet's**, and added that
> outlet's **points balance** and whether the customer is **eligible for gold
> there**, because the biller uses the one and offers the other. The eligibility
> flag discloses that a customer has spent at least the outlet's threshold there
> recently, and nothing more; that is its whole purpose, and the owner accepted it
> on 2026-09-28. #57's stated cost, a biller inferring membership granted at an
> outlet the customer never visited here, **no longer exists**: membership is now
> the caller's outlet's. **Nothing else about this boundary moves**: not the
> exactness, not the absence of a browse path, not the rate bound.

An eligible billing context SHALL retrieve a customer from the business-wide
directory only by submitting the complete phone, where an eligible billing
context is an unrevoked enrolled counter device or an active account holding a
live Biller assignment. The response SHALL contain only customer ID, canonical
phone, saved billing name, and, **for the caller's own outlet, taken from the
caller's authority and never from an argument**: whether the customer is a member
there, their points balance there (none when that outlet has points off), and
whether they are eligible for gold there. It SHALL NOT contain when a membership
began or ends, who granted it, whether one was ever revoked, anything about any
other outlet, or any spend, visit or bill information.

**One narrower path exists, and its scope is the whole of its safety.** An
eligible billing context MAY submit four or more digits of a number and receive
at most **one** customer — the one its own outlet served most recently among
those whose number begins with those digits — together with a count of the
others and nothing about them. It SHALL reach only customers who appear on the
caller's own outlet's orders or bills, the outlet SHALL be taken from the
caller's own authority and never from an argument, and it SHALL carry the same
fields and the same exclusions as the complete-phone lookup. It shares that
lookup's rate bound.

> Stated here by `a-gold-member-is-a-label` (#57) rather than by the change that
> built it. `a-customer-is-a-phone-number` (#56) shipped
> `customer_suggest_at_outlet` and left this requirement saying no outlet role
> could have any prefix path at all. The objection to a prefix search was always
> the business-wide directory — one franchise's till reading another's customers
> — and an outlet scope removes exactly that, leaving only people this counter
> already served.

No outlet role or device SHALL have a browse, prefix, fuzzy, aggregate, or
direct-table read path over the business-wide directory.

#### Scenario: Exact returning-customer lookup
- **WHEN** an eligible billing context supplies a complete phone that exists
- **THEN** the one global profile is returned, with membership, balance and eligibility at the caller's outlet, and without any bill, spend, visit or other-outlet information

#### Scenario: Membership detail is asked for
- **WHEN** a billing context requests a membership's dates, actor, or history
- **THEN** no such path exists and nothing beyond the current state is disclosed

#### Scenario: Another outlet's standing
- **WHEN** an eligible billing context looks up a customer who is a member and holds points only at another outlet
- **THEN** the response reports no membership, no balance and no eligibility earned there

#### Scenario: Prefix enumeration attempt
- **WHEN** a device supplies a prefix, wildcard, or list request against the business-wide directory
- **THEN** the request returns no directory rows and discloses no matching count

#### Scenario: A partial number at the till
- **WHEN** an eligible billing context supplies four or more digits
- **THEN** at most one customer its own outlet has served is returned, with the same three outlet fields and a count of the others, and no customer who has only ever been served elsewhere can be returned

#### Scenario: Too few digits
- **WHEN** fewer than four digits are supplied
- **THEN** nothing is returned and nothing is asked of the directory

#### Scenario: Franchise Admin hand-crafts direct SELECT
- **WHEN** an FA uses their valid personal token to query the customer table
- **THEN** the database returns no customer rows
