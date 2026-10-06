import { describe, expect, it } from 'vitest'

import { findKeypadFaults } from './check-keypads.mjs'

/** A pad as the billing dialogs draw one, with each marking switchable. */
function pad({ digits = true, backspace = true, enter = true } = {}) {
  return `
    <div aria-label="Points keypad">
      {KEYS.map((key) => (
        <Button ${digits ? 'data-keypad-key={key}' : ''} onClick={() => append(key)}>{key}</Button>
      ))}
      <Button aria-label="Delete last digit" ${backspace ? 'data-keypad-key="Backspace"' : ''} />
    </div>
    <Button ${enter ? 'data-keypad-key="Enter"' : ''}>Use points</Button>
  `
}

describe('every number pad takes a physical keyboard', () => {
  it('passes a pad with every key marked', () => {
    expect(findKeypadFaults(pad())).toEqual([])
  })

  it('names what a new pad forgot', () => {
    expect(findKeypadFaults(pad({ digits: false, backspace: false, enter: false }))).toEqual([
      'its delete key is not marked data-keypad-key="Backspace"',
      'no action is marked data-keypad-key="Enter"',
      'its digit keys are not marked data-keypad-key',
    ])
  })

  it('finds a pad by its delete key even when nothing calls it a keypad', () => {
    const source = '<Button aria-label="Delete last digit" onClick={back} />'
    expect(findKeypadFaults(source)).toHaveLength(3)
  })

  it('leaves alone a file that draws no pad', () => {
    expect(findKeypadFaults('<Button onClick={save}>Save</Button>')).toEqual([])
  })
})
