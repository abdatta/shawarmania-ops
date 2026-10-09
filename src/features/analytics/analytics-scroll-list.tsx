import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Bounded local rendering: the aggregate snapshot already contains every row. */
export function AnalyticsScrollList<T>({
  rows,
  label,
  render,
}: {
  rows: T[]
  label: string
  render: (row: T) => ReactNode
}) {
  const [limit, setLimit] = useState(12)
  const windowRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  // Same root-bound sentinel pattern as Customers' bill history. Re-arm after
  // each batch, including when a short batch leaves the sentinel in view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || limit >= rows.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setLimit((current) => Math.min(rows.length, current + 12))
      },
      { root: windowRef.current, rootMargin: '80px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [limit, rows.length])
  return (
    <div
      ref={windowRef}
      role="region"
      aria-label={label}
      data-total={rows.length}
      tabIndex={0}
      className="h-[320px] overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
      onScroll={(event) => {
        if (typeof IntersectionObserver !== 'undefined') return
        const node = event.currentTarget
        if (node.scrollHeight - node.scrollTop - node.clientHeight < 120)
          setLimit((current) => Math.min(rows.length, current + 12))
      }}
    >
      <ul className="divide-y divide-border">{rows.slice(0, limit).map(render)}</ul>
      {limit < rows.length && <div ref={sentinel} className="h-px" aria-hidden />}
      {!rows.length && (
        <p className="py-4 text-sm text-content-muted">No dishes match this filter.</p>
      )}
    </div>
  )
}
