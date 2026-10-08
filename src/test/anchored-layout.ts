import { vi } from 'vitest'

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

function toRect({ top, left, width, height }: Box): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * Lays out an anchored menu, which jsdom cannot: the trigger where the test
 * puts it, and any fixed panel where its own style puts it, at the size the test
 * gives it. Reading the style rather than trusting the component is the point,
 * so the old `bottom`/`right` placement is measured as faithfully as the new.
 *
 * `offset` stands in for a transformed ancestor — a sliding card — which moves
 * a fixed panel away from the coordinates it was given.
 */
export function layOutAnchoredMenu({
  isTrigger,
  trigger,
  panel,
  offset = { top: 0, left: 0 },
  others = () => undefined,
}: {
  isTrigger: (element: Element) => boolean
  /** Anything else the test lays out, such as chrome fixed over the window. */
  others?: (element: Element) => Box | undefined
  trigger: Box
  panel: { width: number; height: number }
  offset?: { top: number; left: number }
}) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    if (isTrigger(this)) return toRect(trigger)
    const other = others(this)
    if (other) return toRect(other)
    const style = (this as HTMLElement).style as CSSStyleDeclaration | undefined
    if (style?.position !== 'fixed') return toRect({ top: 0, left: 0, width: 0, height: 0 })
    const top = style.top
      ? parseFloat(style.top)
      : style.bottom
        ? window.innerHeight - parseFloat(style.bottom) - panel.height
        : 0
    const left = style.left
      ? parseFloat(style.left)
      : style.right
        ? window.innerWidth - parseFloat(style.right) - panel.width
        : 0
    return toRect({ top: top + offset.top, left: left + offset.left, ...panel })
  })
}

/** Whether every edge of an element lies inside the window. */
export function isInsideWindow(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth
  )
}
