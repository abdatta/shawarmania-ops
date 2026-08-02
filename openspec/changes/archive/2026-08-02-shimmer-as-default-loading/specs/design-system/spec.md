## MODIFIED Requirements

### Requirement: Loading reserves the space of what is loading

A surface waiting on a read SHALL show a placeholder that occupies approximately
the space the loaded content will occupy, rather than a line of text, so that
content arriving does not shift what is already on screen. This SHALL be a
single shared component reading semantic tokens, so that every surface waits in
the same way and no screen invents its own.

The placeholder SHALL be announced to assistive technology as a busy region
naming what is loading, and SHALL NOT rely on motion alone to convey that
something is happening, so that a reader with reduced motion preferences still
learns the surface is waiting.

A surface SHALL show the placeholder whenever the data on screen no longer
matches what is being asked for, including when a filter or scope changes, and
not only on a first load.

The placeholder SHALL be the only way this app shows that it is waiting on a
read. No surface SHALL fall back to a line of text, a spinner, or an empty
region, and this holds for every surface without exception, including the
session boot before any role is known.

This governs reads, not writes. A control whose action is in flight SHALL keep
showing that on the control itself, as a disabled state naming what is
happening, because the reader is waiting on something they just did rather than
on the surface arriving. A placeholder in place of a submitted form would hide
the very thing the reader is asking about.

The placeholder's shape SHALL correspond to the shape of the content it is
standing in for. A surface rendering a table waits behind rows, a surface
rendering a row of summary figures waits behind tiles, and a surface rendering a
grid waits behind a grid. A generic stack of card blocks under content that is
not a stack of cards does not satisfy this requirement, because it reserves the
wrong height and reflows on arrival just as a line of text does.

This correspondence is about the reserved space and the overall silhouette, and
SHALL NOT be read as a requirement to reproduce the loaded markup element for
element. A placeholder succeeds by going unnoticed, so where literal fidelity
and a calm, even silhouette disagree, the silhouette wins: a table's placeholder
reserves an even stack of rows and no separate header strip, because a short
block above taller ones reads as a mistake rather than as a heading and draws
attention to the one thing on screen nobody should be studying.

A change that alters a surface's layout SHALL reshape that surface's placeholder
within the same change, so that the reserved space and the arriving content
cannot drift apart over time.

#### Scenario: A list waiting on its first read

- **WHEN** a surface that will render a list of cards is waiting on that read
- **THEN** a placeholder occupying roughly that list's height is shown, and the
  arriving rows do not shift the controls above them

#### Scenario: A filter change shows the placeholder again

- **WHEN** a filter or scope on a loaded surface is changed and a new read begins
- **THEN** the placeholder replaces the previous results rather than leaving them
  on screen

#### Scenario: The wait is announced

- **WHEN** the placeholder is shown
- **THEN** assistive technology reports a busy region naming what is loading

#### Scenario: Reduced motion still communicates the wait

- **WHEN** the placeholder renders for a reader who prefers reduced motion
- **THEN** the waiting state remains identifiable without animation

#### Scenario: No surface waits behind a sentence

- **WHEN** any surface in the app is waiting on a read, on any role's shell
- **THEN** it shows the shared placeholder, and no line of loading text or
  spinner appears anywhere in its place

#### Scenario: A submitted action waits on its control, not behind a placeholder

- **WHEN** a reader submits a form or triggers an action and the write is in
  flight
- **THEN** the control shows the pending state and names it, and the surface
  around it is not replaced by a placeholder

#### Scenario: The session boot waits the same way

- **WHEN** the app is resolving the session before it knows which role's shell
  to render
- **THEN** it shows the shared placeholder shaped like the shell it is about to
  render, not a line of text

#### Scenario: A table reserves rows, not cards

- **WHEN** a surface that will render a table of rows is waiting on that read
- **THEN** the placeholder reserves the shape of that table, and not a stack of
  card-height blocks

#### Scenario: An even silhouette beats a literal one

- **WHEN** reproducing a detail of the loaded layout would put a block of an odd
  size among the others, as a table's header row would
- **THEN** the placeholder reserves the even silhouette instead, absorbing that
  detail into the space it holds rather than drawing the eye to it

#### Scenario: A summary row reserves tiles

- **WHEN** a surface that will render a row of summary figures is waiting on
  that read
- **THEN** the placeholder reserves the shape of that row of tiles, laid out as
  the figures will be

#### Scenario: A layout change carries its placeholder with it

- **WHEN** a change alters the layout of a surface that has a placeholder
- **THEN** that surface's placeholder is reshaped in the same change, so the
  reserved space still matches what will arrive
