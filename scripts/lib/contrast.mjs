/**
 * WCAG contrast maths and the token pairs the design system guarantees.
 *
 * Computed, not eyeballed. `#f97316` on white is 2.8:1 — it fails AA for text
 * and even misses the 3:1 non-text threshold, and that single fact drives
 * three rules in docs/DESIGN_SYSTEM.md. Rules that depend on arithmetic
 * nobody re-runs are rules that quietly stop being true.
 */

import { loadThemes } from './tokens.mjs'

export const AA_TEXT = 4.5
export const AA_NON_TEXT = 3

export function parseHex(hex) {
  const value = hex.trim().replace(/^#/, '')
  const expanded =
    value.length === 3 || value.length === 4
      ? [...value.slice(0, 3)].map((c) => c + c).join('')
      : value.slice(0, 6)

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) throw new Error(`Not a hex colour: "${hex}"`)

  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ]
}

/** Relative luminance, per WCAG 2.1. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The contract. Each entry is checked in BOTH themes — a token that passes in
 * light and fails in dark is a failure, not a compromise.
 *
 * `any` entries pass when ANY listed foreground clears the threshold. That is
 * not a loophole: it models indicators built from more than one layer, where a
 * single layer carrying the contrast is sufficient to identify the component.
 */
export const CHECKS = [
  { fg: '--content', bg: '--canvas', min: AA_TEXT, note: 'body text on the page' },
  { fg: '--content', bg: '--surface', min: AA_TEXT, note: 'body text on a card' },
  { fg: '--content', bg: '--surface-raised', min: AA_TEXT, note: 'body text in a callout' },
  { fg: '--content-muted', bg: '--canvas', min: AA_TEXT, note: 'labels on the page' },
  { fg: '--content-muted', bg: '--surface', min: AA_TEXT, note: 'labels on a card' },
  { fg: '--content-muted', bg: '--surface-raised', min: AA_TEXT, note: 'labels in a callout' },

  { fg: '--accent-text', bg: '--canvas', min: AA_TEXT, note: 'brand-coloured text on the page' },
  { fg: '--accent-text', bg: '--surface', min: AA_TEXT, note: 'brand-coloured text on a card' },
  { fg: '--accent-text', bg: '--surface-raised', min: AA_TEXT, note: 'brand text in a callout' },

  { fg: '--success', bg: '--canvas', min: AA_TEXT, note: 'success text on the page' },
  { fg: '--success', bg: '--surface', min: AA_TEXT, note: 'success text on a card' },
  { fg: '--success', bg: '--surface-raised', min: AA_TEXT, note: 'success text in a callout' },
  { fg: '--danger', bg: '--canvas', min: AA_TEXT, note: 'danger text on the page' },
  { fg: '--danger', bg: '--surface', min: AA_TEXT, note: 'danger text on a card' },
  { fg: '--danger', bg: '--surface-raised', min: AA_TEXT, note: 'danger text in a callout' },

  { fg: '--on-primary', bg: '--primary', min: AA_TEXT, note: 'label on a primary button' },
  { fg: '--on-warning', bg: '--warning', min: AA_TEXT, note: 'ink on warning — never white' },

  {
    fg: '--marker-veg',
    bg: '--surface',
    min: AA_NON_TEXT,
    note: 'veg marker (shape carries meaning too)',
  },
  {
    fg: '--marker-nonveg',
    bg: '--surface',
    min: AA_NON_TEXT,
    note: 'non-veg marker (shape carries meaning too)',
  },

  // The primary button's boundary must be identifiable against the page. In
  // light that comes from the ink border, not the orange fill (2.8:1); in dark
  // the gold fill carries it alone.
  {
    any: ['--primary', '--on-primary'],
    bg: '--surface',
    min: AA_NON_TEXT,
    note: 'primary button is distinguishable from the surface',
  },
  {
    any: ['--primary', '--on-primary'],
    bg: '--canvas',
    min: AA_NON_TEXT,
    note: 'primary button is distinguishable from the page',
  },

  // Focus rings never rely on orange alone: 2px brand ring plus a 1px darker
  // ring outside it, so the indicator survives white cards, cream callouts and
  // coloured buttons alike.
  {
    any: ['--focus-ring', '--focus-ring-outer'],
    bg: '--surface',
    min: AA_NON_TEXT,
    note: 'focus ring on a card',
  },
  {
    any: ['--focus-ring', '--focus-ring-outer'],
    bg: '--surface-raised',
    min: AA_NON_TEXT,
    note: 'focus ring on a callout',
  },
  {
    any: ['--focus-ring', '--focus-ring-outer'],
    bg: '--primary',
    min: AA_NON_TEXT,
    note: 'focus ring on a primary button',
  },
]

/**
 * Deliberately NOT gated, recorded here so the exemption is visible rather
 * than silent: `--border` is decorative structure, not a control boundary or a
 * state indicator, and the warm low-contrast border is a considered choice in
 * docs/DESIGN_SYSTEM.md. Any border that ever conveys state must move into
 * CHECKS above.
 */
export const UNGATED = ['--border against --surface (decorative structure only)']

/** @returns {{ results: Array, failures: Array }} every pair, both themes. */
export function validateTokens(themes = loadThemes()) {
  const results = []

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const check of CHECKS) {
      const background = tokens.get(check.bg)
      const foregrounds = check.any ?? [check.fg]
      const ratios = foregrounds.map((name) => ({
        name,
        value: tokens.get(name),
        ratio: contrastRatio(tokens.get(name), background),
      }))

      const best = ratios.reduce((a, b) => (b.ratio > a.ratio ? b : a))
      results.push({
        theme: themeName,
        label: `${foregrounds.join(' | ')} on ${check.bg}`,
        note: check.note,
        ratio: best.ratio,
        via: best.name,
        min: check.min,
        passed: best.ratio >= check.min,
      })
    }
  }

  return { results, failures: results.filter((result) => !result.passed) }
}
