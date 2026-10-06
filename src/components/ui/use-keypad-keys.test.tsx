import { describe, expect, it } from 'vitest'

import { keypadGaps } from './use-keypad-keys'

/**
 * The guard that keeps every number pad reachable from a physical keyboard
 * (keypads-take-a-physical-keyboard). It recognises a pad by its ten digit
 * buttons, so a pop-up added later is held to it whatever it calls its pad.
 */
function dialogWith(html: string): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  dialog.innerHTML = html
  document.body.append(dialog)
  return dialog
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const marked = (digit: string) => `<button data-keypad-key="${digit}">${digit}</button>`
const plain = (digit: string) => `<button>${digit}</button>`
const ACTIONS =
  '<button data-keypad-key="Backspace" aria-label="Delete last digit"></button>' +
  '<button data-keypad-key="Enter">Apply</button>'

describe('keypadGaps', () => {
  it('passes a pad whose every key is marked', () => {
    expect(keypadGaps(dialogWith(DIGITS.map(marked).join('') + ACTIONS))).toEqual([])
  })

  it('names each key a new pad forgot', () => {
    const pad = DIGITS.map((digit) => (digit === '7' ? plain(digit) : marked(digit))).join('')
    expect(keypadGaps(dialogWith(pad))).toEqual([
      'the 7 key is not marked data-keypad-key="7"',
      'no button is marked data-keypad-key="Backspace"',
      'no button is marked data-keypad-key="Enter"',
    ])
  })

  it('leaves alone a dialog with no pad, such as a row of single-digit days', () => {
    const days = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(plain).join('')
    expect(keypadGaps(dialogWith(days + '<button>OK</button>'))).toEqual([])
  })

  it('holds a pad to its own dialog, not to one nested inside it', () => {
    const outer = dialogWith('<button>Open</button>')
    const inner = document.createElement('dialog')
    inner.innerHTML = DIGITS.map(plain).join('')
    outer.append(inner)
    expect(keypadGaps(outer)).toEqual([])
    expect(keypadGaps(inner)).toHaveLength(12)
  })
})
