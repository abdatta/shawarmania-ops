import { useCallback, useRef, useState } from 'react'

/** A small side-to-side shake, and the pulse that stands in for it under reduced motion. */
const SHAKE: Keyframe[] = [0, -6, 6, -6, 6, 0].map((x) => ({ transform: `translateX(${x}px)` }))
const PULSE: Keyframe[] = [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }]

/**
 * Which field a form refused to save for, and how to point at it
 * (owner, 2026-10-19: "just a message is very annoying"). A refused Save calls
 * `flag(field, message)`: the field is outlined, scrolled into view only if it
 * is not already, focused where it can take input, and shaken once; the
 * message sits under it rather than at the foot of the form. Changing the field
 * clears it.
 *
 * Pair with `<AttentionField>`, which draws the outline and the message.
 */
export interface FieldAttention<K extends string> {
  /** A ref for the field's wrapper. */
  register: (field: K) => (element: HTMLElement | null) => void
  /** Point at a field, with the sentence that says what to do. */
  flag: (field: K, message: string) => void
  /** Stop pointing at a field, once it changes; or at any field. */
  clear: (field?: K) => void
  /** The message for a field, while it is the one flagged. */
  messageFor: (field: K) => string | null
}

export function useFieldAttention<K extends string>(): FieldAttention<K> {
  const elements = useRef(new Map<K, HTMLElement | null>())
  const [flagged, setFlagged] = useState<{ field: K; message: string } | null>(null)

  const register = useCallback(
    (field: K) => (element: HTMLElement | null) => {
      elements.current.set(field, element)
    },
    [],
  )

  const flag = useCallback((field: K, message: string) => {
    setFlagged({ field, message })
    const element = elements.current.get(field)
    if (!element) return
    // `nearest` scrolls only as far as needed, and not at all when it is in view.
    element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const input = element.querySelector<HTMLElement>('input:not([type=radio]), select, textarea')
    input?.focus({ preventScroll: true })
    // A short shake on every refusal, played through the Web Animations API so
    // React's own class list is left alone; under reduced motion, a pulse.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    element.animate?.(reduce ? PULSE : SHAKE, {
      duration: reduce ? 600 : 420,
      easing: 'ease-in-out',
    })
  }, [])

  const clear = useCallback((field?: K) => {
    setFlagged((current) => (!current || !field || current.field === field ? null : current))
  }, [])

  const messageFor = useCallback(
    (field: K) => (flagged?.field === field ? flagged.message : null),
    [flagged],
  )

  return { register, flag, clear, messageFor }
}
