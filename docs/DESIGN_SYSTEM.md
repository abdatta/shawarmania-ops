# Design System

> Implemented in `project-foundations`. Tokens live in `src/styles/tokens.css` — the single source file, and the only place under `src/` where a hex literal is allowed. Every value below is checked by the contrast validator (`npm run contrast`) in both themes on every push.

The brief: **Shawarmania's colours, an ops portal's discipline.** The marketing site is maximalist — flame gradients, huge display type, dark and loud. A tool someone stares at for eight hours across a counter needs the opposite: density, legibility, and speed. The resolution is not a compromise on either; it is putting the brand in the accent layer and letting structure carry the rest.

The palette that does this is **Stone & Ember**: a warm neutral scale carrying a single brand accent. Warm rather than grey, so the portal still reads as related to the storefront; far less saturated than cream, so a table can be read against it for a whole shift. It was chosen from five candidates, and the ones not taken were a near-neutral slate, a high-contrast paper-and-ink, a graphite-and-gold, and an accounting green — recorded here because "why isn't it more neutral?" is a fair question to ask later.

## Token layers

```
brand.*     raw Shawarmania values — the only place a hex literal is allowed
   ↓
semantic.*  roles: surface, content, primary, success, danger, focus…
   ↓
components  read semantic tokens only
```

**Components never read brand tokens, and never contain hex values.** That is what makes a franchise re-skin a one-file change: replace the brand layer, and every screen follows.

## Brand layer

Taken from the live site's own CSS, so the portal and the storefront cannot drift apart.

| Token | Value |
|---|---|
| `--brand-flame-gold` | `#ffc53d` |
| `--brand-flame-orange` | `#f97316` |
| `--brand-flame-red` | `#dc2626` |
| `--brand-maroon` | `#7f1d1d` |
| `--brand-cream` | `#f5e4c7` |
| `--brand-cream-dim` | `#c9b795` |
| `--brand-paper-raised` | `#fdf3de` |
| `--brand-ink` | `#2b1d12` |
| `--brand-ink-dim` | `#6f5b44` |
| `--brand-bg` | `#14100b` |
| `--brand-bg-raised` | `#1e1710` |
| `--brand-veg` | `#16a34a` |
| `--brand-nonveg` | `#b91c1c` |

The portal consumes a subset of these directly — `--brand-flame-orange`, `--brand-veg`, `--brand-nonveg`, and `--brand-bg` as the app icon's field. The rest stay recorded because this block is the **brand of record**: it is what a franchise re-skin replaces, and what keeps the portal and the storefront from drifting apart even where a value is not currently drawn.

### The mark

`assets/brand/shawarmania-mark-512.png` is the app icon master — the same mark the Shawarmania site serves as its favicon. Every size under `public/icons/` is derived from it by `npm run icons:generate`; none is hand-exported, and none should be edited directly.

Two details are load-bearing rather than incidental:

- **The maskable variant is composited full-bleed with the art inset to 80%.** The mark has transparent rounded corners, and Android crops a maskable icon to whatever shape the launcher uses — shipped as-is, its edges get clipped.
- **The field colour is sampled from the master, not hard-coded.** It reads as `#14100b`, which is `--brand-bg`. If the artwork is ever replaced, the derived background follows it rather than quietly disagreeing.

Replacing the mark is: swap the master, run the script, commit what changes.

### Portal extensions

Values the ops portal needs that the marketing site has no equivalent for. They sit in the brand layer rather than the semantic layer so "hex only in the brand layer" stays literally true.

**Ember** — the brand orange taken darker, so it can carry white text:

| Token | Value | Why it exists |
|---|---|---|
| `--brand-ember` | `#c2410c` | The light-theme primary. `#f97316` on white is 2.8:1; this is 5.2:1 |
| `--brand-ember-deep` | `#9a3412` | Brand-coloured *text* on light |
| `--brand-ember-soft` | `#fdba74` | Brand-coloured *text* on dark |

**Warm neutral scale** — warm enough to feel related to the brand, unsaturated enough to read tables against for a whole shift:

| Token | Value | Used for |
|---|---|---|
| `--brand-stone-50` | `#fafaf9` | Light canvas / dark body text |
| `--brand-stone-100` | `#f5f5f4` | Light callout surface |
| `--brand-stone-200` | `#e7e5e4` | Light structure |
| `--brand-stone-400` | `#a8a29e` | Dark secondary text |
| `--brand-stone-500` | `#6f6862` | Light secondary text at 5.25:1. **Deepened** from the usual `#78716c`, which clears AA by 0.09 (4.59:1) — passing, but a margin that thin breaks the moment anyone nudges the canvas |
| `--brand-stone-700` | `#44403c` | Dark structure |
| `--brand-stone-800` | `#292524` | Dark callout surface |
| `--brand-stone-900` | `#1c1917` | Light body text / dark card surface |
| `--brand-stone-950` | `#0c0a09` | Dark canvas |
| `--brand-white` | `#ffffff` | Light card surface, and text on ember |

**Status colours**, each the same hue as its brand counterpart, moved only as far as AA requires on its own ground:

| Token | Value | Why it exists |
|---|---|---|
| `--brand-veg-deep` | `#15803d` | AA-passing green for *text* on light |
| `--brand-veg-soft` | `#4ade80` | AA-passing green for *text* on dark |
| `--brand-nonveg-soft` | `#f87171` | AA-passing red for *text* on dark |
| `--brand-amber-deep` | `#b45309` | Warning on light, able to carry white text |
| `--brand-amber` | `#fbbf24` | Warning on dark |

## Semantic layer

### Light theme — the counter default

| Token | Value | Notes |
|---|---|---|
| `--color-canvas` | `#fafaf9` | Warm near-white. **Not** cream — `#f5e4c7` is too saturated to read tables against for hours |
| `--color-surface` | `#ffffff` | Cards, tables, sheets |
| `--color-surface-raised` | `#f5f5f4` | Callouts and highlights only, never a page background |
| `--color-border` | `#e7e5e4` | Warm-tinted, so structure reads as part of the brand |
| `--color-content` | `#1c1917` | Body text — 17.5:1 on a card |
| `--color-content-muted` | `#6f6862` | Labels, secondary text — 5.5:1 |
| `--color-primary` | `#c2410c` | The ember. Carries white text and needs no border to be legible |
| `--color-on-primary` | `#ffffff` | 5.2:1 on the ember |
| `--color-accent-text` | `#9a3412` | Brand-coloured *text* on light |
| `--color-success` | `#15803d` | **Deepened.** `#16a34a` on canvas is 3.1:1 and fails AA for text |
| `--color-danger` | `#b91c1c` | |
| `--color-warning` | `#b45309` | Deep enough to carry white text |
| `--color-on-warning` | `#ffffff` | |
| `--color-marker-veg` | `#16a34a` | The veg dot — non-text (3.3:1), so the brand green stands |
| `--color-marker-nonveg` | `#b91c1c` | The non-veg dot |

### Dark theme — for phones in the evening

| Token | Value | Notes |
|---|---|---|
| `--color-canvas` | `#0c0a09` | |
| `--color-surface` | `#1c1917` | |
| `--color-surface-raised` | `#292524` | |
| `--color-border` | `#44403c` | |
| `--color-content` | `#fafaf9` | 16.7:1 on a card |
| `--color-content-muted` | `#a8a29e` | 6.9:1 |
| `--color-primary` | `#f97316` | **The full-strength brand orange**, which needs no deepening here — 6.2:1 on a card |
| `--color-on-primary` | `#1c1917` | Ink on orange |
| `--color-accent-text` | `#fdba74` | |
| `--color-success` | `#4ade80` | |
| `--color-danger` | `#f87171` | **Lightened.** `#b91c1c` on the dark canvas is ~2.9:1 and fails |
| `--color-warning` | `#fbbf24` | |
| `--color-on-warning` | `#1c1917` | Ink on amber, never white |
| `--color-marker-veg` | `#4ade80` | |
| `--color-marker-nonveg` | `#f87171` | |

The primary colour deliberately differs between themes, and the reason is contrast rather than taste. Semantic tokens name a *role*, not a colour; the role "the thing you press" is served by the deepened ember on a light ground and by the brand orange itself on a dark one, because each is what clears AA against the surface it sits on.

## Theme switching

Both themes are first-class. Neither is an afterthought bolted on later, and **both are gated by the contrast validator** — a token that passes in light and fails in dark is a failure, not a compromise.

- **Default follows the device.** `prefers-color-scheme` decides on first load, so the app matches whatever the user's phone already does at that time of day.
- **A manual toggle overrides it**, reachable from every screen, and the choice **persists across reloads and app restarts**. A manager who prefers dark should not have to re-choose each morning.
- **No flash of the wrong theme.** The resolved theme is applied before first paint; a white flash on a dark phone at 11pm is exactly the kind of small thing that makes an app feel unfinished.
- Both themes are checked on a phone viewport and a tablet viewport before a UI change is done.

The counter tablet will usually sit in light mode — shops are bright and glare is the enemy — while manager and employee phones will often be dark. Both are real usage, not preference.

## Contrast rules

These are computed, not eyeballed, and they are enforced by a validator in CI rather than left to reviewer discipline.

**`#f97316` on white is 2.8:1.** It fails AA for text (4.5:1) and even misses the 3:1 non-text threshold for identifying a control. That one number shapes the whole light theme:

1. **The light theme uses the ember, not the brand orange.** `--brand-ember` (`#c2410c`) is the same hue moved darker until it works: **5.2:1** against a white card, which means it can be a primary button with plain white text and needs no border, outline or ink trick to be legible. The brand orange is not weakened here — it is used at full strength in the dark theme, where it has a dark ground and reaches 6.2:1.
2. **Brand-coloured text on light uses `--color-accent-text` (`#9a3412`)** — 7.3:1 on a card. Ember itself would pass as text, but the deeper value leaves headroom for smaller type.
3. **Focus rings do not rely on the accent alone.** The ring is 2px ember with a 1px dark ring outside it. Against a card the ember ring is legible on its own, but a ring drawn *on* a primary button would be ember-on-ember — invisible. The outer ring carries that case at 3.4:1. This is the one place the two-ring construction is load-bearing rather than belt-and-braces.

An earlier revision of this system took a different route to rule 1: it kept `#f97316` as the primary and gave the button a dark ink border to supply the missing boundary contrast. That worked, and the validator passed it, but it meant every primary button in the product carried a workaround for a colour that was never going to be legible on white. Deepening the colour once, in the brand layer, removed the need for it everywhere. **When a token needs a per-component workaround, fix the token.**

The validator still checks the button as a composite — it passes if *either* the fill or its border clears 3:1, and reports which one carried it. That check now reports "via `--primary`" in both themes, which is the signal that the workaround is genuinely gone rather than merely deleted.

Two more consequences of the same arithmetic, applied to the palette rather than to components:

- **`--color-success` is `#15803d` on light, not the brand `#16a34a`.** The brand green is 3.1:1 against the canvas — fine for the veg marker (non-text, and the marker is a shape as well as a colour) but short of AA as text. This mirrors the correction `--color-danger` already needed on dark, and it is why the marker colours are separate tokens from the status colours.
- **`--color-warning` is `#b45309` on light, not the brand gold.** Gold is a fill that demands ink text; the deeper amber carries white and behaves like every other status colour, which matters more on a screen where warnings sit inside dense tables. Gold survives as `--brand-flame-gold` and remains available for a surface that wants it.
- **`--color-border` is deliberately not gated.** At around 1.3:1 against a white card it is decorative structure, not a control boundary or a state indicator, and a subtle warm border is the considered choice. The validator prints it under "not gated" on every run so the exemption stays visible rather than becoming a silent omission. Any border that ever conveys state has to move into the gated set.

Semantic colour is never the only signal. Low stock is an icon and a label, not just red text; veg/non-veg is a marker shape as well as a colour. Roughly 1 in 12 men has a colour-vision deficiency, and this app is used by kitchen staff, not a design-literate audience.

## Typography

- **Lilita One** — the wordmark, and large numeric displays only: a bill total, the cash difference at close. It is a heavy display face; using it for table headers or labels would wreck exactly the density this portal needs.
- **Nunito Sans Variable** — everything else. Already the brand's text face, and a genuinely good UI font.
- **Every money value uses `font-variant-numeric: tabular-nums`.** Columns of rupees that don't align are hard to scan and easy to misread, which in a cash app is a correctness problem.
- Base size 14px for dense tables, **16px for form inputs** — below 16px, iOS Safari zooms on focus, which is maddening on a counter tablet.
- Subset both fonts to Latin and self-host. No third-party font CDN: it is a privacy leak and a hard dependency for an app that must work on bad connections.

## Density and touch

Two distinct contexts, and they need different metrics:

| | Counter tablet | Manager phone |
|---|---|---|
| Menu item tiles | **56px** minimum, generous padding | n/a |
| Standard controls | 48px | 44px |
| Table row height | 44px | 40px |
| Primary action | Fixed, thumb-reachable, always visible | Inline |

The counter numbers are larger on purpose. Billing happens fast, one-handed, sometimes with wet or greasy hands, while a customer waits. Missing a tap costs real time in front of a real queue.

## Component conventions

- **The app install action is chrome, not page content.** It uses the semantic
  primary button treatment, a 44px touch target, and the accessible name
  “Install Shawarmania Ops as an app”. The compact download icon expands to
  show *Install* on hover or keyboard focus and once, for five seconds, after a
  three-second discovery delay. That timed motion never repeats in the same
  tab; `prefers-reduced-motion` renders the full label without animation.
  Installed and ineligible browsers render nothing, iOS Safari opens a
  semantic-token instruction callout, and demo shells intentionally omit the
  action.
- **The "add new thing" trigger is `AddButton`** (`src/components/ui/add-button.tsx`), used once per page header. The visible label is always the plus icon and the word "Add" — never "Add outlet", "Add person", etc. — because the page title already says what's being added; `label` still sets the accessible name (`"Add outlet"`) so screen reader users get that same specificity without reading it visually. `whitespace-nowrap` is baked in so the icon and word can never wrap onto two lines. If a page's context genuinely doesn't make the object obvious, that's a sign the page needs a clearer title or subtitle — not a longer button.
- **A badge means work waiting, and nothing else** (`src/components/ui/badge.tsx`). `Badge` states a count; `BadgeDot` is the same signal where a number would not help. Both take the **primary pair, `--primary` / `--on-primary`** — the same colours as the button that clears the work, so the thing demanding attention and the remedy read as one concern. `--danger` stays reserved for things that are actually wrong. A count of nought renders **nothing at all**, so the absence of a badge always means the same thing; above 99 it reads `99+` rather than widening out of the entry it sits on. `label` is a **required** prop and the digits are `aria-hidden`: a component whose whole job is to be noticed would be the clearest possible violation of "colour is never the only signal" if it worked only for people who can see it. A badge is never used for totals, status, or anything that resolves without a person doing something.
- **Money** renders through one formatter — paise in, `₹1,234` out, Indian digit grouping (`₹1,23,456`). Never format inline; never hand a float to a component.
- **Dates** render in Asia/Kolkata through one formatter. Business dates render as dates, never as timestamps.
- **Destructive actions** (void a bill, remove a tablet) confirm, and say what will happen in plain words.
- **Empty states** say what to do next, not "No data".
- **A placeholder showing a sample value is prefixed `e.g.`; one standing in for a label is not.** The rule is narrow on purpose. A placeholder that shows *an example of the value* — `e.g. Shawarmania Kalyani`, `e.g. kalyani` — must be unmistakably an example, because an unprefixed one reads as a value already filled in. That is not hypothetical: `Shawarmania Kalyani` is the name of a real outlet in this database, and a manager filling the form in good faith saw a plausible, correct-looking name already in the box and submitted an outlet with no name. But a placeholder naming *the field itself* — `City`, `District`, `PIN code`, `Line 2` — is the accessible name of an input carrying `aria-label` and no visible label, and `e.g. City` would be incoherent. Format masks (`XXXXX-XXXXX`) and instructions (*Search a landmark, street or shop*) are neither, and stay as they are. The fix is two characters of copy rather than italics or reduced opacity: styling would touch every input in the app, need contrast re-validation in both themes, and still not distinguish a sample value from a field name, which is the actual confusion.
- **`noValidate` is on every form, and `required` stays on the inputs anyway.** Native validation draws a bubble whose wording, position and typography cannot be styled or translated, and which varies across the browsers a counter tablet and a staff phone actually run — so this app writes its own refusals, in its own voice, naming the field and its consequence. `required` is kept because it also sets `aria-required`, which assistive technology announces; removing it to reflect that it no longer validates would take away the half of it that works. So the division is: `required` marks the field for the person and their screen reader, an explicit guard on submit refuses and says which field, and a check constraint refuses the write. Where a form has several required fields the submit button **stays enabled** — a dead button on a ten-field form says nothing about which of them is missing, least of all on a phone where the offending field is scrolled out of sight. Single-field sheets keep their disabled buttons, where a dead button is self-explanatory.
- **Waiting for a read reserves the space** (`src/components/ui/loading.tsx`). The module is a **primitive plus a region**, not a catalogue: `Shimmer` is one animated block sized entirely by its caller, and `LoadingRegion` is the wrapper carrying the accessibility contract. A surface composes `Shimmer` blocks inside a `LoadingRegion` **using the same container classes its loaded content uses**, so the placeholder is that surface's own shape by construction. Four recurring shapes are exported as thin compositions so the common cases stay short — `LoadingList` (a stack of cards, at a caller-chosen block height), `LoadingBlock` (one strip), `LoadingTable` (an even stack of rows at the `DataTable` density), and `LoadingFigures` (cards of label/value rows, taking an array to reserve a stack of them). Anything else composes the primitive directly, as the counter's menu grid and the biller grid do. All of it reads semantic tokens only.

  **Matching the real markup is not the goal — going unnoticed is.** `LoadingTable` reserves no header strip even though the loaded table has a header row, because a short block above a stack of taller ones reads as a mistake rather than as a heading and pulls the eye to the one thing on screen nobody should be studying. Where fidelity to the underlying elements and a calm, even silhouette disagree, the silhouette wins: judge a placeholder by how it looks, not by how faithfully it maps onto the DOM behind it. The rule they exist for is that **content arriving must not shift what is already on screen** — a line of "Loading…" is one line tall and a list of cards is not, so every read used to end with the controls above it jumping. Before #29 there was no loading component at all and each screen wrote its own sentence, which is also how a surface ended up showing one outlet's rows under another outlet's name. The region is `aria-busy` and carries a name saying **what** is loading, so a reader who cannot see the shimmer is told the same thing; the animation is Tailwind's `animate-pulse` paired with an explicit `motion-reduce:animate-none`, so under `prefers-reduced-motion` the movement stops while the reserved blocks and the announcement stay, and the waiting state never depends on motion alone. **The guard has to be written**: `animate-pulse` compiles to a bare `animation` declaration and does not honour the preference on its own, which this app assumed it did until it was measured. Use it whenever the data on screen no longer matches what is being asked for — a filter or scope change, not only a first load.
- **Attendance rows are chips, not sentences** (`src/features/attendance/evidence.tsx`). Distance, accuracy, source, outlet and where the approver stood are each a bordered chip with an icon; the approval collapses to one line, plus a second only when a reason exists. What compressed is the presentation and nothing else — every fact the spec requires is still on the card. Each chip carries an `sr-only` **name** before its value ("Distance from the outlet: 127 m"), because a chip reading "127 m" tells a sighted reader what it is from the pin beside it and tells a screen reader nothing at all. A chip that wants a manager's attention changes its icon as well as its colour.
- **Offline state is always visible** on billing screens — a pending-sync count, never a silent failure. See [Offline And Sync](OFFLINE_AND_SYNC.md).
- **The shimmer is the app's loading language, and the shape belongs to the page.** Every surface waiting on a read waits behind the placeholder — no line of text, no spinner, no empty region, on any role's shell and including the session boot before a role is known. The shape a surface reserves is **its own**: a table waits behind rows, a row of figures behind tiles, the counter's menu behind a grid of tiles. A generic stack of card blocks under content that is not a stack of cards is not good enough, because it reserves the wrong height and reflows on arrival just as a sentence does. **A change that alters a surface's layout reshapes that surface's placeholder in the same change** — nothing automated checks this, so it is a rule rather than a test. An ESLint rule warns (never errors) on a `Loading` text node outside the loading module, which catches the sentence coming back but cannot catch a shape going stale.
- **This governs reads. A pending write stays on its control.** A submitted form or a triggered action shows its pending state where the person pressed — a disabled button reading "Saving…", the position capture reporting the accuracy it has so far — because they are waiting on something they just did, not on the surface arriving. Replacing a submitted form with a placeholder would hide the very thing they are asking about. A spinner on such a control is correct and stays.
- **Loading never blocks the counter.** Optimistic UI on the billing path: a bill is rung, shown and settled without waiting for the network, which is about writes and is unaffected by any of the above.

## What we deliberately do not import from the marketing site

Flame gradients as surfaces, the animated marquee, scroll-driven motion, hero-scale type, and the paper-texture treatment. They are excellent at selling shawarma and actively harmful in a tool for counting money. The brand shows up here as colour, warmth, and the wordmark — not as atmosphere.
