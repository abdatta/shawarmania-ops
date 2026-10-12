import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MyShiftSurface } from './my-shift-surface'
import type { CSSProperties, ReactNode } from 'react'
import type { ReadyCue } from './ready-dish'

const EVENT = 'shawarmania-demo-counter-layout'
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}
function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* A blocked store loses only the preference. */
  }
  window.dispatchEvent(new Event(EVENT))
}
export function useDemoReadyCue(): ReadyCue {
  const value = useSyncExternalStore(
    subscribe,
    () => read('shawarmania-demo-ready-cue', 'pulse-dot'),
    () => 'pulse-dot',
  )
  return value === 'halo' || value === 'steady-dot' ? value : 'pulse-dot'
}
export function DemoCounterReview({
  expenses,
  railWidth,
  scrollLeft,
  onHorizontalScroll,
  asOf,
  showReview = true,
}: {
  expenses: ReactNode
  railWidth?: number | undefined
  scrollLeft?: number
  onHorizontalScroll?: (left: number) => void
  asOf?: string | undefined
  showReview?: boolean
}) {
  const cue = useDemoReadyCue()
  const [refresh, setRefresh] = useState(0)
  const recordsRef = useRef<HTMLDivElement>(null)
  const [recordsHeight, setRecordsHeight] = useState<number | null>(null)
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
  useEffect(() => {
    const timer = setInterval(() => setRefresh((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <section className="space-y-3" data-testid="demo-counter-review">
      {showReview && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-2 text-sm text-content-muted">
            Demo ready cue
            <select
              aria-label="Demo ready cue"
              value={cue}
              onChange={(event) => save('shawarmania-demo-ready-cue', event.target.value)}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-content"
            >
              <option value="halo">A · Soft halo</option>
              <option value="pulse-dot">B · Breathing dot</option>
              <option value="steady-dot">C · Steady dot</option>
            </select>
          </label>
        </div>
      )}
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
          <MyShiftSurface embedded refreshKey={refresh} {...(asOf ? { asOf } : {})} />
        </div>
      </div>
    </section>
  )
}
