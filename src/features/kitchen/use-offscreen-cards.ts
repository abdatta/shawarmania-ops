import { useEffect, useState, type RefObject } from 'react'

export type Offscreen = 'above' | 'below'

/** How much of a ticket must show for a cook to count it as on screen: nearly all, ACK included. */
const SEEN_RATIO = 0.9

/**
 * Which tickets on the board are scrolled out of sight, and which way (#70).
 *
 * A busy kitchen holds more tickets than one screen, and in either order some
 * fall outside it. The board never scrolls itself — a ticket moving under a
 * cook's hand is worse than one out of view — so it asks this instead, and
 * points at what is waiting. Observes every `[data-order-id]` inside `grid`;
 * `layoutKey` names the layout, so a new ticket, a remounted one or a changed
 * order is observed afresh. Where the browser has no IntersectionObserver
 * nothing is reported, and the board simply has no pointer.
 */
export function useOffscreenCards(
  grid: RefObject<HTMLElement | null>,
  layoutKey: string,
): Record<string, Offscreen> {
  const [offscreen, setOffscreen] = useState<Record<string, Offscreen>>({})

  useEffect(() => {
    const root = grid.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) =>
        setOffscreen((held) => {
          const next = { ...held }
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset['orderId']
            if (!id) continue
            if (entry.intersectionRatio >= SEEN_RATIO) delete next[id]
            else
              next[id] =
                entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'above' : 'below'
          }
          return next
        }),
      { threshold: [0, SEEN_RATIO, 1] },
    )
    root.querySelectorAll<HTMLElement>('[data-order-id]').forEach((card) => observer.observe(card))
    return () => {
      observer.disconnect()
      setOffscreen({})
    }
  }, [grid, layoutKey])

  return offscreen
}
