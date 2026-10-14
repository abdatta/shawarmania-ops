import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ReadyBell } from './pipeline-card'

afterEach(() => vi.useRealTimers())

const bell = (container: HTMLElement) => container.querySelector('svg')!

/** The end of one swing. jsdom has no animations, so React listens under the prefixed name. */
const swingEnds = (element: Element) => {
  fireEvent.animationIteration(element)
  fireEvent(element, new Event('webkitAnimationIteration', { bubbles: true }))
}

it('finishes the swing it is in when the ring ends, then rests', () => {
  const view = render(<ReadyBell ringing />)
  expect(bell(view.container)).toHaveClass('dish-bell-swing')
  view.rerender(<ReadyBell ringing={false} />)
  // Mid-swing: removing the swing now would snap the bell upright.
  expect(bell(view.container)).toHaveClass('dish-bell-swing')
  swingEnds(bell(view.container))
  expect(bell(view.container)).not.toHaveClass('dish-bell-swing')
})

it('keeps swinging through an iteration while it still rings', () => {
  const view = render(<ReadyBell ringing />)
  swingEnds(bell(view.container))
  expect(bell(view.container)).toHaveClass('dish-bell-swing')
})

it('rests anyway when no swing is animating to end', () => {
  vi.useFakeTimers()
  const view = render(<ReadyBell ringing />)
  view.rerender(<ReadyBell ringing={false} />)
  act(() => void vi.advanceTimersByTime(500))
  expect(bell(view.container)).not.toHaveClass('dish-bell-swing')
})
