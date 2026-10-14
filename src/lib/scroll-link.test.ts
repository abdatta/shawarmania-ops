import { expect, it } from 'vitest'

import { createScrollLink } from './scroll-link'

/** A scroller jsdom cannot lay out: a reach, a position, and a count of writes to it. */
function scroller(reach: number) {
  const element = document.createElement('div')
  let left = 0
  let writes = 0
  Object.defineProperty(element, 'clientWidth', { value: 400 })
  Object.defineProperty(element, 'scrollWidth', { value: 400 + reach })
  Object.defineProperty(element, 'scrollLeft', {
    get: () => left,
    set: (value: number) => {
      writes++
      left = Math.max(0, Math.min(value, reach))
    },
  })
  /** The finger moves it: the browser's own scroll, not a write by the link. */
  const swipe = (to: number) => {
    left = to
    element.dispatchEvent(new Event('scroll'))
  }
  return { element, swipe, writes: () => writes }
}

it('moves the other scroller and never writes to the one being swiped', () => {
  const link = createScrollLink()
  const work = scroller(600)
  const records = scroller(600)
  link.attach(work.element)
  link.attach(records.element)
  const before = work.writes()
  for (const to of [40, 120, 300]) {
    work.swipe(to)
    // The moved scroller's own scroll event is the move's echo.
    records.element.dispatchEvent(new Event('scroll'))
    expect(records.element.scrollLeft).toBe(to)
  }
  expect(work.writes()).toBe(before)
})

it('does not pull the swiped scroller back to a shorter one’s end', () => {
  const link = createScrollLink()
  const work = scroller(600)
  const records = scroller(100)
  link.attach(work.element)
  link.attach(records.element)
  work.swipe(450)
  records.element.dispatchEvent(new Event('scroll'))
  expect(records.element.scrollLeft).toBe(100)
  expect(work.element.scrollLeft).toBe(450)
})

it('lets either scroller lead, and a scroller attached later starts where they are', () => {
  const link = createScrollLink()
  const work = scroller(600)
  const records = scroller(600)
  link.attach(work.element)
  link.attach(records.element)
  records.swipe(250)
  expect(work.element.scrollLeft).toBe(250)
  const later = scroller(600)
  const leave = link.attach(later.element)
  expect(later.element.scrollLeft).toBe(250)
  leave()
  work.element.dispatchEvent(new Event('scroll'))
  work.swipe(10)
  expect(later.element.scrollLeft).toBe(250)
})
