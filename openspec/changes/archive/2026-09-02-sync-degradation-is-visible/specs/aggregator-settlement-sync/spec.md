# Delta: aggregator-settlement-sync

## ADDED Requirements

### Requirement: A run that wrote part of what it read is recorded once, as both

A run that obtained some of the data it went for and not the rest SHALL be
recorded as **one run** carrying both facts: the figures it moved, and the reason
it fell short. It SHALL NOT be recorded as a success, and its writes SHALL NOT be
discarded because it fell short.

The reason SHALL be named with the same vocabulary a wholly failed run uses,
because a partial failure needs the same person a total one does. **Completeness
SHALL be read from what the run recorded as moved** — a degraded run that moved
nothing and one that moved six weeks are distinguished by that record, not by a
separate word. Money in that record SHALL be integer paise.

Where a run both falls short of its read and fails on its writes, the recorded
reason SHALL be the one naming the more specific fault, and the other SHALL NOT
be silently dropped from what the run says about itself.

A caller declaring success alongside figures SHALL be treated as a caller
declaring nothing: a run SHALL NOT be able to assert that it succeeded.

#### Scenario: A settled week survives an unreadable open week

- **WHEN** a run reads six settled weeks, cannot read the open one, and posts both
  the six weeks and the reason the seventh failed
- **THEN** the six weeks are written, and the history shows one run stating what
  those weeks moved and why the open week is missing

#### Scenario: A partial run is not a success

- **WHEN** the owner looks at a channel whose last run wrote figures and fell
  short
- **THEN** the surface does not report that channel as healthy

#### Scenario: Money that does not add up outranks a short read

- **WHEN** a run posts a declared shortfall and one of its cycles also fails to
  reconcile against the stated payout
- **THEN** the run is recorded as a reconciliation failure and the shortfall is
  still readable in what the run says about itself

## MODIFIED Requirements

### Requirement: The owner has one surface listing what the sync changed, in which a row is a run

The owner SHALL have a single surface reporting the sync's activity, in two
sections: what needs them, and what has happened. **That surface SHALL serve
every restaurant channel through one navigation entry**, with the channel chosen
on the surface itself; the sections, the vocabulary and the history below are the
same questions asked of each channel's own reader.

**What needs them** SHALL list only unresolved matters — a lapsed session, a
disputed week, a possible duplicate expense — and SHALL be presented expanded
with the actions available on each. A matter resolved by a later run SHALL leave
this section. The surface SHALL state when the sync last ran and whether it
succeeded.

**A channel that has stopped running SHALL read as stopped, and SHALL NOT read as
its last success.** Where the time since a channel's last run exceeds its own
reported cadence by a stated margin, the surface SHALL present that channel as at
fault, name that a read was due and did not happen, and offer the read it is
already able to offer. The margin SHALL be derived from the cadence the runner
reports rather than from a constant in this repository, so that it moves when the
schedule moves.

This SHALL be evaluated at read time. A channel that has stopped running cannot
record that it has, because the process that would record it is the process that
is missing; nothing SHALL be relied upon to write that fact.

A channel that has never run, one not switched on for the outlet, one with a run
under way, and one whose last run recorded a failure SHALL each keep the more
specific statement, because each names its state more precisely than being
overdue does.

**What has happened SHALL be a history of runs, newest first, and it SHALL list
every run.** A row SHALL be a run: one the owner asked for and one that ran to
schedule, one that succeeded and one that failed, one that moved figures and one
that moved nothing, one that has finished and one still under way. A rehearsal
SHALL NOT appear, because it writes nothing and therefore reports nothing about
the figures.

**A failure SHALL remain readable after it is healed.** A later successful run
SHALL end a matter in *what needs them* and SHALL NOT remove, hide or amend any
run already recorded, so that an outage repaired at noon is still legible from
its first failure onward.

A run that moved figures SHALL state what moved in rupees, naming the business
day, the week or the supply orders affected, and where it replaced a figure SHALL
state what that figure changed from as well as what it changed to. A run that
moved nothing SHALL say so in one line. A failed run SHALL say why, in the same
vocabulary offered to the owner as an action. A run under way SHALL read as under
way.

**What a run changed SHALL be determined by the write itself** — inside the
transaction that performs the writes, while both the stored figure and the
incoming one are still known — and SHALL be carried onto the run's record. It
SHALL NOT be derived from stored figures after that transaction has committed.
Once a write commits, a figure restated identically is indistinguishable from a
figure touched, so a summary derived later cannot tell movement from repetition.
Money in that record SHALL be integer paise. Determining the summary SHALL NOT
alter any figure the run writes.

**A run SHALL record how it began** — to schedule, or because the owner asked —
reported by the process that ran it, and SHALL NOT be inferred from a run's
timing or from which control was on screen.

**Consecutive runs telling an identical story SHALL collapse into one line**
carrying how many runs it stands for and the span they cover, and that line SHALL
expand to the runs within it. Collapsing SHALL stop at a change of outcome, at a
run that moved a figure, at a run the owner asked for, at a change of channel, at
a day boundary, and at a run still under way. Two runs SHALL NOT collapse
together across a run of any other kind, so a collapsed line never claims a
continuity that did not happen.

The history SHALL load a page at a time as the reader scrolls and SHALL NOT
require counting the whole history to render its first screen. Collapsing SHALL
be applied to the runs accumulated so far rather than within a page, so that a
group spanning a page boundary reads as one group.

The sync SHALL distinguish its failure states, because they need different
people: a lapsed aggregator session, which the owner resolves; an aggregator
response whose shape is no longer understood, which a maintainer resolves; and a
reconciliation discrepancy, which is a question about money. A lapsed session
SHALL be surfaced to the owner as an action they can take.

Where the sync cannot obtain data for a date, it SHALL write nothing for that
date and report the failure. It SHALL NOT write a zero, and SHALL NOT overwrite
an existing figure with an empty one. **Reporting a failure for one date SHALL
NOT discard what the same run obtained for another.**

#### Scenario: A channel that stopped reads as stopped

- **WHEN** a channel scheduled four times a day last ran successfully nine hours
  ago and has recorded nothing since
- **THEN** the surface presents that channel as at fault, says a read was due, and
  offers Read now

#### Scenario: A stuck channel is not merely overdue

- **WHEN** a channel is both past due and its last run recorded a changed portal
  shape
- **THEN** the surface says the shape changed rather than that a read was due

#### Scenario: A quiet week is one line, not six

- **WHEN** six scheduled reads in a row complete having moved nothing
- **THEN** the history shows one line stating that six scheduled reads moved
  nothing and the span they cover, and that line expands to the six runs

#### Scenario: A healed outage is still legible

- **WHEN** a session lapses at 4:10 am, nine scheduled reads fail, and a
  reconnect at noon succeeds
- **THEN** what needs them no longer asks for a reconnect, and the history still
  shows all nine failed reads and the successful run after them

#### Scenario: A run refused over money is a run, not only a week

- **WHEN** a run refuses to write because the computed total disagrees with the
  stated payout
- **THEN** the history shows that run, says the amount it was off by, and the
  disputed week appears in what needs them

#### Scenario: A run waiting for a code is visible while it waits

- **WHEN** a run is holding for a one-time code
- **THEN** the history shows that run as under way rather than omitting it

#### Scenario: An overwrite says what it was

- **WHEN** the history lists a run in which a stored figure was replaced
- **THEN** the line states the figure it changed from and the figure it changed
  to, without the reader needing to expand it

#### Scenario: Runs the owner asked for stand alone

- **WHEN** the owner taps Read now four times and each read moves nothing
- **THEN** the history shows four separate lines, not one collapsed line

#### Scenario: A quiet run either side of a failure does not merge

- **WHEN** a quiet scheduled run is followed by a failed run and then another
  quiet scheduled run
- **THEN** the history shows three lines and collapses none of them together

#### Scenario: A group spanning a page boundary reads as one group

- **WHEN** seven consecutive quiet runs straddle the boundary between the first
  and second loaded page
- **THEN** after the second page loads the history shows one line standing for
  seven runs, not one for three and another for four

#### Scenario: Recording a summary does not change a figure

- **WHEN** a cycle is ingested by the function that records run summaries
- **THEN** every day figure, expense and reconciliation row written is identical
  to what the same cycle produced before summaries were recorded

#### Scenario: A restated figure that did not move is not reported as movement

- **WHEN** a run re-reads a fortnight-old week whose figures still match what is
  stored
- **THEN** that week contributes nothing to the run's summary and the run reads
  as having moved nothing

#### Scenario: How a run began is reported, not guessed

- **WHEN** a scheduled run and a run the owner asked for start within the same
  minute
- **THEN** each is labelled from what the running process reported, and the two
  are not distinguished by their timing

#### Scenario: A rehearsal is not a run in the history

- **WHEN** a rehearsal completes
- **THEN** it appears nowhere in the history

#### Scenario: A failed fetch writes nothing

- **WHEN** the sync cannot retrieve a date's data
- **THEN** no row is written or modified for that date, any previously stored
  figure is unchanged, and the failure is reported

#### Scenario: Failure states are told apart

- **WHEN** the sync fails
- **THEN** the report names which of the three states occurred, and a lapsed
  session is not reported as a shape change or a discrepancy
