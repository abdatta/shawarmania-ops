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

An eligible billing context SHALL retrieve a customer only by submitting the
complete phone, where an eligible billing context is an unrevoked enrolled
counter device or an active account holding a live Biller assignment. The
response SHALL contain only customer ID, canonical phone, saved billing name,
and whether that customer currently holds a membership. It SHALL NOT contain
when a membership began, who granted it, whether one was ever revoked, or any
spend, visit, outlet or bill information. No outlet role or device SHALL have a
browse, prefix, fuzzy, aggregate, or direct-table read path.

#### Scenario: Exact returning-customer lookup
- **WHEN** an eligible billing context supplies a complete phone that exists
- **THEN** the one global profile is returned, with membership as a plain yes or no, and without any bill, outlet, spend, or visit information

#### Scenario: Membership detail is asked for
- **WHEN** a billing context requests a membership's date, actor, or history
- **THEN** no such path exists and nothing beyond the current state is disclosed

#### Scenario: Prefix enumeration attempt
- **WHEN** a device supplies a prefix, wildcard, or list request
- **THEN** the request returns no directory rows and discloses no matching count

#### Scenario: Franchise Admin hand-crafts direct SELECT
- **WHEN** an FA uses their valid personal token to query the customer table
- **THEN** the database returns no customer rows

### Requirement: Super Admin access uses a separate owner boundary

An active SA SHALL be permitted to read the global customer directory through
an owner-authorized management path, and SHALL be permitted to correct a saved
name and to change a membership through that same boundary. This SHALL NOT grant
FA, Biller, Employee, or device sessions the same access.

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

#### Scenario: Outlet role calls the owner path
- **WHEN** an FA, Biller, Employee, or machine principal calls that path
- **THEN** the request is refused

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
