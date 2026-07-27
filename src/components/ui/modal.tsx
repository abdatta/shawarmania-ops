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
      onClose={() => onClose()}
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
