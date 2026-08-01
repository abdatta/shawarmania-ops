## ADDED Requirements

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
