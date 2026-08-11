import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  beginWrite,
  declareUnsavedWork,
  isOccupied,
  occupancyReason,
  resetOccupancy,
  watchTypedWork,
} from './occupancy'

/**
 * The rules that decide whether a new build may be taken now.
 *
 * The thresholds are a judgement, so these tests pin the judgement rather than
 * the arithmetic: one short entry is cheap and must not hold a build back, a
 * page full of half-finished typing is not, and work that is not typing at all
 * has to be able to say so.
 */

const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

/** A real element in the real document — the listener is on `document`. */
function typeInto(value: string, tag: 'input' | 'textarea' = 'input') {
  const element = document.createElement(tag)
  document.body.appendChild(element)
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  return element
}

describe('occupancy', () => {
  let stopWatching: () => void

  beforeEach(() => {
    resetOccupancy()
    setOnLine(true)
    stopWatching = watchTypedWork()
  })

  afterEach(() => {
    stopWatching()
    resetOccupancy()
    document.body.innerHTML = ''
    if (originalOnLine) Object.defineProperty(Navigator.prototype, 'onLine', originalOnLine)
  })

  it('treats an untouched page as free', () => {
    expect(isOccupied()).toBe(false)
  })

  it('does not hold a build back for one short entry', () => {
    // A search box or a filter. Retyping it costs nothing, and making it defer
    // an update is exactly the noise the threshold exists to absorb.
    typeInto('kebab')

    expect(isOccupied()).toBe(false)
  })

  it('does not hold a build back for two short entries', () => {
    typeInto('Ravi')
    typeInto('9800000000')

    expect(isOccupied()).toBe(false)
  })

  it('holds a build back once three fields have been typed into', () => {
    typeInto('Ravi')
    typeInto('9800000000')
    typeInto('cash')

    expect(occupancyReason()).toBe('typing')
  })

  it('holds a build back for a single long entry', () => {
    // One field, but a written reason. Field count alone would call this cheap.
    typeInto(
      'Voided because the customer changed their order after the bill was rung up.',
      'textarea',
    )

    expect(occupancyReason()).toBe('typing')
  })

  it('releases a build when the typing is cleared', () => {
    const first = typeInto('Ravi')
    const second = typeInto('9800000000')
    const third = typeInto('cash')
    expect(isOccupied()).toBe(true)

    for (const element of [first, second, third]) {
      element.value = ''
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }

    expect(isOccupied()).toBe(false)
  })

  it('releases a build when the fields leave the page', () => {
    // A drawer closing emits no event, so the count has to be pruned against
    // the live document rather than maintained by subtraction.
    typeInto('Ravi')
    typeInto('9800000000')
    typeInto('cash')
    expect(isOccupied()).toBe(true)

    document.body.innerHTML = ''

    expect(isOccupied()).toBe(false)
  })

  it('lets a surface declare work that is not typing at all', () => {
    // The bill composer. An order lives in state and renders no control, so
    // nothing generic can see it.
    const release = declareUnsavedWork('billing-composer')
    expect(occupancyReason()).toBe('declared')

    release()
    expect(isOccupied()).toBe(false)
  })

  it('ignores a declaration released twice', () => {
    const release = declareUnsavedWork('billing-composer')
    release()
    release()

    expect(isOccupied()).toBe(false)
  })

  it('holds a build back while a write is in flight', () => {
    const settle = beginWrite()
    expect(occupancyReason()).toBe('writing')

    settle()
    expect(isOccupied()).toBe(false)
  })

  it('does not double-count a write settled twice', () => {
    const settle = beginWrite()
    const other = beginWrite()
    settle()
    settle()

    expect(occupancyReason()).toBe('writing')
    other()
    expect(isOccupied()).toBe(false)
  })

  it('never treats a disconnected device as free', () => {
    // A reload without a backend costs a counter its right to resume billing,
    // which no amount of an empty screen makes safe.
    setOnLine(false)

    expect(occupancyReason()).toBe('offline')
  })

  it('stops counting typing after the watch is disposed', () => {
    stopWatching()

    typeInto('Ravi')
    typeInto('9800000000')
    typeInto('cash')

    expect(isOccupied()).toBe(false)
    stopWatching = watchTypedWork()
  })
})
