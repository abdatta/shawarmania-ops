# Attention Badges

## Purpose

A badge means one thing everywhere in this application: somebody is waiting on you. It is a count
attached to the thing it is about, readable from wherever the reader happens to be rather than only
from the surface that needed reading. These requirements bind what a badge may be used for, how a
surface declares one, that the number and not the colour carries the meaning, and the freshness a
reader may rely on.

## Requirements

### Requirement: A badge counts work somebody else is waiting on

A badge SHALL mean one thing across the whole application: how many items are
waiting for the person reading it to act. It SHALL NOT be used for totals,
status, decoration, or anything that resolves without a human doing something.

A badge with a known count SHALL state the number. Where the count is known to
be non-zero but the number itself is not meaningful to the reader, a bare dot
SHALL be shown instead. A count of zero SHALL render nothing at all, so the
absence of a badge always means there is nothing waiting.

#### Scenario: Work is waiting

- **WHEN** a surface reports three items waiting for the current person
- **THEN** a badge showing 3 is rendered against that surface

#### Scenario: Nothing is waiting

- **WHEN** a surface reports no items waiting
- **THEN** no badge is rendered, and no empty or zero badge appears in its place

#### Scenario: A badge is not a status light

- **WHEN** a surface has a condition that resolves on its own, such as a sync in
  progress
- **THEN** no badge is shown for it

### Requirement: The number carries the meaning, never the colour alone

A badge SHALL carry an accessible name stating what is waiting and how many, so
that it is understood without seeing it. Colour SHALL NOT be the only signal
distinguishing a badge from its surroundings.

The badge SHALL use the same colour pair as the primary action, so that the
thing demanding attention and the button that clears it read as the same
concern, and so that no new colour pair enters the system unverified.

#### Scenario: A badge is read aloud

- **WHEN** a screen reader reaches a nav item carrying a badge of three
- **THEN** it announces the surface and that three arrivals are waiting for
  approval, rather than announcing the bare number three

#### Scenario: A bare dot still says what it means

- **WHEN** a dot with no number is rendered
- **THEN** it carries an accessible name describing what is waiting there

### Requirement: A surface declares its own count

A surface SHALL declare where its badge count comes from, and the shell SHALL
render it without knowing what the count is about. Adding a badge to a further
surface SHALL NOT require changing the shell.

A count SHALL be scoped by the same authority as the surface it belongs to: a
badge SHALL never reveal that work exists somewhere the reader could not open.

#### Scenario: A second surface is badged

- **WHEN** a further surface declares a count source
- **THEN** its navigation entry carries a badge with no change to either shell

#### Scenario: A badge respects tenancy

- **WHEN** a Franchise Admin holding one outlet reads a badged surface while
  another outlet holds waiting work
- **THEN** their badge counts only their own outlet's work

### Requirement: A count is fresh on arrival, not live

A badge count SHALL be read when the surface or shell that shows it is first
rendered, and SHALL be read again when the application returns to the
foreground. It SHALL NOT be polled on a timer and SHALL NOT hold an open
subscription.

A badge is therefore accurate as of the reader's last arrival, and may lag work
that arrives while a screen sits open. This is a deliberate trade against
battery on a device that spends its day in an apron.

#### Scenario: The app is brought back

- **WHEN** the application returns to the foreground after work arrived while it
  was backgrounded
- **THEN** the count is read again and the badge reflects it

#### Scenario: No timer runs

- **WHEN** a badged screen is left open and untouched
- **THEN** no repeated network request is made on its behalf

### Requirement: A badge on a surface that shows one scope at a time decomposes to its switch

Where a badged surface reads several scopes and shows one of them at a time —
one channel, one outlet — its navigation badge SHALL count the waiting work
across every scope that surface can reach, and the control that switches between
them SHALL carry that work broken down per scope.

A reader SHALL NOT have to change the selection to discover that work exists
behind it: each scope's count SHALL be readable on arrival, without selecting
that scope. A navigation badge that counts more than the visible scope holds and
does not say where the difference is SHALL be treated as a defect, because it
sends the reader hunting through selections for work the application already
knows the location of.

**Where a surface carries more than one such control, they SHALL nest, and the
count on each SHALL be the share belonging to what is selected above it.** The
outermost control SHALL decompose the navigation badge; every control beneath it
SHALL decompose the selection made above it. Two controls that each split the
badge along a different axis would hand the reader two numbers that both look
like the whole, and following either one down would arrive somewhere the other
denied — so a count SHALL NOT be scoped more widely than the controls above it
on the same surface.

It follows that **a control's count changes when a selection above it changes,
and never when one below it does.** A count that moved because of a control
further down the page would be describing something other than what the reader
had chosen.

Counts SHALL be scoped by the same authority as the surface, so a decomposed
badge reveals no scope the reader could not open.

#### Scenario: A tab badge adds up to the outermost control

- **WHEN** one outlet has four matters waiting and another has six
- **THEN** the navigation entry badges ten, and the outlet control shows four
  against the first and six against the second

#### Scenario: An inner control splits what the outer one selected

- **WHEN** the reader is on the outlet holding four, of which one is on one
  channel and three on the other
- **THEN** the channel switch shows one and three, which add up to that outlet's
  four rather than to the entry's ten

#### Scenario: Choosing a different outlet re-splits the switch beneath it

- **WHEN** the reader moves to the outlet holding six, split two and four
- **THEN** the channel switch shows two and four, and the outlet counts above it
  are unchanged

#### Scenario: Nothing waits invisibly behind an unselected scope

- **WHEN** the surface opens on a scope with no waiting work while another scope
  holds some
- **THEN** the unselected scope carries its own count immediately, without the
  reader selecting it

#### Scenario: A decomposed badge respects tenancy

- **WHEN** a reader may open only some of the scopes a surface can read
- **THEN** both the navigation badge and the per-scope counts cover only the
  scopes they may open
