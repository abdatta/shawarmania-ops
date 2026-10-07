# Global Customer Identity

## Purpose

One normalized phone identifies one customer for the whole business, so a returning customer is recognised at either counter. This is the single deliberate exception to outlet scoping, and these requirements bind what the exception costs: a billing context may resolve a complete phone and nothing else, no role may enumerate the directory or read it directly, holding a customer id widens no transaction access, and the owner's read is a separate boundary from billing's. Customer identity is kept strictly apart from customer activity — there are no visit or spend aggregates to leak one outlet's trade to another.

**Eligibility narrows further when the daily billing grant exists.** Today an eligible billing context is an unrevoked enrolled device or an account holding a live Biller assignment, which is exactly the set of sessions that can ring a bill. `counter-devices-and-offline` adds the requirement of a live grant on top.

## Requirements

### Requirement: One canonical phone identifies one global customer

Every customer SHALL have one non-null canonical Indian phone that is unique
across the business. Accepted presentation variants SHALL normalize to the same
`+91` identity; incomplete or invalid input SHALL create and match nothing.

#### Scenario: Equivalent phone formats
- **WHEN** `98765 43210`, `919876543210`, and `+91-98765-43210` are normalized
- **THEN** each resolves to the same canonical phone and customer identity

#### Scenario: Invalid phone
- **WHEN** billing submits an incomplete or structurally invalid phone
- **THEN** no lookup or customer creation occurs and the form names the validation problem

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

### Requirement: Exact lookup is rate bounded without logging phone PII

The server SHALL bound repeated lookup attempts per device/caller over a rolling
window. Attempt telemetry SHALL NOT store raw or reversibly encoded phone input.

#### Scenario: Device exceeds the lookup bound
- **WHEN** one device exceeds the permitted exact lookups in the window
- **THEN** further lookups are temporarily refused without examining or exposing a customer

### Requirement: A new billing phone is created automatically and never overwrites an existing profile

The system SHALL, when an accepted order or paid command supplies a valid phone
with no match, create the global customer automatically using the optional form
name. If the phone already exists, the command SHALL reuse its ID and SHALL NOT
change saved profile values, even when the bill snapshot differs.

#### Scenario: First transaction for a phone
- **WHEN** an accepted billing command contains a valid phone not yet stored
- **THEN** one global profile is created and linked to that transaction

#### Scenario: Concurrent first use
- **WHEN** concurrent valid commands first use the same canonical phone
- **THEN** one customer row exists and both transactions reference it

#### Scenario: Existing profile has another name
- **WHEN** a transaction uses an existing phone with a different form name
- **THEN** its bill snapshots the form name while the saved global profile remains unchanged

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

### Requirement: Migration never guesses between conflicting identities

Existing rows that normalize to one phone SHALL merge only when their nonblank
profile facts are equivalent. Invalid phones or conflicting nonblank names SHALL
abort migration before destructive change, and diagnostics SHALL contain counts
but no phone numbers or names.

#### Scenario: Equivalent synthetic duplicates
- **WHEN** two outlet rows normalize to one phone and have equivalent names
- **THEN** references are rewired to one retained UUID before outlet scope is removed

#### Scenario: Conflicting duplicate
- **WHEN** two rows normalize to one phone but carry conflicting nonblank names
- **THEN** migration stops without dropping either row or printing their PII
