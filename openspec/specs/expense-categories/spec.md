# Expense Categories

## Purpose

The words the business groups its spending by. A category is free text that the business **grows from use**: the first time somebody types one while recording an expense it joins a business-wide suggestion list, and from the next entry onward it is offered at every outlet. The rule that gives this capability its weight is that every expense stores its category as **text it owns**, never as a reference to the live list, so editing or retiring a suggestion cannot silently restate a month that has already been read. Rewriting history is possible, but only as a deliberate owner act that records what it moved.

## Requirements

### Requirement: An expense category is free text that the business grows from use

An expense category SHALL be free text rather than a value chosen from a fixed
list. The first time a category is typed it SHALL be recorded in a business-wide
suggestion list, and from the next entry onward it SHALL be offered as a
suggestion at every outlet.

The suggestion list SHALL NOT be scoped to an outlet, because a category names a
kind of cost rather than a property of a shop. A manager opening a new outlet
SHALL therefore inherit every category the business already uses rather than
beginning with an empty list.

Any account that may record an expense SHALL be able to create a category by
typing one, because the person holding the receipt is the person who knows what
was bought. Creating a category SHALL be a consequence of recording an expense
and SHALL NOT be a separate act.

A category SHALL be refused when blank or whitespace-only, by the database and
not only by the form, under the same rule every other required field in the app
follows.

#### Scenario: A new category joins the list

- **WHEN** an expense is recorded with a category that is not yet in the suggestion list
- **THEN** the expense is stored with that category and the word is offered as a suggestion from the next entry onward

#### Scenario: A category typed at one outlet is offered at the other

- **WHEN** a category is created while recording an expense at one outlet
- **THEN** it is offered as a suggestion when recording an expense at every other outlet

#### Scenario: A blank category is refused

- **WHEN** an expense with a missing, blank or whitespace-only category is submitted, including by a hand-crafted request
- **THEN** the database refuses the write and no expense row is created

#### Scenario: A new outlet inherits the existing list

- **WHEN** an outlet is created after categories already exist
- **THEN** recording its first expense offers every existing category as a suggestion

### Requirement: Categories are matched without regard to case or spacing, and stored as typed

A category SHALL be normalised before it is stored and before it is matched:
leading and trailing whitespace removed, and internal runs of whitespace
collapsed to a single space. The database SHALL refuse a category that is not
already normalised, so that the form and the database cannot disagree.

Matching a typed category against the suggestion list SHALL be
case-insensitive, so that a category differing from an existing one only in
capitalisation SHALL resolve to that existing entry rather than creating a
second one.

Capitalisation SHALL be preserved exactly as first typed rather than folded to a
single case, because a category is frequently a proper noun and rewriting it
would misrepresent what the person entered.

#### Scenario: Case does not create a duplicate

- **WHEN** an expense is recorded with a category differing from an existing suggestion only in capitalisation
- **THEN** it resolves to the existing entry and no second suggestion is created

#### Scenario: Surrounding and repeated spacing is removed

- **WHEN** a category is typed with leading, trailing or repeated internal whitespace
- **THEN** it is stored normalised, and matches an existing entry that differs only by that whitespace

#### Scenario: Capitalisation as typed survives

- **WHEN** a category is created with mixed capitalisation
- **THEN** it is stored and displayed exactly as typed, and is not folded to upper or lower case

#### Scenario: An unnormalised category is refused

- **WHEN** a category carrying untrimmed or repeated whitespace is submitted by a hand-crafted request
- **THEN** the database refuses the write

### Requirement: An expense stores its category as text, so editing the list never rewrites history

Each expense SHALL store its category as the text that was recorded, and SHALL
NOT reference the suggestion list by key. The suggestion list SHALL serve
suggestion and curation only, and no stored expense SHALL change because an
entry in it changed.

This follows the rule already governing bill line items, which snapshot the item
name and unit price at the moment of sale so that a later change to the live list
cannot silently rewrite a historical figure.

Retiring a category SHALL remove it from suggestions and SHALL change no stored
expense row.

#### Scenario: Renaming a suggestion leaves recorded expenses alone

- **WHEN** a category in the suggestion list is renamed without a retroactive rewrite being requested
- **THEN** every expense already recorded keeps the text it was stored with, and only expenses recorded afterwards carry the new text

#### Scenario: Retiring a category preserves its history

- **WHEN** a category is retired from the suggestion list
- **THEN** it is no longer offered when recording an expense, and every expense already carrying it is unchanged and still appears under it in a month's breakdown

#### Scenario: A stale suggestion list still records a valid expense

- **WHEN** an expense is recorded with a category that has since been retired from the suggestion list
- **THEN** the expense is stored with that text and is not refused

### Requirement: The owner may rewrite history deliberately, and each rewrite is recorded

An account holding a live Super Admin assignment SHALL be able to rename a
category across every expense already recorded, and to merge one category into
another. Both operations SHALL apply to every expense record the category
appears in, and SHALL be applied in one transaction so that a partial rewrite
cannot be observed or left behind.

No other role SHALL be able to perform either operation, and the database SHALL
refuse it rather than the interface hiding it.

Each rename and each merge SHALL record exactly one entry stating the operation,
the text before, the text after, how many expense rows moved in each record,
when it happened, and which account performed it. That entry SHALL survive the
merge that produced it, including when one of the two categories is removed by
it.

Before either operation is performed the surface SHALL state how many expense
rows it is about to change. Neither operation SHALL be reversible from the
interface.

Retiring a category SHALL NOT be recorded this way, because it changes no
expense row.

#### Scenario: A retroactive rename moves every recorded expense

- **WHEN** the owner renames a category and asks for the change to apply to history
- **THEN** every expense carrying the old text carries the new text afterwards, in every expense record, and a month's breakdown totals under the new name

#### Scenario: Two spellings are merged into one

- **WHEN** the owner merges one category into another
- **THEN** every expense carrying the merged-away category carries the surviving one, the merged-away entry is gone from the suggestion list, and the two former totals appear as one in every month they both appeared in

#### Scenario: The rewrite says what it did

- **WHEN** a rename or a merge completes
- **THEN** one entry records the operation, the text before and after, the row count moved in each expense record, the moment, and the account, and it remains readable after the merged-away category no longer exists

#### Scenario: The row count is stated before anything moves

- **WHEN** the owner confirms a rename or a merge
- **THEN** the number of expense rows about to change is shown before the operation runs

#### Scenario: A non-owner is refused by the database

- **WHEN** an account without a live Super Admin assignment attempts a rename or a merge, including by a hand-crafted request
- **THEN** the database refuses it and no expense row and no suggestion changes

#### Scenario: A failed rewrite leaves nothing half-done

- **WHEN** a rename or a merge fails partway through
- **THEN** no expense row and no suggestion list entry has changed

### Requirement: A category may be reserved, and a reserved category refuses what merely resembles it

A category SHALL be capable of being marked **reserved**, meaning an origin other
than a person owns every row that carries it. A reserved category SHALL be
refused to a person recording an expense, by the database and not only by the
form.

The refusal SHALL extend to a name that merely resembles the reserved one. Case,
spacing and the near-match rules the surface already uses to suggest an existing
category SHALL all be applied to the refusal, so that a second spelling cannot be
used to record by hand what the reserved category exists to keep out. A reserved
category is the one place where the free-text rule's usual defence, that a
refusal is defeated by a different spelling, is not acceptable: the whole purpose
of reserving it is that no hand-typed row may carry that cost.

The refusal SHALL name the origin that owns the category and SHALL say how a
figure reaches the ledger instead, because a person refused without being told
where the number goes will find somewhere worse to put it.

#### Scenario: A reserved category is refused

- **WHEN** a person records an expense under a reserved category
- **THEN** the entry is refused, the owning origin is named, and the person is told how such a cost reaches the ledger instead

#### Scenario: A near-spelling is refused too

- **WHEN** a person records an expense under a name that differs from a reserved category only by case, spacing or a near-match the surface would have suggested
- **THEN** it is refused identically, rather than accepted as a new free-text category

#### Scenario: The refusal holds against a hand-crafted request

- **WHEN** a hand-crafted request submits an expense carrying a reserved category with no origin attached
- **THEN** the database refuses it

#### Scenario: An origin may write its own reserved category

- **WHEN** the owning origin writes a row carrying its reserved category
- **THEN** the write succeeds

### Requirement: A category that would double-count a figure is warned against, not refused

A category naming aggregator commission, cash banked or an owner drawing SHALL
be warned against rather than refused. Each of those is accounted for elsewhere,
so recording one as an expense would count it twice. The warning SHALL state
where the figure belongs instead, and SHALL still accept the entry.

The warning SHALL be dismissable and SHALL NOT block recording, because such a
category is free text and a refusal is defeated by a different spelling, which
the month would then count with nothing to warn about.

This SHALL be understood as a weaker guarantee than a closed list gave. The
system SHALL NOT claim that such a category cannot exist.

A **reserved** category SHALL be treated differently and SHALL be refused, under
the reservation rule above. The distinction is deliberate: a warned category
names a figure recorded elsewhere in the same ledger, where a determined person
typing a second spelling merely mis-files their own record; a reserved category
names a cost that arrives from an origin of its own, where a second spelling
creates a duplicate of money that is already accounted for.

#### Scenario: A commission category is warned against

- **WHEN** a category matching aggregator commission is typed
- **THEN** a dismissable warning explains that commission is netted from aggregator revenue, and the entry is still accepted

#### Scenario: A drawer movement is warned against

- **WHEN** a category matching cash banked or an owner drawing is typed
- **THEN** a dismissable warning explains that cash taken from the drawer is recorded on the day rather than as an expense, and the entry is still accepted

#### Scenario: The warning does not block

- **WHEN** the person recording the expense dismisses the warning and submits
- **THEN** the expense is recorded with that category

#### Scenario: A reserved category is not merely warned against

- **WHEN** a category that is reserved rather than warned is typed
- **THEN** it is refused rather than warned about, and no dismissal accepts it
