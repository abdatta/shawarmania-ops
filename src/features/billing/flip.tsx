import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Motion for stage changes, generalising the dock animation (design D7).
 *
 * Two mechanisms, both hand-rolled on WAAPI — no animation dependency enters
 * the bundle:
 *
 *  - **`useFlip`** glides a card whose element survived a list change from its
 *    previous rectangle to its new one (First–Last–Invert–Play). Section-to-
 *    section moves inside the rail ride this, as do sibling cards making room.
 *  - **`flyGhost`** bridges an identity change a FLIP cannot see: paying an
 *    order ends one element (an order card) and starts another (a bill row).
 *    A fixed-position ghost flies between their rectangles instead.
 *
 * Rapid successive moves coalesce naturally: every commit re-measures where
 * elements actually are and restarts only what moved — last state wins, never
 * a queued traffic jam. Under `prefers-reduced-motion` both mechanisms stand
 * down entirely: position never depends on animation having run.
 */

const FLIP_DURATION_MS = 280

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function rectsOf(root: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
    const id = el.dataset.flipId
    if (id) rects.set(id, el.getBoundingClientRect())
  }
  return rects
}

/**
 * Glide surviving `[data-flip-id]` elements inside `root` whenever `deps`
 * change. Mount `rootRef` on a common ancestor of every list involved — moves
 * between sibling containers read as one flight because the rectangles are all
 * this hook knows about.
 */
export function useFlip(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  const firstRects = useRef<Map<string, DOMRect> | null>(null)
  const running = useRef(new Map<string, Animation>())

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const first = firstRects.current
    firstRects.current = rectsOf(root)

    if (!first || reducedMotion()) {
      // No previous layout to glide from — or motion is declined. Save the
      // rectangles and let the commit stand as it landed.
      for (const [id, animation] of running.current) {
        void animation.cancel()
        running.current.delete(id)
      }
      return
    }

    for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = el.dataset.flipId
      if (!id) continue
      const from = first.get(id)
      if (!from) continue
      const to = el.getBoundingClientRect()
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (dx === 0 && dy === 0) continue

      running.current.get(id)?.cancel()
      const animation = el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: FLIP_DURATION_MS, easing: 'ease-out' },
      )
      running.current.set(id, animation)
      animation.finished.finally(() => running.current.delete(id)).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the API
  }, deps)
}

// ── The ghost layer ──────────────────────────────────────────────────────────

export interface GhostFlightRequest {
  /** Where the moving thing stood. */
  fromRect: { left: number; top: number; width: number; height: number }
  /** Where it has landed, resolved lazily: the destination often renders a beat later. */
  resolveToRect: () => { left: number; top: number; width: number; height: number } | null
  /** What rides the ghost — the total is what the eye tracks across the gap. */
  label: string
}

const FLIGHT_EVENT = 'shawarmania:ghost-flight'

/** Announce a cross-column move. Fire-and-forget; the layer does the rest. */
export function flyGhost(request: GhostFlightRequest): void {
  if (reducedMotion()) return
  window.dispatchEvent(new CustomEvent(FLIGHT_EVENT, { detail: request }))
}

/**
 * Find an element for `seconds` worth of frames before giving up quietly —
 * the destination of a flight may not exist until its list has reloaded, and
 * a missing destination means no flight, never a broken screen.
 */
export function waitForElement(selector: string, timeoutMs = 600): Promise<HTMLElement | null> {
  const immediate = document.querySelector<HTMLElement>(selector)
  if (immediate) return Promise.resolve(immediate)
  return new Promise((resolve) => {
    const startedAt = performance.now()
    function tick() {
      const found = document.querySelector<HTMLElement>(selector)
      if (found) return resolve(found)
      if (performance.now() - startedAt > timeoutMs) return resolve(null)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** The fixed-position layer that plays announced flights. One per screen. */
export function GhostLayer() {
  const layerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function play(request: GhostFlightRequest) {
      const layer = layerRef.current
      if (!layer) return
      const ghost = document.createElement('div')
      ghost.textContent = request.label
      ghost.setAttribute('aria-hidden', 'true')
      Object.assign(ghost.style, {
        position: 'fixed',
        left: `${request.fromRect.left}px`,
        top: `${request.fromRect.top}px`,
        width: `${request.fromRect.width}px`,
        height: `${request.fromRect.height}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 10px',
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        fontWeight: '900',
        color: 'var(--color-content)',
        zIndex: '50',
        pointerEvents: 'none',
        boxShadow: '0 12px 24px rgb(0 0 0 / 0.18)',
      } satisfies Partial<CSSStyleDeclaration>)
      layer.appendChild(ghost)

      const to = request.resolveToRect()
      const keyframes: Keyframe[] = to
        ? [
            { transform: 'translate(0, 0)', opacity: 1 },
            {
              transform: `translate(${to.left - request.fromRect.left}px, ${
                to.top - request.fromRect.top
              }px) scale(${Math.min(1, to.width / Math.max(1, request.fromRect.width))})`,
              opacity: 0.9,
            },
          ]
        : [
            { transform: 'translate(0, 0)', opacity: 1 },
            { transform: 'translate(24px, -16px)', opacity: 0 },
          ]
      const animation = ghost.animate(keyframes, {
        duration: FLIP_DURATION_MS,
        easing: 'ease-in-out',
        fill: 'forwards',
      })
      animation.finished.then(() => ghost.remove()).catch(() => ghost.remove())
    }
    function onEvent(event: Event) {
      play((event as CustomEvent<GhostFlightRequest>).detail)
    }
    window.addEventListener(FLIGHT_EVENT, onEvent)
    return () => window.removeEventListener(FLIGHT_EVENT, onEvent)
  }, [])

  return <div ref={layerRef} aria-hidden className="pointer-events-none fixed inset-0 z-50" />
}
