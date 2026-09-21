## ADDED Requirements

### Requirement: Tablet management is read one outlet at a time

> **This reverses a decision taken on 2026-08-09 and is written as a requirement
> rather than left as the absence of one.** Tablets read several outlets at once
> from `attendance-one-day-per-person` until now, so that "is every counter
> healthy?" could be asked of the whole business at once. Two things ended that.
> `multiple-billing-devices` (#35) made an outlet hold several tablets, so the
> surface became outlet-then-tills-then-outlet-then-tills and the reader had to
> scroll to the question they came with. And the business is converging on one
> outlet, after which further outlets are expected to be franchise-owned — so
> nobody is asking the cross-business question this answered. What made the
> reversal cheap is that the conditions it was watched for are already reported
> per outlet on the Outlets surface (#51), and switching outlets here is one tap.
> The owner decided this on 2026-09-20.

Tablet management SHALL be scoped to **one outlet at a time** for a reader who
may see more than one. Its outlet control SHALL replace the chosen outlet rather
than add to a selection, and the outlet currently being read SHALL NOT be
clearable. A reader who may see one outlet SHALL be offered no control, exactly
as before.

The surface SHALL list every tablet at the chosen outlet and no other outlet's,
and SHALL say by name when the chosen outlet has none.

The chosen outlet's name SHALL NOT be repeated as a heading above that outlet's
tablets, because the control naming it is on the same screen. A statement about
an outlet having **no** tablet SHALL still name the outlet within its own
sentence, since that is the sentence somebody acts on.

Where the surface is opened at an address naming one outlet, it SHALL open on
that outlet. The address SHALL remain a starting position and SHALL confer
nothing: the reader may still change outlet, and the database SHALL remain what
decides which tablets they receive.

A tablet moved to another outlet SHALL leave the list, because it is no longer at
the outlet being read. The surface SHALL NOT follow it to its new outlet, since
the reader chose the outlet they are reading and a move SHALL NOT silently choose
another for them. The confirmation that precedes the move SHALL be what states
the destination.

Narrowing this surface SHALL NOT narrow a wider outlet selection held by a
surface that reads several outlets at once.

#### Scenario: The owner opens Tablets holding two outlets
- **WHEN** a Super Admin who may see two outlets opens Tablets
- **THEN** one outlet's tablets are listed, the other outlet's are absent, and no outlet name is printed as a heading above the list

#### Scenario: The reader switches outlet
- **WHEN** the reader taps the outlet they are not reading
- **THEN** the list is replaced by that outlet's tablets rather than showing both outlets' tablets together

#### Scenario: The outlet being read cannot be cleared
- **WHEN** the reader taps the outlet they are already reading
- **THEN** nothing is cleared and the surface continues to read that outlet

#### Scenario: A manager with one outlet
- **WHEN** a Franchise Admin holding one assignment opens Tablets
- **THEN** their outlet's tablets are listed with no outlet control offered at all

#### Scenario: The chosen outlet has no tablet
- **WHEN** the chosen outlet has no active tablet
- **THEN** the surface says so naming that outlet, and offers to set one up there

#### Scenario: A tablet is moved to the other outlet
- **WHEN** an SA confirms a move of a tablet from the outlet being read to another outlet
- **THEN** that tablet leaves the list, the surface continues reading the outlet the reader chose, and the destination was stated in the confirmation before the move

#### Scenario: Arriving from an outlet's card
- **WHEN** Tablets is opened from an outlet card's button, which addresses one outlet
- **THEN** it opens reading that outlet, and the reader may still switch to another they may see

#### Scenario: A wider selection elsewhere survives
- **WHEN** a reader selects two outlets on a surface that reads several at once, then opens Tablets, then returns to that surface
- **THEN** that surface is still about both outlets
