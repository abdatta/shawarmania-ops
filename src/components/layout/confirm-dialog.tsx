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
  /**
   * The safer thing this dialog recommends, offered here rather than only named.
   *
   * Where the consequence says "try X first", X has to be reachable from the
   * dialog: sending somebody back out to find a button they were just told to
   * press is how they press the wrong one instead.
   */
  alternative?: { label: string; onClick: () => void }
  /** Work already in flight. Every control goes dead, so nothing runs twice. */
  busy?: boolean
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
  alternative,
  busy = false,
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
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="phone" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        {alternative && (
          // Between Cancel and the commitment, because it is neither: it is the
          // thing the consequence just recommended.
          <Button variant="secondary" size="phone" onClick={alternative.onClick} disabled={busy}>
            {alternative.label}
          </Button>
        )}
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="phone"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
