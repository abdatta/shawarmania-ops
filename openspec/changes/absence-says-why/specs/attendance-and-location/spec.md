## ADDED Requirements

### Requirement: An absent day states why it is absent

A day reading absent SHALL state its cause in plain language on every surface
that renders it — the manager's day, the person view and the employee's own
history — stating the same facts on each, because a verdict somebody may dispute
is not reviewable from the word alone.

The cause SHALL be addressed to whoever is reading it. Where the reader is the
person the day belongs to, it SHALL speak to them directly; where the reader is
the manager who made the decision, it SHALL name them as the actor in the second
person. Where the reader is neither, it SHALL use neither — a reader MUST NEVER
be told they failed to check in on a day that is not theirs, or that a decision
was theirs when it was not. Both SHALL be resolved from the reader's own
identity against the day's subject and the decision's actor, never from a
per-surface setting.

The cause SHALL be revealed when the day is expanded and SHALL NOT occupy the
collapsed headline, so a roll-call stays scannable. A day whose only content is
its cause SHALL therefore be expandable, which the two other derived
readings — not yet arrived, and working at another outlet — SHALL NOT be, having
nothing to state.

The cause SHALL be stated in as few words as carry the fact. It SHALL NOT name
the business date or the person, both of which the card's own heading already
gives, and SHALL NOT restate the verdict above it.

Where a manager's decision made the day absent, the cause SHALL name that
manager and present the reason they recorded. It SHALL distinguish a denied
check-in from a corrected outcome by stating what the day counted as before the
correction, rather than by wording alone, so the two are not two similar
sentences the reader has to weigh.

**The cause SHALL be the decision that made the day absent, not the most recent
decision on it.** A decision that only opens or closes the door to another
check-in records `absent` as its new status while deciding nothing about the
outcome, and SHALL NOT displace the denial or correction that did — a reader
asking why a day is absent must not be answered with the fact that a manager
kept it absent. Such adjustments SHALL remain visible in the day's history.

Where no attendance row exists at all, the cause SHALL name the arrival deadline
that was missed, rather than reporting that a deadline passed without saying
which. Where the person's outlets in the reader's scope set different deadlines,
it SHALL name the latest of them, being the deadline whose passing decided the
absence for that reader. Two readers of differing scope MAY therefore be shown
different times for one day, and each SHALL be the time that justified the
verdict they are looking at.

Where the row is absent and no manager decision accounts for it, the cause SHALL
say exactly that, and SHALL NOT distinguish a row carrying no decision from one
carrying only a migrated placeholder — they differ in where the row came from and
not at all in what the reader is being told.

The cause SHALL be derived from the stored row and the outlet's clock at read
time. Nothing SHALL be written to record it, and no fact SHALL be disclosed to
one reader that the other cannot see.

#### Scenario: A denied day names the manager and their reason

- **WHEN** a manager or the employee themselves expands a day whose check-in was
  denied
- **THEN** it states that the named manager denied the check-in, and shows the
  reason the manager recorded

#### Scenario: A corrected day says what it was before

- **WHEN** either reader expands a day an authorised manager corrected to absent
  from another outcome
- **THEN** it names the manager, states what the day counted as before the
  correction, and shows their recorded reason

#### Scenario: A re-affirmed absence does not claim to have changed

- **WHEN** either reader expands a day a manager corrected while it was already
  absent
- **THEN** it states that the manager reviewed the day and kept it absent,
  rather than naming a previous outcome identical to the current one

#### Scenario: An absence no decision accounts for says so

- **WHEN** either reader expands an absent day carrying no manager decision, or
  only the placeholder a migration wrote for a day recorded before decisions
  were kept
- **THEN** both read the same sentence, stating that no manager decision on
  record explains it, and neither names an actor the row does not hold

#### Scenario: A deadline-derived absence names the deadline

- **WHEN** either reader expands a day with no attendance row whose arrival
  deadline has passed
- **THEN** it names the time that deadline fell at, and no outlet, arrival time or
  evidence is invented for it

#### Scenario: A person staffed at two outlets is judged by the later deadline

- **WHEN** the owner, who sees both outlets, reads an absent day for somebody
  assigned to outlets closing arrivals at 13:00 and 20:00
- **THEN** the cause names 20:00, the deadline whose passing decided the absence

#### Scenario: A narrower reader is shown the deadline that decided what they see

- **WHEN** an admin who may see only the 13:00 outlet reads that same day
- **THEN** the cause names 13:00, matching the scope the absent verdict itself was
  derived from, and no deadline is quoted from an outlet the reader cannot see

#### Scenario: Closing a retry does not become the reason

- **WHEN** a manager denies a check-in, leaves retry open, and later prevents
  another check-in on the same still-absent day
- **THEN** the cause still names the denial and its reason, and the retry being
  closed appears in the day's history rather than as the explanation

#### Scenario: The employee reads the same cause as their manager

- **WHEN** the same absent day is read from the manager's roll-call and from the
  employee's own history
- **THEN** both state the same cause, the employee's addressed to them and the
  manager's not, with no fact present in one and absent from the other

#### Scenario: A manager reads their own decision back

- **WHEN** the manager who denied or corrected a day expands it on the roll-call
- **THEN** the cause names them in the second person rather than repeating their
  own name at them

#### Scenario: A manager is never told they were the absent one

- **WHEN** a manager expands an absent day belonging to somebody else
- **THEN** nothing in the cause addresses the manager as the person who failed to
  check in

#### Scenario: A day with nothing to state stays a headline

- **WHEN** either reader looks at a day reading not yet arrived or working at
  another outlet
- **THEN** the verdict is on the face of the row and there is nothing to expand
