# Design System

## Purpose

Guarantees that the interface stays legible and consistent as it grows, and that a franchise re-skin is a one-file change rather than a search-and-replace. Colour is layered so components never name a brand value; both themes are held to AA by a check rather than by reviewer attention; and the two values that are easiest to render wrongly — money and dates — go through one formatter each.
## Requirements
### Requirement: Three-layer token system with hex confined to the brand layer

The theme SHALL be implemented as CSS custom properties in three layers — brand (raw Shawarmania values), semantic (roles such as surface, content, primary, danger), and components — where components read semantic tokens only. Hex colour literals SHALL appear only in the brand token layer, and an automated check SHALL enforce this.

#### Scenario: A hex literal in a component fails the check

- **WHEN** a source file outside the token source file contains a hex colour literal and the check runs
- **THEN** the check exits non-zero, naming the file

#### Scenario: Re-skinning is a one-file change

- **WHEN** a brand-layer token value is changed
- **THEN** every component reflecting that role updates with no component file edited

### Requirement: Light and dark themes are both first-class

The app SHALL ship light and dark themes, each with its own semantic values rather than one derived from the other by inversion. Where a role is best served by different colours in the two themes, the semantic token SHALL carry that difference.

#### Scenario: Primary differs by theme

- **WHEN** the resolved theme is light
- **THEN** the primary role resolves to a value that clears AA against a light surface and carries its own text
- **WHEN** the resolved theme is dark
- **THEN** the primary role resolves to a value that clears AA against a dark surface and carries its own text

### Requirement: Theme follows the device, with a persistent manual override and no wrong-theme flash

On first load the theme SHALL follow the device colour-scheme preference. A manual toggle SHALL override it, the choice SHALL persist across reloads and app restarts, and the resolved theme SHALL be applied before first paint so no flash of the wrong theme occurs.

#### Scenario: First load follows the device

- **WHEN** the app loads with no stored theme choice on a device preferring dark
- **THEN** the dark theme is applied before first paint

#### Scenario: Manual choice persists

- **WHEN** a user toggles to dark on a light-preference device and later reopens the app
- **THEN** the app opens in dark with no flash of light theme

#### Scenario: Device preference changes while open, with no stored choice

- **WHEN** the device switches to dark and the user has never chosen a theme
- **THEN** the app follows it without a reload

### Requirement: Contrast is verified, not reviewed

A validator SHALL compute WCAG contrast ratios for the semantic token pairs of both themes from the token source file and fail the build below AA — 4.5:1 for text, 3:1 for identifying a control. It SHALL read the same token file the application imports, so there is no second list of values that can drift.

#### Scenario: A regression is rejected

- **WHEN** a token change drops a gated pair below its threshold
- **THEN** the validator fails, reporting the pair, its measured ratio, and the threshold it missed

#### Scenario: Both themes are checked on every run

- **WHEN** a token passes AA in light but fails in dark
- **THEN** the validator fails

#### Scenario: Ungated roles are declared

- **WHEN** the validator runs
- **THEN** it reports which roles are deliberately not gated, so an exemption is visible rather than silently absent

### Requirement: A control's boundary is identifiable without a per-component workaround

The primary control SHALL be distinguishable from the surface behind it by its own fill. Where a brand colour cannot achieve this, the brand layer SHALL carry a corrected value rather than components carrying a compensating border or outline.

#### Scenario: The fill carries the boundary

- **WHEN** the validator checks the primary control against a surface in either theme
- **THEN** the check passes on the fill itself, not on a border drawn around it

### Requirement: Focus is visible on every surface, including coloured controls

The focus indicator SHALL remain visible against page, card, callout and filled-control backgrounds alike, and SHALL NOT depend on a single colour that disappears against any of them.

#### Scenario: Focus on a filled primary control

- **WHEN** a primary control receives keyboard focus
- **THEN** the indicator remains distinguishable even though the control's fill matches the indicator's accent colour

### Requirement: Colour is never the only signal

Status and category SHALL be conveyed by shape, icon or label in addition to colour.

#### Scenario: Category markers

- **WHEN** a veg or non-veg item is displayed
- **THEN** the marker differs in shape as well as colour

### Requirement: Single money and date formatters

All money rendering SHALL go through one formatter that accepts integer paise and returns Indian-grouped rupees, correct for zero and negative values, and rejects non-integer input. All date rendering SHALL go through one formatter that displays in Asia/Kolkata regardless of device time zone. Both SHALL be pure functions with unit tests, and money values SHALL render with tabular numerals.

#### Scenario: Indian digit grouping

- **WHEN** the money formatter receives 12345600 paise
- **THEN** it returns `₹1,23,456`

#### Scenario: Float input is rejected

- **WHEN** the money formatter receives a non-integer value
- **THEN** it throws instead of rounding

#### Scenario: Display is Asia/Kolkata regardless of device zone

- **WHEN** the date formatter formats a UTC timestamp on a device set to another time zone
- **THEN** the output is the Asia/Kolkata local representation

#### Scenario: A business date is a calendar label, not an instant

- **WHEN** a resolved business date is rendered
- **THEN** it displays as that calendar date, with no time-zone offset applied that could shift it by a day

### Requirement: Self-hosted Latin-subset brand fonts

The app SHALL self-host its display and text faces, subset to Latin, with no request to any third-party font CDN.

#### Scenario: No font CDN request

- **WHEN** the built app loads with the network inspected
- **THEN** all font files are served from the app's own origin

### Requirement: Base components sized for counter use

Base interactive components SHALL meet the density metrics for their context: 56px minimum menu tiles, 48px standard controls on tablet and 44px on phone, and a minimum 16px font size for form inputs.

#### Scenario: Form inputs do not trigger mobile zoom

- **WHEN** a form input is focused on a mobile viewport
- **THEN** its computed font size is at least 16px

### Requirement: A menu closes by clicking away from it, not only by the control that opened it

A menu, popover, or other transient panel SHALL close when a pointer lands
outside it and when Escape is pressed, in addition to closing from its own
trigger. A panel that can only be dismissed by returning to its trigger reads
as stuck, and covers whatever is beneath it until the person finds their way
back.

Native `<details>`/`<summary>` supplies the disclosure and the keyboard
behaviour but not this dismissal, so a component built on it SHALL hold its own
open state and release it on an outside pointer.

#### Scenario: A pointer lands outside an open menu

- **WHEN** a menu is open and a pointer lands anywhere outside its panel and trigger
- **THEN** the menu closes

#### Scenario: A pointer lands inside an open menu

- **WHEN** a menu is open and a pointer lands within its own panel
- **THEN** the menu stays open

#### Scenario: Escape is pressed

- **WHEN** a menu is open and Escape is pressed
- **THEN** the menu closes and focus returns to the control that opened it

### Requirement: A placeholder never reads as a value already filled in

A placeholder that shows an **example of the value** SHALL be marked as an
example, so that it cannot be mistaken for content already entered. It SHALL
NOT be the exact name of a real record that exists in the same database, since
that is the case most likely to be read as a value rather than a hint.

A placeholder that supplies the **accessible name of an input with no visible
label** SHALL NOT be marked as an example, because it is doing the work of a
label rather than suggesting a value. A format mask and an instruction are
likewise not examples.

The distinction is the requirement. A blanket convention applied to both kinds
would make labels incoherent, and applying none is what allowed an outlet to be
created with no name.

#### Scenario: A sample value is recognisable as a sample

- **WHEN** a form field's placeholder shows an example of what to type
- **THEN** it is presented as an example rather than as a bare value

#### Scenario: A placeholder standing in for a label is left alone

- **WHEN** an input has no visible label and its placeholder supplies its
  accessible name
- **THEN** that placeholder names the field plainly, with no example marking

#### Scenario: No placeholder names a real record

- **WHEN** any placeholder in the app shows a sample value
- **THEN** it is not the exact name of a record that exists in the database

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
