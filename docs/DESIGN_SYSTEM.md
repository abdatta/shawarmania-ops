# Design System

> Describes the theme as designed. No components have been built yet.

The brief: **Shawarmania's colours, an ops portal's discipline.** The marketing site is maximalist — flame gradients, huge display type, dark and loud. A tool someone stares at for eight hours across a counter needs the opposite: density, legibility, and speed. The resolution is not a compromise on either; it is putting the brand in the accent layer and letting structure carry the rest.

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

## Semantic layer

### Light theme — the counter default

| Token | Value | Notes |
|---|---|---|
| `--color-canvas` | `#fbf8f3` | Warm near-white. **Not** full cream — `#f5e4c7` is too saturated to read tables against for hours |
| `--color-surface` | `#ffffff` | Cards, tables, sheets |
| `--color-surface-raised` | `#fdf3de` | Callouts and highlights only, never a page background |
| `--color-border` | `#e6ded0` | Warm-tinted, so structure reads as part of the brand |
| `--color-content` | `#2b1d12` | Body text |
| `--color-content-muted` | `#6f5b44` | Labels, secondary text |
| `--color-primary` | `#f97316` | Fill only — see the contrast rule below |
| `--color-on-primary` | `#2b1d12` | Ink on orange |
| `--color-accent-text` | `#7f1d1d` | Brand-coloured *text* on light |
| `--color-success` | `#16a34a` | |
| `--color-danger` | `#b91c1c` | |
| `--color-warning` | `#ffc53d` | Always with ink text, never white |

### Dark theme — for phones in the evening

| Token | Value | Notes |
|---|---|---|
| `--color-canvas` | `#14100b` | |
| `--color-surface` | `#1e1710` | |
| `--color-surface-raised` | `#2a211a` | |
| `--color-border` | `#3a2f24` | |
| `--color-content` | `#f5e4c7` | |
| `--color-content-muted` | `#c9b795` | |
| `--color-primary` | `#ffc53d` | **Gold, not orange.** On a dark canvas gold carries far more contrast |
| `--color-on-primary` | `#14100b` | |
| `--color-accent-text` | `#ffc53d` | |
| `--color-success` | `#16a34a` | ~5.8:1 on canvas — passes as-is |
| `--color-danger` | `#f87171` | **Lightened.** `#b91c1c` on `#14100b` is ~2.9:1 and fails |
| `--color-warning` | `#ffc53d` | |

The primary colour deliberately differs between themes. Semantic tokens name a *role*, not a colour, and the role "the thing you press" is best served by orange on light and gold on dark.

## Theme switching

Both themes are first-class. Neither is an afterthought bolted on later, and **both are gated by the contrast validator** — a token that passes in light and fails in dark is a failure, not a compromise.

- **Default follows the device.** `prefers-color-scheme` decides on first load, so the app matches whatever the user's phone already does at that time of day.
- **A manual toggle overrides it**, reachable from every screen, and the choice **persists across reloads and app restarts**. A manager who prefers dark should not have to re-choose each morning.
- **No flash of the wrong theme.** The resolved theme is applied before first paint; a white flash on a dark phone at 11pm is exactly the kind of small thing that makes an app feel unfinished.
- Both themes are checked on a phone viewport and a tablet viewport before a UI change is done.

The counter tablet will usually sit in light mode — shops are bright and glare is the enemy — while manager and employee phones will often be dark. Both are real usage, not preference.

## Contrast rules

These are computed, not eyeballed, and they are enforced by a validator in CI rather than left to reviewer discipline.

**`#f97316` on white is 2.8:1.** It fails AA for text (4.5:1) and even misses the 3:1 non-text threshold. This single fact drives three rules:

1. **Orange is a fill, never text on a light background.** A primary button is orange with `#2b1d12` ink — **5.8:1**, comfortably AA.
2. **Brand-coloured text on light uses `--color-accent-text` (`#7f1d1d`).**
3. **Focus rings do not rely on orange alone.** The ring is 2px orange with a 1px dark offset ring outside it, so it stays visible against white cards, cream callouts, and coloured buttons alike. A single orange ring would disappear on exactly the surfaces it matters most on.

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

- **Money** renders through one formatter — paise in, `₹1,234` out, Indian digit grouping (`₹1,23,456`). Never format inline; never hand a float to a component.
- **Dates** render in Asia/Kolkata through one formatter. Business dates render as dates, never as timestamps.
- **Destructive actions** (void a bill, revoke a device) confirm, and say what will happen in plain words.
- **Empty states** say what to do next, not "No data".
- **Offline state is always visible** on billing screens — a pending-sync count, never a silent failure. See [Offline And Sync](OFFLINE_AND_SYNC.md).
- **Loading never blocks the counter.** Optimistic UI on the billing path; spinners are acceptable on manager screens.

## What we deliberately do not import from the marketing site

Flame gradients as surfaces, the animated marquee, scroll-driven motion, hero-scale type, and the paper-texture treatment. They are excellent at selling shawarma and actively harmful in a tool for counting money. The brand shows up here as colour, warmth, and the wordmark — not as atmosphere.
