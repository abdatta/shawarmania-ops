import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Where a menu opens, for every menu placed in the window rather than in its
 * own box (a-menu-opens-where-it-can-be-read).
 *
 * Menus here are `position: fixed` because the boxes they live in scroll
 * horizontally, and a box that scrolls one way clips the other way too. Placed
 * in the window, a menu then has to look at the window, and at what covers it:
 * the pipeline card's used to open above its trigger whatever was there, and
 * the row menu below, so the top card of a scrolled counter opened its menu off
 * the top of the screen, and a row above the phone's bar opened its over the bar.
 */

/** Between the trigger and the panel. */
export const PANEL_GAP_PX = 4
/** The least a panel keeps between itself and the edge of the area it opens in. */
export const VIEWPORT_MARGIN_PX = 8

export type PanelSide = 'above' | 'below'
export type PanelAlign = 'start' | 'end'

/** A rectangle of the window, in window coordinates. */
export interface PanelArea {
  top: number
  bottom: number
  left: number
  right: number
}

export interface AnchoredPlacement {
  top: number
  left: number
  side: PanelSide
}

/**
 * The preferred side if the whole panel fits there, the other if it fits there,
 * and otherwise whichever has more room; then held inside the area's margin,
 * overlapping its own trigger rather than leaving the area.
 *
 * The area is the window less the chrome fixed over its edges (`usableArea`),
 * not the window: a row just above the phone's bottom bar has no room below it,
 * however much window there is.
 */
export function placeAnchoredPanel({
  trigger,
  panel,
  area,
  prefer,
  align,
}: {
  trigger: { top: number; bottom: number; left: number; right: number }
  panel: { width: number; height: number }
  area: PanelArea
  prefer: PanelSide
  align: PanelAlign
}): AnchoredPlacement {
  const topFor = (side: PanelSide) =>
    side === 'above' ? trigger.top - PANEL_GAP_PX - panel.height : trigger.bottom + PANEL_GAP_PX
  const fits = (side: PanelSide) => {
    const top = topFor(side)
    return (
      top >= area.top + VIEWPORT_MARGIN_PX && top + panel.height <= area.bottom - VIEWPORT_MARGIN_PX
    )
  }
  const other: PanelSide = prefer === 'above' ? 'below' : 'above'
  const side = fits(prefer)
    ? prefer
    : fits(other)
      ? other
      : trigger.top - area.top >= area.bottom - trigger.bottom
        ? 'above'
        : 'below'

  const left = align === 'end' ? trigger.right - panel.width : trigger.left
  return {
    top: clamp(topFor(side), area.top, area.bottom - panel.height),
    left: clamp(left, area.left, area.right - panel.width),
    side,
  }
}

function clamp(value: number, from: number, to: number): number {
  const lowest = from + VIEWPORT_MARGIN_PX
  const highest = Math.max(lowest, to - VIEWPORT_MARGIN_PX)
  return Math.min(Math.max(value, lowest), highest)
}

/**
 * The window less what the app keeps fixed over its top and bottom: the
 * phone's navigation bar, the demo banner on the counter. Such chrome is marked
 * `data-window-edge="top"` or `"bottom"`; an element not drawn (the bar is
 * `md:hidden` on a tablet) has no size and moves no edge.
 */
export function usableArea(): PanelArea {
  let top = 0
  let bottom = window.innerHeight
  for (const edge of document.querySelectorAll<HTMLElement>('[data-window-edge]')) {
    const rect = edge.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (edge.dataset['windowEdge'] === 'top') top = Math.max(top, rect.bottom)
    else bottom = Math.min(bottom, rect.top)
  }
  return { top, bottom, left: 0, right: window.innerWidth }
}

/**
 * The style that keeps an open panel beside its trigger.
 *
 * Placed before first paint, hidden until then, and re-placed every animation
 * frame while open: a card sliding into a freed place moves its trigger and
 * fires no scroll or resize event. State changes only when the position does.
 *
 * **It measures where the panel actually is, not where it was told to be.** A
 * card slides by CSS transform, and a transformed ancestor makes `fixed`
 * relative to itself rather than to the window. The difference between the two
 * is that ancestor's offset, zero outside a slide, and it is subtracted.
 */
export function useAnchoredPanel(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { prefer, align = 'end' }: { prefer: PanelSide; align?: PanelAlign },
): CSSProperties {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function place() {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return
      const trigger = anchor.getBoundingClientRect()
      const actual = panel.getBoundingClientRect()
      const wanted = placeAnchoredPanel({
        trigger,
        panel: { width: actual.width, height: actual.height },
        area: usableArea(),
        prefer,
        align,
      })
      // What is committed, not what was last asked for: a frame can land before
      // React has written the previous position, and the offset is only true
      // against the style the panel is actually wearing.
      const given = {
        top: parseFloat(panel.style.top) || 0,
        left: parseFloat(panel.style.left) || 0,
      }
      const next = {
        top: Math.round(wanted.top - (actual.top - given.top)),
        left: Math.round(wanted.left - (actual.left - given.left)),
      }
      const shown = panel.style.visibility !== 'hidden'
      if (shown && next.top === given.top && next.left === given.left) return
      setPosition(next)
    }

    place()
    if (typeof window.requestAnimationFrame !== 'function') {
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      return () => {
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
      }
    }
    let frame = window.requestAnimationFrame(function follow() {
      place()
      frame = window.requestAnimationFrame(follow)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [align, anchorRef, open, panelRef, prefer])

  return position
    ? { position: 'fixed', top: position.top, left: position.left }
    : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
}
