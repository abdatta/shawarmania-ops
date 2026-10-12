import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDown, ArrowUp, IndianRupee } from 'lucide-react'

/**
 * What is outside the rail's viewport, and a way to reach it.
 *
 * Modelled on the "jump to latest" pill in a chat app, because that is a
 * pattern billers already know from their own phones. Each chip appears only
 * while orders are actually clipped in its direction, floats over the list
 * rather than occupying its height, and scrolls the whole way to that end when
 * tapped — not by a page and not to the next card, because a partial scroll
 * would leave the biller re-reading the chip to find out whether anything
 * happened.
 *
 * The bottom chip carries a marker when any order hidden below it is prepared
 * and still unpaid. The list is newest-first, so a prepared order waiting for
 * money sinks as the day fills in above it; the deleted divider used to make
 * that visible and this is what says it instead, in fewer pixels.
 */
export interface RailClipping {
  above: number
  below: number
  /** Any order hidden **below** is prepared and still waiting for money. */
  moneyWaitingBelow: boolean
}

const NOTHING_CLIPPED: RailClipping = { above: 0, below: 0, moneyWaitingBelow: false }

/**
 * Measured from the scroller's own geometry against each card's offset — never
 * from a guessed card height, because cards vary with their item lines. A card
 * only half in view counts as visible: the chip announces what cannot be seen
 * at all.
 *
 * `data-awaiting-money` on a list item is how a hidden order says it is
 * prepared and unpaid, so this hook needs no second copy of the order array to
 * stay in step with what is actually rendered.
 */
export function useRailClipping(
  scrollerRef: RefObject<HTMLElement | null>,
  /** Recompute when the list itself changes, not only when it is scrolled. */
  deps: readonly unknown[],
): RailClipping {
  const [clipping, setClipping] = useState<RailClipping>(NOTHING_CLIPPED)
  const frame = useRef<number | null>(null)

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return setClipping(NOTHING_CLIPPED)
    const viewTop = scroller.scrollTop
    const viewBottom = viewTop + scroller.clientHeight
    let above = 0
    let below = 0
    let moneyWaitingBelow = false
    for (const child of scroller.children) {
      const item = child as HTMLElement
      const top = item.offsetTop
      const bottom = top + item.offsetHeight
      if (bottom <= viewTop) above += 1
      else if (top >= viewBottom) {
        below += 1
        if (item.dataset.awaitingMoney === 'true') moneyWaitingBelow = true
      }
    }
    setClipping((current) =>
      current.above === above &&
      current.below === below &&
      current.moneyWaitingBelow === moneyWaitingBelow
        ? current
        : { above, below, moneyWaitingBelow },
    )
  }, [scrollerRef])

  /** One measurement per frame at most: scroll fires far faster than layout changes. */
  const schedule = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      measure()
    })
  }, [measure])

  useEffect(() => {
    schedule()
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, scrollerRef, ...deps])

  return clipping
}

export function RailScrollChip({
  edge,
  count,
  marked = false,
  onActivate,
}: {
  edge: 'top' | 'bottom'
  count: number
  /** Prepared work is waiting for money down there. */
  marked?: boolean
  onActivate: () => void
}) {
  if (count <= 0) return null
  const Arrow = edge === 'top' ? ArrowUp : ArrowDown
  const destination =
    edge === 'top'
      ? `Scroll to the newest order — ${count} hidden above`
      : `Scroll to the oldest order — ${count} hidden below`
  return (
    <button
      type="button"
      data-testid={`rail-scroll-${edge}`}
      /* Named by its destination, not by the direction glyph. */
      aria-label={
        marked ? `${destination}, including prepared work waiting for money` : destination
      }
      onClick={onActivate}
      className={`absolute ${edge === 'top' ? 'top-1' : 'bottom-1'} left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-content shadow-lg focus-visible:focus-ring`}
    >
      <Arrow aria-hidden size={13} />
      {count} more
      {marked && (
        /*
          The one thing the deleted divider said that nothing else on the new
          rail would: prepared food is waiting for money out of sight. A rupee
          glyph rather than a coloured dot, so the marker carries a **shape**
          and survives a reader who does not see the green — and the accessible
          name says it in words rather than leaving it to the picture.
        */
        <IndianRupee
          aria-hidden
          size={13}
          strokeWidth={3}
          data-testid="rail-scroll-money-marker"
          className="text-success"
        />
      )}
    </button>
  )
}
