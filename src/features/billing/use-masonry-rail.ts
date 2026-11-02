import { useLayoutEffect, type RefObject } from 'react'

/** A single chronological list, packed into whichever column has room next. */
export function useMasonryRail(
  ref: RefObject<HTMLUListElement | null>,
  enabled: boolean,
  revision: unknown,
  /** A second reason to lay out again: what is listed, beside what was read. */
  listed?: string,
) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !enabled) return
    const items = Array.from(root.children).filter(
      (item): item is HTMLLIElement => item instanceof HTMLLIElement,
    )
    const measure = () => {
      const bottoms = [0, 0]
      for (const item of items) {
        const column = bottoms[0]! <= bottoms[1]! ? 0 : 1
        Object.assign(item.style, {
          position: 'absolute',
          width: 'calc((100% - 0.5rem) / 2)',
          left: column === 0 ? '0px' : 'calc(50% + 0.25rem)',
          top: `${bottoms[column]}px`,
        })
        bottoms[column] = bottoms[column]! + item.offsetHeight + 8
      }
      root.style.setProperty(
        '--pipeline-height',
        `${Math.max(0, ...bottoms) - (items.length ? 8 : 0)}px`,
      )
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(root)
    for (const item of items) observer?.observe(item)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, enabled, revision, listed])
}
