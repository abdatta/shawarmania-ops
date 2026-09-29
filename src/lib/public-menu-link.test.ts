import { describe, expect, it } from 'vitest'

import {
  menuSlugFrom,
  menuSlugProblem,
  normaliseMenuSlug,
  publicMenuHost,
  publicMenuLink,
} from './public-menu-link'

describe('publicMenuLink', () => {
  it('builds the brand-site menu address for a slug', () => {
    expect(publicMenuLink('kalyani-cafe', 'https://shawarmania.in')).toBe(
      'https://shawarmania.in/menu/kalyani-cafe/',
    )
  })

  it('tolerates a configured base with a trailing slash', () => {
    expect(publicMenuLink('kalyani', 'http://127.0.0.1:8787/')).toBe(
      'http://127.0.0.1:8787/menu/kalyani/',
    )
  })

  it('has no link for an outlet without a slug', () => {
    expect(publicMenuLink(null)).toBeNull()
    expect(publicMenuLink('')).toBeNull()
  })

  it('shows the host a manager reads beside the field', () => {
    expect(publicMenuHost('https://shawarmania.in')).toBe('shawarmania.in/menu/')
  })
})

describe('menuSlugFrom', () => {
  it('derives the slug exactly as the database does', () => {
    // The same case as 64_the_menu_is_public.sql, so the two cannot drift apart.
    expect(menuSlugFrom('  Kalyani   Cafe & Grill! ')).toBe('kalyani-cafe-grill')
    expect(menuSlugFrom('!!!')).toBe('')
  })
})

describe('menuSlugProblem', () => {
  it('accepts what the database accepts, as it will be stored', () => {
    expect(normaliseMenuSlug('  Cafe-Adda ')).toBe('cafe-adda')
    expect(menuSlugProblem('  Cafe-Adda ')).toBeNull()
    expect(menuSlugProblem('kalyani2')).toBeNull()
  })

  it('leaves a blank alone, because blank means derive or keep', () => {
    expect(menuSlugProblem('   ')).toBeNull()
  })

  it('refuses what the database would refuse', () => {
    expect(menuSlugProblem('cafe adda')).toMatch(/single hyphens/)
    expect(menuSlugProblem('cafe--adda')).toMatch(/single hyphens/)
    expect(menuSlugProblem('-cafe')).toMatch(/single hyphens/)
    expect(menuSlugProblem('a'.repeat(61))).toMatch(/at most 60/)
  })
})
