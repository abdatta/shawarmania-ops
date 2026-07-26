# design-system — delta

## ADDED Requirements

### Requirement: Three-layer token system with hex confined to the brand layer

The theme SHALL be implemented as CSS custom properties in three layers — `brand.*` (raw Shawarmania values), `semantic.*` (roles such as surface, content, primary, danger), and components — where components read semantic tokens only. Hex colour literals SHALL appear only in the brand token layer, and an automated check SHALL enforce this.

#### Scenario: A hex literal in a component fails the check

- **WHEN** a file under `src/` outside the token source file contains a hex colour literal and the check runs
- **THEN** the check exits non-zero, naming the file

#### Scenario: Re-skinning is a one-file change

- **WHEN** a brand-layer token value is changed
- **THEN** every component reflecting that role updates with no component file edited

### Requirement: Light and dark themes are both first-class

The app SHALL ship light and dark themes per `docs/DESIGN_SYSTEM.md`, including the deliberate primary-colour difference: orange (`--brand-flame-orange`) as primary in light, gold (`--brand-flame-gold`) as primary in dark.

#### Scenario: Primary differs by theme

- **WHEN** the resolved theme is light
- **THEN** the primary role resolves to the brand orange with dark ink content on it
- **WHEN** the resolved theme is dark
- **THEN** the primary role resolves to the brand gold with dark ink content on it

### Requirement: Theme follows the device, with a persistent manual override and no wrong-theme flash

On first load the theme SHALL follow `prefers-color-scheme`. A manual toggle SHALL override it, the choice SHALL persist across reloads and app restarts, and the resolved theme SHALL be applied before first paint so no flash of the wrong theme occurs.

#### Scenario: First load follows the device

- **WHEN** the app loads with no stored theme choice on a device preferring dark
- **THEN** the dark theme is applied before first paint

#### Scenario: Manual choice persists

- **WHEN** a user toggles to dark on a light-preference device and later reopens the app
- **THEN** the app opens in dark with no flash of light theme

### Requirement: Contrast validator gates both themes in CI

A validator SHALL compute WCAG contrast ratios for the semantic token pairs of both themes from the token source file and fail CI below AA (4.5:1 text, 3:1 non-text). It SHALL specifically enforce the three rules from `docs/DESIGN_SYSTEM.md`: orange is a fill and never text on light backgrounds, brand-coloured text on light uses `--color-accent-text`, and focus rings never rely on orange alone.

#### Scenario: Known-failing brand pair is rejected

- **WHEN** a token change makes `#f97316` the value of a text-on-light role
- **THEN** the validator fails CI, reporting the failing pair and its ratio

#### Scenario: Both themes are checked on every run

- **WHEN** a token passes AA in light but fails in dark
- **THEN** the validator fails CI

### Requirement: Single money and date formatters

All money rendering SHALL go through one formatter that accepts integer paise and returns Indian-grouped rupees (e.g. `₹1,23,456`), correct for zero and negative values, and rejects non-integer input. All date rendering SHALL go through one formatter that displays in Asia/Kolkata regardless of device time zone. Both SHALL be pure domain functions with unit tests, and money values SHALL render with tabular numerals.

#### Scenario: Indian digit grouping

- **WHEN** the money formatter receives `12345600` paise
- **THEN** it returns `₹1,23,456`

#### Scenario: Float input is rejected

- **WHEN** the money formatter receives a non-integer value
- **THEN** it throws instead of rounding

#### Scenario: Display is Asia/Kolkata regardless of device zone

- **WHEN** the date formatter formats a UTC timestamp on a device set to another time zone
- **THEN** the output is the Asia/Kolkata local representation

### Requirement: Self-hosted Latin-subset brand fonts

The app SHALL self-host Lilita One (display: wordmark and large numeric displays only) and Nunito Sans Variable (all other text), subset to Latin, with no request to any third-party font CDN.

#### Scenario: No font CDN request

- **WHEN** the built app loads with the network inspected
- **THEN** all font files are served from the app's own origin

### Requirement: Base components sized for counter use

Base interactive components SHALL meet the density metrics from `docs/DESIGN_SYSTEM.md`: 56px minimum menu tiles, 48px standard controls on tablet (44px on phone), and 16px minimum font size for form inputs.

#### Scenario: Form inputs do not trigger mobile zoom

- **WHEN** a form input is focused on a mobile viewport
- **THEN** its computed font size is at least 16px
