import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

import { useKeypadKeys } from '@/components/ui/use-keypad-keys'
import { cn } from '@/lib/cn'

/**
 * A press on the backdrop this soon after the dialog opens is the second tap of
 * a double-tap on the button that opened it, not a decision to close it.
 */
const OUTSIDE_TAP_GRACE_MS = 400

interface ModalProps {
  open: boolean
  /** Fired when the dialog closes for any reason, including Escape. */
  onClose: () => void
  children: ReactNode
  /** Classes for the dialog panel itself. */
  className?: string
  'aria-label'?: string
  /**
   * Whether a tap on the dimmed space outside the panel closes it. Yes unless
   * a dialog passes false;
   * every dialog that takes a `busy` passes `!busy`, so a request in flight is
   * not walked away from by a stray tap.
   */
  dismissOnOutsideTap?: boolean
}

/**
 * Whether a pointer event landed on the dialog's backdrop.
 *
 * A native dialog is the `target` of a click on its `::backdrop` and also of one
 * on its own padding, so the target alone cannot tell them apart: the position
 * is compared with the panel's rectangle. A target that is not the dialog is a
 * control inside it, or a dialog opened over it whose event is bubbling up the
 * React tree.
 */
function landedOutside(event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false
  const panel = event.currentTarget.getBoundingClientRect()
  return (
    event.clientX < panel.left ||
    event.clientX > panel.right ||
    event.clientY < panel.top ||
    event.clientY > panel.bottom
  )
}

/**
 * The one modal base, on the native <dialog> element: the top layer, focus
 * containment and Escape handling come from the platform instead of a
 * dependency. FormSheet and ConfirmDialog compose it; feature code should
 * reach for those, not this.
 *
 * **Escape cannot be tested through an automated in-app browser, and looking
 * broken there means nothing.** Measured 2026-08-17: a synthetic Escape reaches
 * the page — a document listener counts it — and the open dialog stays open. So
 * does a bare `<dialog>` injected into the same page with no React near it,
 * which receives no `cancel` event at all. Closing on Escape is a user-agent
 * action rather than a page one, and a synthetic key event does not trigger it.
 *
 * It works. `e2e/dialog-escape.spec.ts` proves it in a real browser, on both the
 * shared ConfirmDialog and a bare dialog, and exists so that nobody spends an
 * afternoon on this twice.
 *
 * A dialog carrying a number pad also takes a physical keyboard, by marking its
 * keys `data-keypad-key` — see `useKeypadKeys`.
 *
 * **Tapping the backdrop is not the platform's, and used to close nothing.** A
 * modal `<dialog>` takes Escape and focus containment from the top layer; a click
 * on its `::backdrop` is only a click whose target is the dialog. A press that
 * starts on the backdrop and a release that ends on it close the dialog through `onClose` — the same call its
 * Close button makes, so a dialog that refuses to close while it saves refuses
 * this too, and one that records a decision on close records it. A press that
 * starts inside and ends outside (selecting text past the edge), a tap on the
 * dialog's own padding, and any press that begins in the first 400 ms (a
 * double-tap on the button that opened it) close nothing. See
 * `a-popup-closes-when-you-tap-outside-it`.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  dismissOnOutsideTap = true,
  ...props
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedOutside = useRef(false)
  const openedAt = useRef(0)
  useKeypadKeys(ref, open)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      openedAt.current = performance.now()
      // A press the last opening saw cancelled (a scroll, a lost pointer) never
      // reached its click, so nothing cleared it.
      pressedOutside.current = false
      dialog.showModal()
      // React commits children before this effect opens the native dialog.
      // An autofocus control is inert during that commit, so browsers can
      // otherwise leave focus on the trigger (or pick the close button).
      dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]')?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      // **Stopped, not merely forwarded.** A `close` event does not bubble in
      // the DOM, but React's synthetic system propagates it up the REACT tree —
      // and a portalled modal's React parent may be a component sitting inside
      // another modal. Without this, dismissing an explanation opened over the
      // count sheet closed the count sheet with it, losing everything typed.
      // A dialog closing is its own business; no ancestor needs telling.
      onClose={(event) => {
        event.stopPropagation()
        onClose()
      }}
      className={cn(
        'border border-border bg-surface text-content shadow-lg backdrop:bg-content/40',
        className,
      )}
      {...(dismissOnOutsideTap
        ? {
            // The grace is read when the finger comes down, not when it lifts:
            // a press that began in it began on a backdrop that was not there
            // when the person aimed, however long they then held it.
            onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
              pressedOutside.current =
                landedOutside(event) && performance.now() - openedAt.current >= OUTSIDE_TAP_GRACE_MS
            },
            onClick: (event: MouseEvent<HTMLDialogElement>) => {
              const startedOutside = pressedOutside.current
              pressedOutside.current = false
              if (startedOutside && landedOutside(event)) onClose()
            },
          }
        : {})}
      {...props}
    >
      {open ? children : null}
    </dialog>
  )
}
