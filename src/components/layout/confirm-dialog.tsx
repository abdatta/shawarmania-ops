import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  /**
   * What will happen, in plain words — "This voids bill 142 and it stops
   * counting towards today's sales", not "Are you sure?".
   */
  consequence: string
  confirmLabel: string
  cancelLabel?: string
  /** Destructive actions get the danger treatment. */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-full max-w-sm rounded-xl p-4"
    >
      <h2 className="text-base font-semibold text-content">{title}</h2>
      <p className="mt-2 text-sm text-content-muted">{consequence}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="phone" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} size="phone" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
