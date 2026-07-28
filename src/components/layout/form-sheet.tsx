import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface FormSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Sticky footer slot — typically the submit button. */
  footer?: ReactNode
  /**
   * Why the last submit was refused, shown against the button that was
   * pressed.
   *
   * Every surface using this sheet also renders an error region on the page
   * behind it, which is right for failures that happen with no sheet open — a
   * refused delete, a failed reopen. But this sheet is a `fixed` overlay and
   * covers the whole screen on a phone, so a refusal left on the page behind
   * it is invisible: the person presses the button, nothing is written, and
   * nothing is said. Passing the same message here puts it where they are
   * looking. The page-level region still shows it once the sheet closes, and
   * only one of the two is ever on screen at a time.
   */
  error?: string | null
}

/**
 * The container later feature forms fill: a bottom sheet on phones, a side
 * sheet on wider screens. Inputs inside inherit the 16px floor from the base
 * layer, so mobile browsers never zoom on focus.
 */
export function FormSheet({ open, onClose, title, children, footer, error }: FormSheetProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={title}
      className={
        'fixed inset-x-0 bottom-0 m-0 w-full max-w-none rounded-t-xl border-t p-0 ' +
        'sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-dvh sm:max-h-none sm:w-96 ' +
        'sm:rounded-none sm:border-l sm:border-t-0'
      }
    >
      <div className="flex h-full max-h-[85dvh] flex-col sm:max-h-none">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-base font-semibold text-content">{title}</h2>
          <Button variant="ghost" size="phone" aria-label="Close" onClick={onClose}>
            <X aria-hidden size={18} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {(error || footer) && (
          <div className="border-t border-border p-4">
            {error && (
              <p
                role="alert"
                data-testid="form-sheet-error"
                className="mb-3 text-sm font-semibold text-danger"
              >
                {error}
              </p>
            )}
            {footer}
          </div>
        )}
      </div>
    </Modal>
  )
}
