import { useLayoutEffect, useRef, type RefObject } from 'react'

/** How long a card takes to slide to its new place. */
export const KITCHEN_MASONRY_SLIDE_MS = 220

/** Columns remembered for cards that have gone, so their successor can take one. */
const REMEMBERED = 200

/**
 * Responsive columns, each card kept in the column it was first given.
 *
 * A new card goes to the shortest column — unless a card of its own order has
 * just left one, as a Done receipt does when Undo reopens its ticket, or a
 * ticket does when Done collapses it to a receipt: then it takes that column,
 * so it opens or closes where the cook was looking. Nothing else moves across:
 * an ACK, a Done, an expanded receipt or a departure changes heights, and the
 * cards below slide up or down their own column instead of being dealt again
 * into whichever column is shortest (owner, 2026-10-14). Only a change in the
 * number of columns deals every card afresh.
 *
 * Cards carry `data-masonry-key` (unique) and `data-masonry-group` (their
 * order). A card's first placement does not slide; later ones do, unless the
 * tablet asks for reduced motion.
 */
export function useKitchenMasonry(ref: RefObject<HTMLDivElement | null>, revision: string) {
  const memory = useRef({
    columns: 0,
    column: new Map<string, number>(),
    group: new Map<string, string>(),
  })

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const items = Array.from(root.children).filter(
      (item): item is HTMLElement => item instanceof HTMLElement,
    )
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const measure = () => {
      const gap = 16
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const columns = Math.max(1, Math.floor((root.clientWidth + gap) / (22 * rem + gap)))
      const width = (root.clientWidth - (columns - 1) * gap) / columns
      const known = memory.current
      if (known.columns !== columns) {
        known.columns = columns
        known.column.clear()
        known.group.clear()
      }
      const present = new Set(items.map((item, index) => item.dataset.masonryKey ?? `#${index}`))
      // A column left by a card of the same order, free for its successor.
      const vacated = new Map<string, number>()
      for (const [key, column] of known.column) {
        const group = known.group.get(key)
        if (group !== undefined && !present.has(key)) vacated.set(group, column)
      }

      const bottoms = Array<number>(columns).fill(0)
      for (const [index, item] of items.entries()) {
        const key = item.dataset.masonryKey ?? `#${index}`
        const group = item.dataset.masonryGroup ?? key
        let column = known.column.get(key)
        if (column === undefined) {
          column = vacated.get(group) ?? bottoms.indexOf(Math.min(...bottoms))
          vacated.delete(group)
          known.column.delete(key)
          known.column.set(key, column)
          known.group.set(key, group)
          while (known.column.size > REMEMBERED) {
            const oldest = known.column.keys().next().value!
            if (present.has(oldest)) break
            known.column.delete(oldest)
            known.group.delete(oldest)
          }
        }
        const placed = item.dataset.masonryPlaced === 'true'
        Object.assign(item.style, {
          position: 'absolute',
          width: `${width}px`,
          left: `${column * (width + gap)}px`,
          top: `${bottoms[column]}px`,
          transition:
            placed && !still
              ? `top ${KITCHEN_MASONRY_SLIDE_MS}ms ease-out, left ${KITCHEN_MASONRY_SLIDE_MS}ms ease-out`
              : '',
        })
        item.dataset.masonryPlaced = 'true'
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
