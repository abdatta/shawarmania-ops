## MODIFIED Requirements

### Requirement: Billing contexts lookup only by complete exact phone

> **This clause is deliberately widened by one field, and the widening is the
> only one.** The previous version disclosed customer ID, canonical phone and
> saved billing name, and said so exhaustively. Membership is added because a
> biller who cannot see it cannot act on it, which is the whole of
> `customer-membership`'s value at the counter. The cost is stated in the
> requirement below rather than left to be discovered: membership is a weak
> signal about a customer's trade, and a biller at one outlet may now infer it
> about a customer who has only ever shopped at another. The owner accepted that
> on 2026-09-18. **Nothing else about this boundary moves** — not the exactness,
> not the absence of a browse path, not the rate bound.

An eligible billing context SHALL retrieve a customer from the business-wide
directory only by submitting the complete phone, where an eligible billing
context is an unrevoked enrolled counter device or an active account holding a
live Biller assignment. The response SHALL contain only customer ID, canonical
phone, saved billing name, and whether that customer currently holds a
membership. It SHALL NOT contain when a membership began, who granted it, whether
one was ever revoked, or any spend, visit, outlet or bill information.

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
- **THEN** the one global profile is returned, with membership as a plain yes or no, and without any bill, outlet, spend, or visit information

#### Scenario: Membership detail is asked for
- **WHEN** a billing context requests a membership's date, actor, or history
- **THEN** no such path exists and nothing beyond the current state is disclosed

#### Scenario: Prefix enumeration attempt
- **WHEN** a device supplies a prefix, wildcard, or list request against the business-wide directory
- **THEN** the request returns no directory rows and discloses no matching count

#### Scenario: A partial number at the till
- **WHEN** an eligible billing context supplies four or more digits
- **THEN** at most one customer its own outlet has served is returned, with membership as a plain yes or no and a count of the others, and no customer who has only ever been served elsewhere can be returned

#### Scenario: Too few digits
- **WHEN** fewer than four digits are supplied
- **THEN** nothing is returned and nothing is asked of the directory

#### Scenario: Franchise Admin hand-crafts direct SELECT
- **WHEN** an FA uses their valid personal token to query the customer table
- **THEN** the database returns no customer rows

### Requirement: Super Admin access uses a separate owner boundary

An active SA SHALL be permitted to read the global customer directory through
an owner-authorized management path — by name or by part of a number, and as
the bounded member and regular lists `customer-membership` defines — and SHALL be permitted
to correct a saved name and to change a membership through that same boundary.

An active FA SHALL be permitted the same management path **scoped to the
customers the outlets their assignments name have served**, reading figures from
those outlets' bills alone, and SHALL be permitted to correct a name or change a
membership only for a customer served at no other outlet. The scope SHALL be
derived from the caller's own authority and never from an argument.

This SHALL NOT grant Biller, Employee, or device sessions any of this access.

A correction made here SHALL change the saved profile only. Bills and orders
SHALL continue to report the customer facts they snapshotted, and SHALL NOT be
rewritten by it.

No path SHALL be added here for deleting or merging a customer.

#### Scenario: Owner reads the directory
- **WHEN** an active SA uses the customer management read path
- **THEN** global profiles are available without exposing credentials or bypassing bill RLS

#### Scenario: Owner corrects a name
- **WHEN** an active SA corrects a customer's saved name
- **THEN** the profile changes and no historical bill or order snapshot is altered

#### Scenario: Counter role calls the management path
- **WHEN** a Biller, Employee, or machine principal calls that path
- **THEN** the request is refused

#### Scenario: FA reaches past their outlets
- **WHEN** an FA hand-crafts a read of a customer only another outlet has served, or a change to one another outlet also serves
- **THEN** the read returns nothing and the change is refused

### Requirement: Customer identity never widens transaction access

Orders, bills, payments, and histories SHALL remain governed by their own
outlet scope. Knowing or retrieving a global customer ID SHALL confer no access
to that customer's transactions at another outlet. Holding a customer's
membership state SHALL likewise confer no such access.

Customer activity SHALL remain derived from bills at read time under the
reader's own authority. No visit count, spend total, or other activity aggregate
SHALL be stored on the global customer record.

#### Scenario: Known global ID is used across the boundary
- **WHEN** an outlet session hand-crafts a bill/history request using a customer ID also used elsewhere
- **THEN** only transactions already readable at that outlet can be returned

#### Scenario: An aggregate is proposed onto the profile
- **WHEN** a customer's recent visits and spend are reported to the owner
- **THEN** they are computed from bills at that moment and the customer record carries no such column
