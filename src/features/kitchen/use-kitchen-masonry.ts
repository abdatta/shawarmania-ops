import { useLayoutEffect, type RefObject } from 'react'

/** Responsive columns pack each ticket into the shortest available column. */
export function useKitchenMasonry(ref: RefObject<HTMLDivElement | null>, revision: string) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const items = Array.from(root.children).filter(
      (item): item is HTMLElement => item instanceof HTMLElement,
    )
    const measure = () => {
      const gap = 16
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const columns = Math.max(1, Math.floor((root.clientWidth + gap) / (22 * rem + gap)))
      const width = (root.clientWidth - (columns - 1) * gap) / columns
      const bottoms = Array<number>(columns).fill(0)
      for (const item of items) {
        const column = bottoms.indexOf(Math.min(...bottoms))
        Object.assign(item.style, {
          position: 'absolute',
          width: `${width}px`,
          left: `${column * (width + gap)}px`,
          top: `${bottoms[column]}px`,
        })
        bottoms[column] = bottoms[column]! + item.offsetHeight + gap
      }
      root.style.height = `${Math.max(0, ...bottoms) - (items.length ? gap : 0)}px`
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
  }, [ref, revision])
}
