import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  /** Fired when the dialog closes for any reason, including Escape. */
  onClose: () => void
  children: ReactNode
  /** Classes for the dialog panel itself. */
  className?: string
  'aria-label'?: string
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
 */
export function Modal({ open, onClose, children, className, ...props }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
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
      {...props}
    >
      {open ? children : null}
    </dialog>
  )
}
