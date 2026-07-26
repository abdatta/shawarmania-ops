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
