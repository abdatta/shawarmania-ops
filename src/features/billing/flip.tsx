import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Motion for stage changes, generalising the dock animation (design D7).
 *
 * Two mechanisms, both hand-rolled on WAAPI — no animation dependency enters
 * the bundle:
 *
 *  - **`useFlip`** glides surviving siblings from their previous rectangles to
 *    their new ones (First–Last–Invert–Play). A card changing lists gets a
 *    single cloned ghost instead: the destination waits behind a shimmer while
 *    the ghost crosses the boundary, so it never appears to rearrange twice.
 *  - **`flyCapturedCardToDestination`** bridges an identity change a FLIP
 *    cannot see: paying an order ends one element (an order card) and starts
 *    another (a bill row). It carries the captured card itself, with the same
 *    destination shimmer as a pipeline-stage move.
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

interface FlipSnapshot {
  rect: DOMRect
  /** The list, not the ticket's immediate <li>, that defines its stage. */
  container: HTMLElement | null
  /** A pre-commit ticket clone for a cross-container flight. */
  clone: HTMLElement
}

interface RunningMotion {
  animation: Animation
  cleanup: () => void
}

export interface CapturedCardFlight {
  rect: DOMRect
  clone: HTMLElement
}

function cloneCard(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement
  clone.removeAttribute('data-flip-id')
  clone.removeAttribute('data-testid')
  for (const testId of clone.querySelectorAll('[data-testid]'))
    testId.removeAttribute('data-testid')
  return clone
}

function snapshotOf(element: HTMLElement): FlipSnapshot {
  return {
    rect: element.getBoundingClientRect(),
    container: element.closest<HTMLElement>('ul'),
    clone: cloneCard(element),
  }
}

function snapshotsOf(root: HTMLElement): Map<string, FlipSnapshot> {
  const snapshots = new Map<string, FlipSnapshot>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
    const id = el.dataset.flipId
    if (!id) continue
    snapshots.set(id, snapshotOf(el))
  }
  return snapshots
}

function suppressDestinationWithShimmer(destination: HTMLElement): () => void {
  const host = destination.parentElement
  if (!host) return () => undefined

  const previousOpacity = destination.style.opacity
  const previousPosition = host.style.position
  if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'
  destination.style.opacity = '0'

  const shimmer = document.createElement('div')
  shimmer.setAttribute('aria-hidden', 'true')
  shimmer.setAttribute('data-flip-placeholder', '')
  shimmer.className =
    'absolute inset-0 animate-pulse rounded-xl bg-surface-raised motion-reduce:animate-none'
  host.appendChild(shimmer)

  // The origin is already collapsing beneath the flying ghost. Only this
  // destination reserves space, then crossfades into the real ticket before
  // the ghost lands — no second, last-moment rearrangement.
  shimmer.animate(
    [
      { opacity: 0, transform: 'scaleY(0)' },
      { opacity: 1, transform: 'scaleY(1)' },
    ],
    { duration: 80, easing: 'ease-out', fill: 'forwards' },
  )
  const reveal = window.setTimeout(() => {
    void shimmer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 80,
      easing: 'ease-in',
      fill: 'forwards',
    })
    void destination.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 80,
      easing: 'ease-out',
      fill: 'forwards',
    })
  }, FLIP_DURATION_MS - 80)

  return () => {
    window.clearTimeout(reveal)
    shimmer.remove()
    destination.style.opacity = previousOpacity
    host.style.position = previousPosition
  }
}

function flyMovedCard(from: FlipSnapshot, destination: HTMLElement): RunningMotion {
  const destinationRect = destination.getBoundingClientRect()
  const ghost = from.clone
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('data-flip-ghost', '')
  ghost.inert = true
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${from.rect.left}px`,
    top: `${from.rect.top}px`,
    width: `${from.rect.width}px`,
    height: `${from.rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    zIndex: '60',
    boxShadow: '0 12px 24px rgb(0 0 0 / 0.18)',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(ghost)

  const releaseDestination = suppressDestinationWithShimmer(destination)
  const deltaX = destinationRect.left - from.rect.left
  const deltaY = destinationRect.top - from.rect.top
  const scaleX = destinationRect.width / Math.max(1, from.rect.width)
  const scaleY = destinationRect.height / Math.max(1, from.rect.height)
  const animation = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1.03)', opacity: 1 },
      // Depart promptly. A slow ease-in made the clone read as a second source
      // placeholder while the list beneath it was already closing its gap.
      {
        offset: 0.16,
        transform: `translate(${deltaX * 0.24}px, ${deltaY * 0.24}px) scale(${1 + (scaleX - 1) * 0.24}, ${
          1 + (scaleY - 1) * 0.24
        })`,
        opacity: 1,
      },
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
        opacity: 1,
      },
    ],
    { duration: FLIP_DURATION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  )

  return {
    animation,
    cleanup: () => {
      ghost.remove()
      releaseDestination()
    },
  }
}

/**
 * Freeze the full ticket before an identity-changing action removes it from
 * the DOM. A bill has a different id from its order, so `useFlip` cannot
 * connect the two after React has committed the new lists.
 */
export function captureCardFlight(card: HTMLElement): CapturedCardFlight {
  const snapshot = snapshotOf(card)
  return { rect: snapshot.rect, clone: snapshot.clone }
}

/**
 * Land a captured ticket in a newly rendered row. This deliberately shares
 * the pipeline's flight/shimmer routine so payment has one continuous motion,
 * not an amount badge flying separately from the ticket disappearing.
 */
export function flyCapturedCardToDestination(
  from: CapturedCardFlight,
  destination: HTMLElement,
): void {
  if (reducedMotion()) return

  const motion = flyMovedCard({ ...from, container: null }, destination)
  void motion.animation.finished.then(motion.cleanup, motion.cleanup)
}

/**
 * Animate only a genuine stage move (or a departure), not every read refresh.
 * A newly saved order is an arrival, not an update of every ticket already in
 * the rail; replaying FLIP for those siblings was the second, disjoint motion
 * seen after an Order action. Mount `rootRef` on the common pipeline ancestor.
 */
export function useFlip(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  const firstSnapshots = useRef<Map<string, FlipSnapshot> | null>(null)
  const running = useRef(new Map<string, RunningMotion>())

  function stop(id: string) {
    const motion = running.current.get(id)
    if (!motion) return
    motion.animation.cancel()
    motion.cleanup()
    running.current.delete(id)
  }

  useEffect(
    () => () => {
      for (const id of running.current.keys()) stop(id)
    },
    [],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const first = firstSnapshots.current
    firstSnapshots.current = snapshotsOf(root)

    if (!first || reducedMotion()) {
      // No previous layout to glide from — or motion is declined. Save the
      // rectangles and let the commit stand as it landed.
      for (const id of [...running.current.keys()]) stop(id)
      return
    }

    const current = new Map<string, HTMLElement>()
    for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = el.dataset.flipId
      if (id) current.set(id, el)
    }

    // Only the two lists touched by an actual section change (or the source
    // list of a departure) may glide their siblings. Ordinary re-fetches and
    // new arrivals have no active list, so they settle without a second dance.
    const activeContainers = new Set<HTMLElement>()
    for (const [id, from] of first) {
      const destination = current.get(id)
      if (!destination) {
        if (from.container) activeContainers.add(from.container)
        continue
      }
      const destinationContainer = destination.closest<HTMLElement>('ul')
      if (from.container !== destinationContainer) {
        if (from.container) activeContainers.add(from.container)
        if (destinationContainer) activeContainers.add(destinationContainer)
      }
    }

    for (const el of current.values()) {
      const id = el.dataset.flipId
      if (!id) continue
      const from = first.get(id)
      if (!from) continue
      const destinationContainer = el.closest<HTMLElement>('ul')
      const crossesSections = from.container !== destinationContainer
      if (
        !crossesSections &&
        !activeContainers.has(from.container!) &&
        !activeContainers.has(destinationContainer!)
      ) {
        continue
      }
      const to = el.getBoundingClientRect()
      const dx = from.rect.left - to.left
      const dy = from.rect.top - to.top
      if (dx === 0 && dy === 0) continue

      stop(id)
      const motion = crossesSections
        ? flyMovedCard(from, el)
        : {
            animation: el.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
              { duration: FLIP_DURATION_MS, easing: 'ease-out' },
            ),
            cleanup: () => undefined,
          }
      running.current.set(id, motion)
      motion.animation.finished
        .finally(() => {
          if (running.current.get(id) !== motion) return
          motion.cleanup()
          running.current.delete(id)
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the API
  }, deps)
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
