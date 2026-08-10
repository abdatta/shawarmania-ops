import { describe, expect, it } from 'vitest'

import { foldCategory, matchCategory } from './category-match'

const MENU = ['Shawarma', 'Burgers', 'Salads', 'Rolls', 'Cold Coffee', 'Non-Veg Platter']

function names(typed: string, existing: readonly string[] = MENU): string[] {
  return matchCategory(typed, existing).map(({ name }) => name)
}

describe('foldCategory', () => {
  it.each([
    ['  Cold   Coffee ', 'cold coffee'],
    ['Non-Veg', 'non veg'],
    ['Café', 'cafe'],
    ['BURGERS', 'burgers'],
    ["Owner's Picks", 'owner s picks'],
  ])('folds %j to %j', (input, expected) => {
    expect(foldCategory(input)).toBe(expected)
  })
})

describe('matchCategory', () => {
  it('offers nothing when the typed category resembles none of them', () => {
    expect(names('Beverages')).toEqual([])
    expect(names('Desserts')).toEqual([])
  })

  it('offers nothing against an empty list, which is a new outlet', () => {
    expect(names('Shawarma', [])).toEqual([])
  })

  it('ignores blank and whitespace-only input', () => {
    expect(names('   ')).toEqual([])
  })

  it('catches a dropped letter', () => {
    expect(names('Shwarma')).toEqual(['Shawarma'])
  })

  it('catches a transposition, which is one slip rather than two errors', () => {
    expect(names('Bugrers')).toEqual(['Burgers'])
  })

  it('catches a word mangled several times over, once the first letter agrees', () => {
    expect(names('shwarnm')).toEqual(['Shawarma'])
    expect(names('Burgurz')).toEqual(['Burgers'])
  })

  it('withholds that latitude when the word starts differently', () => {
    // "Bowls" is two edits from "Rolls" and is a different word. The same two
    // edits inside a word that started right would have been offered.
    expect(names('Bowls')).toEqual([])
  })

  it('catches a singular beside a plural, and a plural beside a singular', () => {
    expect(matchCategory('Burger', MENU)).toEqual([{ name: 'Burgers', reason: 'plural' }])
    expect(matchCategory('Saladss', MENU)[0]?.name).toBe('Salads')
  })

  it('catches a y-to-ies plural', () => {
    expect(matchCategory('Fry', ['Fries'])).toEqual([{ name: 'Fries', reason: 'plural' }])
  })

  it('catches a name that differs only by case, accent, punctuation or spacing', () => {
    expect(matchCategory('non veg platter', MENU)).toEqual([
      { name: 'Non-Veg Platter', reason: 'same' },
    ])
    expect(matchCategory('COLD  COFFEE', MENU)).toEqual([{ name: 'Cold Coffee', reason: 'same' }])
  })

  it('catches one name sitting inside another, in either direction', () => {
    expect(matchCategory('Coffee', MENU)).toEqual([{ name: 'Cold Coffee', reason: 'contains' }])
    expect(matchCategory('Cold Coffee Specials', MENU)).toEqual([
      { name: 'Cold Coffee', reason: 'contains' },
    ])
  })

  it('catches a misspelt word inside a longer name', () => {
    expect(matchCategory('Platter', MENU)).toEqual([
      { name: 'Non-Veg Platter', reason: 'contains' },
    ])
    expect(matchCategory('Plater', MENU)).toEqual([{ name: 'Non-Veg Platter', reason: 'contains' }])
  })

  it('holds short words tight, where almost everything is within one edit', () => {
    expect(matchCategory('Tea', ['Sea'])).toEqual([])
    expect(matchCategory('Tea', ['Ted'])).toEqual([])
  })

  it('reads the likeliest reason first', () => {
    const matches = matchCategory('Roll', ['Rolls', 'Chicken Roll Basket', 'Rols'])
    expect(matches.map(({ reason }) => reason)).toEqual(['plural', 'typo', 'contains'])
  })

  it('folds duplicate spellings in the existing list down to the first', () => {
    expect(names('Burger', ['Burgers', 'BURGERS'])).toEqual(['Burgers'])
  })

  it('caps what it offers, because a long list is not a decision', () => {
    const crowd = ['Roll', 'Rolls', 'Rols', 'Roll s', 'Rolle', 'Rolla', 'Rollz']
    expect(matchCategory('Rolls', crowd, 3)).toHaveLength(3)
  })
})
