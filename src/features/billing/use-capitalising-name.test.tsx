import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NAME_PAUSE_MS, useCapitalisingName } from './use-capitalising-name'

/**
 * The counter's name field correcting itself as each word is finished
 * (a-customer-name-is-capitalised, design D2).
 *
 * **The cursor never moves** [owner, 2026-11-23] outranks everything else here,
 * so it is tested twice: once per guard the design names, and then as an
 * invariant over generated typing, against the same steps typed into a field
 * that corrects nothing.
 *
 * The keyboard is simulated the way a browser delivers a keystroke: the value
 * and the caret change first, then `input` fires. A correction then has to put
 * the caret back itself, because setting an input's value from code throws the
 * caret to the end, in jsdom as in a browser.
 */

let saved: (() => string) | null = null

/** The hook on a bare input, `on`; or the field as it is today, off. */
function Field({ initial = '', on = true }: { initial?: string; on?: boolean }) {
  const [name, setName] = useState(initial)
  const capitalising = useCapitalisingName(name, setName)
  // Handed out after each render, as a confirm button would call it.
  useEffect(() => {
    saved = capitalising.savedName
  })
  return on ? (
    <input aria-label="name" {...capitalising.field} />
  ) : (
    <input aria-label="name" value={name} onChange={(event) => setName(event.target.value)} />
  )
}

function mount(options: { initial?: string; on?: boolean } = {}) {
  render(<Field {...options} />)
  const field = screen.getByLabelText<HTMLInputElement>('name')
  act(() => field.focus())
  return field
}

const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

/** Puts `text` where the selection is, as a keystroke or a paste does. */
function insert(field: HTMLInputElement, text: string) {
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const next = field.value.slice(0, start) + text + field.value.slice(end)
  act(() => {
    setNativeValue.call(field, next)
    field.setSelectionRange(start + text.length, start + text.length)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Types a string one key at a time. */
function type(field: HTMLInputElement, text: string) {
  for (const character of text) insert(field, character)
}

function backspace(field: HTMLInputElement, times = 1) {
  for (let i = 0; i < times; i += 1) {
    const start = field.selectionStart ?? 0
    const end = field.selectionEnd ?? start
    if (start === end && start === 0) continue
    const from = start === end ? start - 1 : start
    const next = field.value.slice(0, from) + field.value.slice(end)
    act(() => {
      setNativeValue.call(field, next)
      field.setSelectionRange(from, from)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

function deleteForward(field: HTMLInputElement) {
  const start = field.selectionStart ?? 0
  const end = field.selectionEnd ?? start
  if (start === end && end === field.value.length) return
  const to = start === end ? end + 1 : end
  const next = field.value.slice(0, start) + field.value.slice(to)
  act(() => {
    setNativeValue.call(field, next)
    field.setSelectionRange(start, start)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function caret(field: HTMLInputElement, at: number) {
  act(() => field.setSelectionRange(at, at))
}

function select(
  field: HTMLInputElement,
  start: number,
  end: number,
  direction: 'forward' | 'backward' | 'none',
) {
  act(() => field.setSelectionRange(start, end, direction))
}

function pause(ms = NAME_PAUSE_MS + 100) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function composition(field: HTMLInputElement, phase: 'start' | 'end') {
  act(() => {
    field.dispatchEvent(new CompositionEvent(`composition${phase}`, { bubbles: true }))
  })
}

function selection(field: HTMLInputElement) {
  return [field.selectionStart, field.selectionEnd, field.selectionDirection] as const
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  saved = null
  vi.useRealTimers()
})

describe('useCapitalisingName', () => {
  it('corrects the word before a space as the space is typed', () => {
    const field = mount()
    type(field, 'rahul')
    expect(field).toHaveValue('rahul')
    type(field, ' ')
    expect(field).toHaveValue('Rahul ')
    expect(selection(field)).toEqual([6, 6, 'none'])
  })

  it('corrects the word at the cursor after a pause, and not before', () => {
    const field = mount()
    type(field, 'rahul das')
    pause(NAME_PAUSE_MS - 100)
    expect(field).toHaveValue('Rahul das')
    pause(200)
    expect(field).toHaveValue('Rahul Das')
    expect(selection(field)).toEqual([9, 9, 'none'])
  })

  it('saves the capitalised name on confirm, trimmed and with single spaces', () => {
    const field = mount()
    type(field, '  rahul   das ')
    expect(saved?.()).toBe('Rahul Das')
    type(field, 'MD rahim')
    expect(saved?.()).toBe('Rahul Das MD Rahim')
  })

  it('judges a word from what was typed for it, so RAH, a pause and UL reads Rahul', () => {
    const field = mount()
    type(field, 'RAH')
    pause()
    expect(field).toHaveValue('Rah')
    type(field, 'UL')
    expect(field).toHaveValue('RahUL')
    // Confirming before the pause still judges the whole word as typed.
    expect(saved?.()).toBe('Rahul')
    pause()
    expect(field).toHaveValue('Rahul')
  })

  it('leaves mixed case and two-letter capitals as typed', () => {
    const field = mount()
    type(field, "McKenzie d'Souza MD rahim")
    pause()
    expect(field).toHaveValue("McKenzie d'Souza MD Rahim")
    expect(saved?.()).toBe("McKenzie d'Souza MD Rahim")
  })

  it('stops correcting for good once the biller backspaces into a corrected word', () => {
    const field = mount()
    type(field, 'SANJAY')
    pause()
    expect(field).toHaveValue('Sanjay')
    backspace(field, 5)
    type(field, 'ANJAY')
    pause()
    expect(field).toHaveValue('SANJAY')
    type(field, ' das ')
    pause()
    expect(field).toHaveValue('SANJAY das ')
    // Confirm too: exactly what the field shows, trimmed.
    expect(saved?.()).toBe('SANJAY das')
  })

  it('stops correcting once the biller types inside a corrected word', () => {
    const field = mount()
    type(field, 'rahul ')
    expect(field).toHaveValue('Rahul ')
    caret(field, 2)
    type(field, 'H')
    expect(field).toHaveValue('RaHhul ')
    caret(field, 7)
    type(field, 'das ')
    expect(field).toHaveValue('RaHhul das ')
    expect(saved?.()).toBe('RaHhul das')
  })

  it('does not stop when only the space after a corrected word is deleted', () => {
    const field = mount()
    type(field, 'rahul ')
    expect(field).toHaveValue('Rahul ')
    backspace(field)
    expect(field).toHaveValue('Rahul')
    type(field, ' das')
    pause()
    expect(field).toHaveValue('Rahul Das')
    expect(saved?.()).toBe('Rahul Das')
  })

  it('carries on correcting after a typo is fixed in a word it has not corrected', () => {
    const field = mount()
    type(field, 'rahk')
    backspace(field)
    type(field, 'ul ')
    expect(field).toHaveValue('Rahul ')
    type(field, 'dsa')
    caret(field, 7)
    type(field, 'a')
    caret(field, 10)
    backspace(field)
    pause()
    expect(field).toHaveValue('Rahul Das')
  })

  it('corrects a paste at the next pause', () => {
    const field = mount()
    insert(field, 'rahul das')
    expect(field).toHaveValue('rahul das')
    pause()
    expect(field).toHaveValue('Rahul Das')
  })

  it('treats a name the box opens with as typed', () => {
    mount({ initial: 'table four' })
    expect(saved?.()).toBe('Table Four')
  })

  it('changes nothing with the field as it is today', () => {
    const field = mount({ on: false })
    type(field, 'rahul das ')
    pause()
    expect(field).toHaveValue('rahul das ')
  })
})

describe('useCapitalisingName never moves the cursor', () => {
  it('keeps the selection, its direction included, through a correction', () => {
    const field = mount()
    type(field, 'rahul')
    select(field, 5, 5, 'backward')
    pause()
    expect(field).toHaveValue('Rahul')
    expect(selection(field)).toEqual([5, 5, 'backward'])
  })

  it('puts the caret back where it was when a space mid-text corrects the word behind it', () => {
    const field = mount()
    type(field, 'rahuldas')
    caret(field, 5)
    type(field, ' ')
    // Only the word behind the cursor; the one after it is untouched.
    expect(field).toHaveValue('Rahul das')
    expect(selection(field)).toEqual([6, 6, 'none'])
    type(field, 'k')
    expect(field).toHaveValue('Rahul kdas')
    expect(selection(field)).toEqual([7, 7, 'none'])
  })

  it('drops a correction when a keystroke lands between the decision and the change', () => {
    const field = mount()
    type(field, 'rahul')
    // The key is in the field, and its event has not been handled yet.
    act(() => {
      setNativeValue.call(field, 'rahulx')
      field.setSelectionRange(6, 6)
    })
    pause()
    expect(field).toHaveValue('rahulx')
    expect(selection(field)).toEqual([6, 6, 'none'])
    act(() => {
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field).toHaveValue('rahulx')
    pause()
    expect(field).toHaveValue('Rahulx')
  })

  it('changes nothing while the keyboard is composing', () => {
    const field = mount()
    composition(field, 'start')
    type(field, 'rahul ')
    pause()
    expect(field).toHaveValue('rahul ')
    composition(field, 'end')
    pause()
    expect(field).toHaveValue('Rahul ')
  })

  it('never corrects the word being composed, until the composition ends', () => {
    const field = mount()
    type(field, 'rahul ')
    expect(field).toHaveValue('Rahul ')
    composition(field, 'start')
    type(field, 'das')
    pause()
    expect(field).toHaveValue('Rahul das')
    composition(field, 'end')
    pause()
    expect(field).toHaveValue('Rahul Das')
    expect(selection(field)).toEqual([9, 9, 'none'])
  })

  it('does nothing at a pause with the cursor inside the text', () => {
    const field = mount()
    type(field, 'rahul das')
    caret(field, 2)
    pause()
    expect(field).toHaveValue('Rahul das')
    expect(selection(field)).toEqual([2, 2, 'none'])
  })

  it('does nothing at a pause with text selected', () => {
    const field = mount()
    type(field, 'rahul das')
    select(field, 6, 9, 'forward')
    pause()
    expect(field).toHaveValue('Rahul das')
    expect(selection(field)).toEqual([6, 9, 'forward'])
  })

  it('does nothing at a pause once the field has lost focus', () => {
    const field = mount()
    type(field, 'rahul das')
    act(() => field.blur())
    pause()
    expect(field).toHaveValue('Rahul das')
    // Confirm still saves it capitalised.
    expect(saved?.()).toBe('Rahul Das')
  })

  /*
    The invariant (task 3.1a). A generated run of keystrokes, spaces, pauses,
    cursor moves, selections, compositions, backspaces and pastes is typed into
    a field that corrects nothing, and then into one that does. After every
    step the caret and selection must be exactly where they are without
    correction, and the text the same apart from case. Seeded, so a failure
    names a run that replays.

    A failure here is fixed by skipping the correction, never by loosening the
    assertion.
  */
  const RUNS = 1000

  it(`holds over ${RUNS} generated typing runs`, () => {
    let corrected = 0
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const steps = generate(seed)
      const off = replay(steps, false)
      const on = replay(steps, true)
      for (let index = 0; index < steps.length; index += 1) {
        const where = `seed ${seed}, step ${index} (${describeStep(steps[index]!)})`
        expect(on[index]!.selection, where).toEqual(off[index]!.selection)
        expect(
          sameButCase(on[index]!.value, off[index]!.value),
          `${where}: ${on[index]!.value} vs ${off[index]!.value}`,
        ).toBe(true)
      }
      if (on.some((state, index) => state.value !== off[index]!.value)) corrected += 1
    }
    // Not vacuous: most runs really did have something corrected.
    expect(corrected).toBeGreaterThan(RUNS / 2)
    // A thousand runs of up to fifty steps, each rendered twice.
  }, 300_000)
})

type Step =
  | { kind: 'type'; text: string }
  | { kind: 'paste'; text: string }
  | { kind: 'backspace' }
  | { kind: 'delete' }
  | { kind: 'caret'; at: number }
  | { kind: 'select'; from: number; to: number; direction: 'forward' | 'backward' | 'none' }
  | { kind: 'pause'; ms: number }
  | { kind: 'composition'; phase: 'start' | 'end' }
  | { kind: 'race'; text: string }

function describeStep(step: Step): string {
  return JSON.stringify(step)
}

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LETTERS = 'abcdefghijklmnoprstuyABDHKMRSUY'
const ODD = ["'", '-', '.', '8', 'ß', 'İ', 'রা', 'é']
const WORDS = ['rahul', 'DAS', 'rAHUL', 'md', 'SK', "d'souza", 'McKenzie', 'ram-prasad', 'straße']

/**
 * Positions are fractions here and resolved against the field when the step
 * runs, so the same step lands in the same place in both runs.
 */
function generate(seed: number): Step[] {
  const next = random(seed)
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  const steps: Step[] = []
  const length = 8 + Math.floor(next() * 40)
  for (let i = 0; i < length; i += 1) {
    const roll = next()
    if (roll < 0.42)
      steps.push({ kind: 'type', text: next() < 0.93 ? pick([...LETTERS]) : pick(ODD) })
    else if (roll < 0.56) steps.push({ kind: 'type', text: ' ' })
    else if (roll < 0.64)
      steps.push({ kind: 'pause', ms: next() < 0.75 ? 1000 : Math.floor(next() * 900) })
    else if (roll < 0.71) steps.push({ kind: 'backspace' })
    else if (roll < 0.73) steps.push({ kind: 'delete' })
    else if (roll < 0.79) steps.push({ kind: 'caret', at: next() })
    else if (roll < 0.83) {
      const a = next()
      const b = next()
      steps.push({
        kind: 'select',
        from: Math.min(a, b),
        to: Math.max(a, b),
        direction: pick(['forward', 'backward', 'none'] as const),
      })
    } else if (roll < 0.88)
      steps.push({ kind: 'composition', phase: next() < 0.5 ? 'start' : 'end' })
    else if (roll < 0.93)
      steps.push({ kind: 'paste', text: `${pick(WORDS)}${next() < 0.5 ? ` ${pick(WORDS)}` : ''}` })
    else if (roll < 0.96) steps.push({ kind: 'race', text: pick([...LETTERS, ' ']) })
    else steps.push({ kind: 'caret', at: 1 })
  }
  return steps
}

interface State {
  value: string
  selection: readonly [number | null, number | null, string | null]
}

function replay(steps: readonly Step[], on: boolean): State[] {
  const field = mount({ on })
  const states: State[] = []
  for (const step of steps) {
    const length = field.value.length
    switch (step.kind) {
      case 'type':
        insert(field, step.text)
        break
      case 'paste':
        insert(field, step.text)
        break
      case 'backspace':
        backspace(field)
        break
      case 'delete':
        deleteForward(field)
        break
      case 'caret':
        caret(field, Math.round(step.at * length))
        break
      case 'select':
        select(field, Math.round(step.from * length), Math.round(step.to * length), step.direction)
        break
      case 'pause':
        pause(step.ms)
        break
      case 'composition':
        composition(field, step.phase)
        break
      case 'race': {
        // A key reaches the field just as a pause ends, and its event is
        // handled only after the timer has had its chance.
        const start = field.selectionStart ?? length
        const end = field.selectionEnd ?? start
        act(() => {
          setNativeValue.call(
            field,
            field.value.slice(0, start) + step.text + field.value.slice(end),
          )
          field.setSelectionRange(start + step.text.length, start + step.text.length)
        })
        pause(1000)
        act(() => {
          field.dispatchEvent(new Event('input', { bubbles: true }))
        })
        break
      }
    }
    states.push({ value: field.value, selection: selection(field) })
  }
  cleanup()
  return states
}

/** The same text, character for character, apart from case. */
function sameButCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i] && a[i]!.toLowerCase() !== b[i]!.toLowerCase()) return false
  }
  return true
}
