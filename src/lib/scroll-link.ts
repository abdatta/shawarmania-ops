/**
 * Scrollers that move sideways together, outside React.
 *
 * The counter's work row and its records row below scroll sideways as one on a
 * narrow tablet. They were kept in step through React state: every scroll event
 * re-rendered the whole counter and wrote the position back into the scroller
 * being dragged, a frame late, which cancelled the browser's own momentum and
 * made a swipe stutter midway (owner, 2026-10-14). Here the scroller under the
 * finger is only ever read; the others are moved directly, and the echo their
 * move sends back is recognised and dropped.
 */
export interface ScrollLink {
  /** Joins a scroller to the others; returns how to leave. */
  attach(element: HTMLElement): () => void
}

export function createScrollLink(): ScrollLink {
  const members = new Set<HTMLElement>()
  /** Where this link moved a scroller: its next scroll event is that move's echo. */
  const moved = new WeakMap<HTMLElement, number>()
  let position = 0

  const move = (element: HTMLElement, left: number) => {
    const reach = Math.max(0, Math.min(left, element.scrollWidth - element.clientWidth))
    if (Math.abs(element.scrollLeft - reach) < 1) return
    moved.set(element, reach)
    element.scrollLeft = reach
  }

  const follow = (source: HTMLElement) => {
    const echo = moved.get(source)
    if (echo !== undefined) {
      moved.delete(source)
      if (Math.abs(source.scrollLeft - echo) < 1) return
    }
    position = source.scrollLeft
    for (const other of members) if (other !== source) move(other, position)
  }

  return {
    attach(element) {
      members.add(element)
      // A scroller that mounts again takes up where the others are.
      move(element, position)
      const onScroll = () => follow(element)
      element.addEventListener('scroll', onScroll, { passive: true })
      return () => {
        element.removeEventListener('scroll', onScroll)
        members.delete(element)
      }
    },
  }
}
