import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
} from 'react'

import { cn } from '@/lib/cn'

/** Its height set to its text, border included. Nothing to measure while it is hidden. */
function fitHeight(element: HTMLTextAreaElement) {
  if (element.clientWidth === 0) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`
}

type TextAreaProps = Omit<ComponentProps<'textarea'>, 'rows'> & {
  /**
   * Text that wraps for reading but is one line when saved: Enter submits the
   * form, as it does in an `Input`, and a pasted line break becomes a space.
   * For a field whose text is shown on one line elsewhere (a dish description
   * on the counter, the receipt and the customer menu).
   */
  singleLine?: boolean
}

/**
 * `Input`'s twin for text longer than its box: it starts one line high, wraps,
 * and grows with what is typed, so nothing runs sideways out of sight
 * (the-dish-description-wraps). Same border, ground and focus ring as `Input`.
 */
export function TextArea({ className, singleLine, onChange, onKeyDown, ...props }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grown to its text on every change, measured from one line so it shrinks too.
  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current)
  }, [props.value])

  // And again once it is laid out and whenever its width changes: a text area
  // inside a pop-up renders before the pop-up is shown, when it has no size to
  // measure, and a wider or narrower box wraps differently.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let width = -1
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      fitHeight(element)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    if (singleLine && /[\r\n]/.test(event.target.value)) {
      event.target.value = event.target.value.replace(/\s*[\r\n]+\s*/g, ' ')
    }
    onChange?.(event)
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event)
    if (
      singleLine &&
      !event.defaultPrevented &&
      event.key === 'Enter' &&
      !event.nativeEvent.isComposing
    ) {
      // Never a line break; a plain Enter saves, as in a one-line box.
      event.preventDefault()
      if (!event.shiftKey) event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      onChange={change}
      onKeyDown={keyDown}
      className={cn(
        'block min-h-[var(--size-control)] w-full resize-none overflow-hidden rounded-lg border border-border bg-surface px-3 py-2.5 leading-snug',
        'text-content placeholder:text-content-muted focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
