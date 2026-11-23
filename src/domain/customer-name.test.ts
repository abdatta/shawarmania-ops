import { describe, expect, it } from 'vitest'

import { capitalisedName, capitalisedWord, capitalisedWords } from './customer-name'

/**
 * The rule a customer's name is capitalised by (a-customer-name-is-capitalised,
 * design D1). Every row of the design's table, and the edges a field corrected
 * while somebody types beside it cannot afford to get wrong.
 */

describe('capitalisedName', () => {
  it.each([
    ['rahul das', 'Rahul Das', 'lowercase words'],
    ['RAHUL DAS', 'Rahul Das', 'all-capitals words'],
    ['rAHUL', 'Rahul', 'a caps-lock word'],
    ['MD rahim', 'MD Rahim', 'two capitals are likely initials'],
    ['md rahim', 'Md Rahim', 'lowercase words, however short'],
    ['RAJ kumar', 'Raj Kumar', 'word by word'],
    ['McKenzie', 'McKenzie', 'mixed case is meant'],
    ["d'Souza", "d'Souza", 'mixed case is meant'],
    ['MOhan', 'MOhan', 'mixed case is meant'],
    ['SK ABDUL', 'SK Abdul', 'initials beside a capitals word'],
    ["d'souza", "D'Souza", 'initcap boundary'],
    ['রাহুল', 'রাহুল', 'no cased letters'],
  ])('%s reads %s (%s)', (typed, saved) => {
    expect(capitalisedName(typed)).toBe(saved)
  })

  it('is empty for an empty or blank name', () => {
    expect(capitalisedName('')).toBe('')
    expect(capitalisedName('   ')).toBe('')
    expect(capitalisedName('\t \n')).toBe('')
  })

  it('leaves digits alone', () => {
    expect(capitalisedName('1234')).toBe('1234')
    expect(capitalisedName('flat 23')).toBe('Flat 23')
  })

  it('trims and collapses spaces, and only on the saved name', () => {
    expect(capitalisedName('  rahul   das  ')).toBe('Rahul Das')
    expect(capitalisedWords('  rahul   das  ')).toBe('  Rahul   Das  ')
  })

  it('leaves a name that already reads right unchanged', () => {
    for (const name of ['Rahul Das', 'Sk Abdul', 'MD Rahim', "D'Souza", 'A Kumar', 'Ritika Sen']) {
      expect(capitalisedName(name)).toBe(name)
    }
  })

  it('treats a lone one- or two-letter word by the same rule', () => {
    expect(capitalisedName('aa')).toBe('Aa')
    expect(capitalisedName('AA')).toBe('AA')
    expect(capitalisedName('a')).toBe('A')
    expect(capitalisedName('A')).toBe('A')
  })
})

describe('capitalisedWord', () => {
  it('starts a capital after anything that is not a letter or a digit', () => {
    expect(capitalisedWord('a.kumar')).toBe('A.Kumar')
    expect(capitalisedWord('ram-prasad')).toBe('Ram-Prasad')
    expect(capitalisedWord('a8aaa')).toBe('A8aaa')
    expect(capitalisedWord('RAM-PRASAD')).toBe('Ram-Prasad')
  })

  it('takes the caps-lock shape only with two or more capitals after the small letter', () => {
    expect(capitalisedWord('rAH')).toBe('Rah')
    expect(capitalisedWord('mD')).toBe('mD')
    expect(capitalisedWord('rAhUL')).toBe('rAhUL')
  })

  it('leaves alone a word whose case mapping would change its length', () => {
    // `ß` uppercases to `SS` and a dotted `İ` lowercases to two code units: a
    // correction there would shift every character after it.
    expect(capitalisedWord('straße')).toBe('straße')
    expect(capitalisedWord('ßara')).toBe('ßara')
    expect(capitalisedWord('İSTANBUL')).toBe('İSTANBUL')
    expect(capitalisedName('straße rahul')).toBe('straße Rahul')
  })

  it('leaves alone a word with a titlecase letter', () => {
    expect(capitalisedWord('ǅemal')).toBe('ǅemal')
  })

  it('changes case only, character for character', () => {
    const words = ['rahul', 'RAHUL', 'rAHUL', "d'souza", 'éMILE', 'josé', 'ÅSA', 'ñandu']
    for (const word of words) {
      const result = capitalisedWord(word)
      expect(result).toHaveLength(word.length)
      expect(result.toLowerCase()).toBe(word.toLowerCase())
    }
  })

  it('keeps every space where it is in a field’s worth of text', () => {
    const text = ' rahul  DAS mD  '
    const result = capitalisedWords(text)
    expect(result).toBe(' Rahul  Das mD  ')
    expect(result).toHaveLength(text.length)
  })
})
