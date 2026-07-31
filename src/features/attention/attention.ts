import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * The attention mechanism: how a surface tells the rest of the app that
 * somebody is waiting on it (spec: attention-badges).
 *
 * Three pieces, all deliberately small. A **shape** a source reports. A way to
 * be told the app came back to the **foreground**, which is the only moment a
 * count is re-read on its own. And a **nudge** any surface can fire after doing
 * the work, so clearing a backlog clears the badge that pointed at it rather
 * than leaving a number nobody can get rid of.
 *
 * What is deliberately absent is a timer and a subscription. The phone this
 * runs on spends its day in an apron, and waking the radio for a number nobody
 * is looking at is a cost paid continuously for a benefit taken occasionally
 * (design D4). The honest consequence is that a count can lag work that arrives
 * while a screen sits open, which is documented rather than hidden.
 */

/** What a source reports. `null` means "not known yet", which badges nothing. */
export interface Attention {
  /** How many things are waiting. Zero renders no badge at all (design D5). */
  count: number
  /**
   * What is waiting, as a sentence, for anybody who is not looking at the
   * number. The source writes it, because the shell does not know what is being
   * counted and could not write it honestly (design D2).
   */
  label: string
}

/** A hook a surface offers so the shell can badge it without knowing why. */
export type AttentionSource = () => Attention | null

const listeners = new Set<() => void>()

/**
 * Tell every live count to read itself again. Called after work is done, not on
 * a schedule: approving the last waiting arrival should take the badge away,
 * and the badge is usually somewhere else on screen from the button.
 */
export function attentionChanged(): void {
  for (const listener of [...listeners]) listener()
}

/** Re-read on someone else's nudge. Unsubscribes with the component. */
export function useAttentionNudge(reread: () => void): void {
  useEffect(() => {
    listeners.add(reread)
    return () => {
      listeners.delete(reread)
    }
  }, [reread])
}

/**
 * Run something when the app comes back to the foreground — picking the phone
 * up out of a pocket, or switching back from the camera. This is the moment a
 * stale count actually matters, and it costs nothing while nothing happens.
 */
export function useOnForeground(run: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [run])
}

/** One count, shared by everything reading it through the same `key`. */
interface SharedStore {
  value: unknown
  /** True while a read is out, so simultaneous readers make one request. */
  reading: boolean
  changed: Set<() => void>
}

/**
 * Keyed by the adapter object rather than by a string, so a test that builds a
 * fresh adapter gets a fresh store and nothing survives between tests. Weak, so
 * a store dies with the adapter it belongs to.
 */
const stores = new WeakMap<object, SharedStore>()

function storeFor(key: object): SharedStore {
  const found = stores.get(key)
  if (found) return found
  const made: SharedStore = { value: null, reading: false, changed: new Set() }
  stores.set(key, made)
  return made
}

/**
 * The store's mutations live out here as plain functions rather than inside the
 * hook. A hook may not modify what was handed to it, and a store looked up from
 * the key it was handed counts — which is a fair rule, since the whole point is
 * that this state outlives any one component.
 */
function subscribeTo(key: object, onChange: () => void): () => void {
  const store = storeFor(key)
  store.changed.add(onChange)
  return () => {
    store.changed.delete(onChange)
  }
}

function beginRead(key: object, read: () => Promise<unknown>): void {
  const store = storeFor(key)
  // A read already out serves everyone waiting on it. This is what keeps two
  // navigations and a day view down to one request.
  if (store.reading) return
  store.reading = true
  void read()
    .then((next) => {
      store.value = next
    })
    // A failure leaves the previous value alone: blanking a badge would say the
    // work is done, which is the one wrong thing it can say.
    .catch(() => undefined)
    .finally(() => {
      store.reading = false
      for (const onChange of [...store.changed]) onChange()
    })
}

/**
 * A read that many parts of the screen can show without each making it.
 *
 * The phone shell renders its navigation twice — a rail for wide screens and a
 * bottom bar for narrow ones, both in the document with one hidden by CSS — and
 * the day view wants the same numbers as the tab. Left alone that is three
 * requests for one answer, so readers sharing a `key` share the result: the
 * first mount reads, later mounts take what is already there, and a read
 * already in flight is not started again.
 *
 * A failed read leaves the previous value in place. Blanking it would say the
 * work is done, which is the one wrong thing a badge can say (design D-offline).
 */
export function useSharedRead<T>(
  key: object,
  read: () => Promise<T>,
): { value: T | null; reread: () => void } {
  // The newest reader wins, so `reread` never calls a closure over a stale
  // adapter. Written in an effect and called from a callback, never in render.
  const latest = useRef(read)
  useEffect(() => {
    latest.current = read
  })

  const subscribe = useCallback((onChange: () => void) => subscribeTo(key, onChange), [key])

  const snapshot = useCallback(() => storeFor(key).value as T | null, [key])
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)

  const reread = useCallback(() => beginRead(key, () => latest.current()), [key])

  // Once for the first reader; later readers take the value already there.
  useEffect(() => {
    if (storeFor(key).value === null) reread()
  }, [key, reread])

  useOnForeground(reread)
  useAttentionNudge(reread)

  return { value, reread }
}
