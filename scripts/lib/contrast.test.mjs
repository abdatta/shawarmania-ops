// @vitest-environment node
//
// These exercise build tooling that reads files off disk. Under jsdom,
// import.meta.url is rewritten to an http URL and fileURLToPath rejects it.

import { describe, expect, it } from 'vitest'

import { AA_NON_TEXT, AA_TEXT, contrastRatio, validateTokens } from './contrast.mjs'
import { loadThemes } from './tokens.mjs'

/**
 * The known-bad pairs are pinned rather than merely documented: they are the
 * arithmetic the whole design system is built around, and a validator that
 * stopped catching them would pass silently.
 */
describe('the brand facts that drive the contrast rules', () => {
  it('the brand orange on white fails AA for text and misses even the non-text threshold', () => {
    const ratio = contrastRatio('#f97316', '#ffffff')
    expect(ratio).toBeCloseTo(2.83, 1)
    expect(ratio).toBeLessThan(AA_NON_TEXT)
  })

  it('the light-theme danger red fails on the dark canvas', () => {
    const ratio = contrastRatio('#b91c1c', '#0c0a09')
    expect(ratio).toBeLessThan(AA_TEXT)
  })

  it('the veg green fails as text on the light canvas', () => {
    expect(contrastRatio('#16a34a', '#fafaf9')).toBeLessThan(AA_TEXT)
  })

  it('the usual warm grey clears AA for labels by only a hair', () => {
    // 4.59:1 against the canvas — it passes, but a 0.09 margin means any
    // future canvas tweak silently breaks it. Hence the deepened value below.
    const ratio = contrastRatio('#78716c', '#fafaf9')
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT)
    expect(ratio).toBeLessThan(4.7)
  })
})

describe('the prescribed substitutes', () => {
  it('the ember carries white text, so the primary button needs no border', () => {
    expect(contrastRatio('#ffffff', '#c2410c')).toBeGreaterThanOrEqual(AA_TEXT)
    // And the fill identifies its own boundary against a card.
    expect(contrastRatio('#c2410c', '#ffffff')).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it('the brand orange needs no deepening on a dark ground', () => {
    expect(contrastRatio('#f97316', '#1c1917')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the lightened red clears AA on the dark canvas', () => {
    expect(contrastRatio('#f87171', '#0c0a09')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the deepened green clears AA on the light canvas', () => {
    expect(contrastRatio('#15803d', '#fafaf9')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the deepened ember is the brand-coloured text colour on light', () => {
    expect(contrastRatio('#9a3412', '#fafaf9')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the deepened warm grey clears AA for labels', () => {
    expect(contrastRatio('#6f6862', '#fafaf9')).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('contrastRatio', () => {
  it('is symmetric and bounded', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#7f1d1d', '#7f1d1d')).toBeCloseTo(1, 5)
  })

  it('accepts shorthand hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
  })

  it('rejects a value that is not a colour', () => {
    expect(() => contrastRatio('rebeccapurple', '#fff')).toThrow()
  })
})

describe('the token file itself', () => {
  it('resolves every semantic token in both themes', () => {
    const { light, dark } = loadThemes()
    for (const theme of [light, dark]) {
      for (const name of ['--canvas', '--surface', '--content', '--primary', '--focus-ring']) {
        expect(theme.get(name)).toMatch(/^#[0-9a-f]{3,8}$/i)
      }
    }
    // The deliberate difference: the deepened ember on light, the brand
    // orange at full strength on dark. Each is what clears AA on its ground.
    expect(light.get('--primary')).toBe('#c2410c')
    expect(dark.get('--primary')).toBe('#f97316')
  })

  it('the primary button carries its own boundary, with no border workaround', () => {
    const { results } = validateTokens()
    const buttonChecks = results.filter((r) => r.label.startsWith('--primary | --on-primary'))
    expect(buttonChecks.length).toBeGreaterThan(0)
    // Passing "via --on-primary" would mean the fill is illegible and a border
    // is propping it up — the situation the ember was chosen to remove.
    for (const check of buttonChecks) {
      expect(check.passed).toBe(true)
      expect(check.via).toBe('--primary')
    }
  })

  it('passes every gated pair in both themes', () => {
    const { results, failures } = validateTokens()
    expect(failures).toEqual([])
    expect(results.length).toBeGreaterThan(0)
    expect(new Set(results.map((r) => r.theme))).toEqual(new Set(['light', 'dark']))
  })

  it('catches a regression introduced into the token file', () => {
    const { light, dark } = loadThemes()
    // Orange as *text* on light is exactly rule 1's violation.
    light.set('--accent-text', '#f97316')
    const { failures } = validateTokens({ light, dark })
    expect(failures.some((f) => f.theme === 'light' && f.label.includes('--accent-text'))).toBe(
      true,
    )
  })
})
