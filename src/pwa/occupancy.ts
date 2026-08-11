/**
 * Whether reloading right now would cost somebody something.
 *
 * A reload is how a new build reaches a running app, and the app decides for
 * itself when to take one (see `apply-update.ts`). This module answers the only
 * question that decision rests on: is there work on this page that a reload
 * would throw away?
 *
 * Three sources, deliberately generic:
 *
 *  1. **Typing**, observed once at the document root rather than registered per
 *     form. Twenty-three files in this app render forms and six of them
 *     hand-roll raw `<input>` elements instead of using the shared control, so
 *     anything that hooked the shared component would already be wrong. A
 *     listener on `document` cannot be bypassed and cannot be forgotten by a
 *     form written next year.
 *  2. **A declaration**, for work a reload would discard that is not held in
 *     form controls at all. The bill composer is the only caller: an order
 *     lives in React state and renders no control, so a fifteen-item order is
 *     invisible to (1).
 *  3. **Writes in flight**, counted once at the adapter seam every write
 *     already passes through.
 *
 * The thresholds below are a judgement, not a proof, and the direction of the
 * error is the point: being wrong here delays a reload, and being wrong the
 * other way loses somebody's typing.
 */

/** Typing across this many separate fields is worth protecting. */
const OCCUPIED_FIELD_COUNT = 3

/** Or roughly a sentence in any single one — a written reason, a note. */
const OCCUPIED_SINGLE_FIELD_CHARACTERS = 40

type TypedElement = Element & { value?: unknown; isContentEditable?: boolean }

/**
 * Elements the person has typed into this session.
 *
 * A strong reference is held deliberately: entries are pruned on read, against
 * the live DOM, which is both cheaper and more accurate than trying to observe
 * removal. A `WeakMap` would collect correctly but cannot be counted.
 */
const typedInto = new Map<TypedElement, number>()

const declarations = new Set<string>()

let writesInFlight = 0

function currentValue(element: TypedElement): string {
  if (typeof element.value === 'string') return element.value
  if (element.isContentEditable) return element.textContent ?? ''
  return ''
}

function handleInput(event: Event): void {
  const target = event.target as TypedElement | null
  if (!target || typeof target.addEventListener !== 'function') return

  const value = currentValue(target)
  if (value === '') {
    // Cleared, so there is nothing left to lose in it.
    typedInto.delete(target)
    return
  }
  typedInto.set(target, value.length)
}

/**
 * Start observing typing.
 *
 * Capturing, so a surface that stops propagation for its own reasons cannot
 * also stop this. Returns a disposer, which the app never calls and the tests
 * always do.
 */
export function watchTypedWork(): () => void {
  document.addEventListener('input', handleInput, true)
  return () => {
    document.removeEventListener('input', handleInput, true)
    typedInto.clear()
  }
}

/**
 * How much typing is currently at risk, pruned against the live DOM.
 *
 * An element that has left the document, or that has since been emptied by
 * something other than typing (a form reset, a controlled re-render), holds
 * nothing worth protecting.
 */
function typedWork(): { fields: number; longest: number } {
  let fields = 0
  let longest = 0

  for (const element of [...typedInto.keys()]) {
    if (!element.isConnected) {
      typedInto.delete(element)
      continue
    }
    const length = currentValue(element).length
    if (length === 0) {
      typedInto.delete(element)
      continue
    }
    typedInto.set(element, length)
    fields += 1
    if (length > longest) longest = length
  }

  return { fields, longest }
}

/**
 * Declare work a reload would discard that lives outside form controls.
 *
 * Returns a release function. The key exists so a surface that mounts twice, or
 * releases late, cannot leave the page permanently occupied.
 */
export function declareUnsavedWork(key: string): () => void {
  declarations.add(key)
  return () => {
    declarations.delete(key)
  }
}

/** Count one write, from the adapter seam. Returns its settle callback. */
export function beginWrite(): () => void {
  writesInFlight += 1
  let settled = false
  return () => {
    if (settled) return
    settled = true
    writesInFlight = Math.max(0, writesInFlight - 1)
  }
}

/** Test seam. The app never resets; a test suite must. */
export function resetOccupancy(): void {
  typedInto.clear()
  declarations.clear()
  writesInFlight = 0
}

export type OccupancyReason = 'offline' | 'declared' | 'typing' | 'writing'

/**
 * Why a reload would cost something right now, or `null` if it would not.
 *
 * Offline is included because a reload is not only about losing what is on
 * screen: a counter that reloads without a backend cannot get the fresh
 * approved shift it needs to resume billing.
 */
export function occupancyReason(): OccupancyReason | null {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (declarations.size > 0) return 'declared'
  if (writesInFlight > 0) return 'writing'

  const { fields, longest } = typedWork()
  if (fields >= OCCUPIED_FIELD_COUNT) return 'typing'
  if (longest >= OCCUPIED_SINGLE_FIELD_CHARACTERS) return 'typing'

  return null
}

/** Would reloading right now cost somebody something? */
export function isOccupied(): boolean {
  return occupancyReason() !== null
}
