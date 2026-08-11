/**
 * The state of a waiting build, as external state.
 *
 * Service-worker registration happens at module scope in `main.tsx`, before
 * React renders and outside it. That stays true: registration publishes here,
 * and components read this through `useSyncExternalStore`. Moving registration
 * into a provider would put StrictMode's double-invocation and mount ordering
 * in the path of the boot sequence to gain nothing — update readiness is a
 * boolean, not a captured DOM event, so it needs no provider (design D2).
 */

export type UpdateState = {
  /** A new build has activated. The next load runs it regardless. */
  ready: boolean
  /**
   * The app looked, found the page occupied, and is waiting rather than
   * reloading. Sticky: an affordance that appeared and vanished with each
   * keystroke would be worse than none.
   */
  deferred: boolean
}

let state: UpdateState = { ready: false, deferred: false }

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function set(next: Partial<UpdateState>): void {
  const merged = { ...state, ...next }
  if (merged.ready === state.ready && merged.deferred === state.deferred) return
  // Replaced rather than mutated: `useSyncExternalStore` compares snapshots by
  // identity, so a mutated object would never re-render and a rebuilt one on
  // every read would never stop.
  state = merged
  notify()
}

/** A new build has activated and the running page has not taken it. */
export function recordUpdateReady(): void {
  set({ ready: true })
}

/** The page was occupied when we looked, so the action becomes visible. */
export function markUpdateDeferred(): void {
  if (!state.ready) return
  set({ deferred: true })
}

export function getUpdateState(): UpdateState {
  return state
}

/** The server snapshot. There is no service worker during prerender or test. */
export function getServerUpdateState(): UpdateState {
  return SETTLED
}

const SETTLED: UpdateState = { ready: false, deferred: false }

export function subscribeToUpdates(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Test seam. */
export function resetUpdateState(): void {
  state = SETTLED
  notify()
}
