import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { MyShiftSurface } from './my-shift-surface'

/**
 * Bills this shift and Expenses, side by side below the till
 * (each-dish-is-ticked-off, design D1; `dish-ticks` only).
 *
 * Expenses sit under the menu and Bills under the two-column rail, at the same
 * widths, sharing the till's sideways scroll on a narrow screen. The row fills
 * another viewport, less the demo band, so scrolling to the bottom leaves only
 * the two panels, each scrolling its own list.
 *
 * **It reads nothing on a timer** (design R5). The first launch re-read the
 * shift's history every second in the demo and every ten seconds live, and that
 * loop was one of the three behind the 12 October freeze. Bills reload exactly
 * when they did in the old middle column: on the till's own writes, the outlet's
 * billing events and a return to the foreground — the till's `billRefresh`,
 * lifted to the shell and handed down as `refreshKey`.
 */
export function CounterRecords({
  expenses,
  railWidth,
  scrollLeft,
  onHorizontalScroll,
  asOf,
  refreshKey = 0,
}: {
  expenses: ReactNode
  railWidth?: number | undefined
  scrollLeft?: number
  onHorizontalScroll?: (left: number) => void
  asOf?: string | undefined
  refreshKey?: number
}) {
  const recordsRef = useRef<HTMLDivElement>(null)
  const [recordsHeight, setRecordsHeight] = useState<number | null>(null)

  // A viewport's height, less the demo band when there is one. Layout only.
  useEffect(() => {
    const banner = document.querySelector('[data-window-edge="top"]')
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setRecordsHeight(
        Math.max(0, window.innerHeight - (banner?.getBoundingClientRect().height ?? 0) - 2 * rem),
      )
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (banner) observer?.observe(banner)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    if (scrollLeft !== undefined && recordsRef.current) recordsRef.current.scrollLeft = scrollLeft
  }, [scrollLeft])

  return (
    <section className="space-y-3" data-testid="counter-records">
      <div
        ref={recordsRef}
        onScroll={(event) => onHorizontalScroll?.(event.currentTarget.scrollLeft)}
        className="grid h-[calc(100dvh-4rem)] min-h-0 grid-cols-[minmax(22rem,1fr)_var(--counter-rail-width)] items-stretch gap-3 overflow-x-auto"
        style={
          {
            '--counter-rail-width': railWidth ? `${railWidth}px` : '44rem',
            ...(recordsHeight !== null ? { height: recordsHeight } : {}),
          } as CSSProperties
        }
        data-testid="counter-records-columns"
      >
        <section
          aria-label="Counter expenses"
          className="h-full min-h-0 min-w-0 overflow-y-auto rounded-xl border border-border bg-surface p-3"
        >
          {expenses}
        </section>
        <div className="flex h-full min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface p-3">
          <MyShiftSurface embedded records refreshKey={refreshKey} {...(asOf ? { asOf } : {})} />
        </div>
      </div>
    </section>
  )
}
