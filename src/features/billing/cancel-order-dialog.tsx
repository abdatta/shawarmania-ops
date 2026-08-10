import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'

const REASONS = [
  'Customer changed mind',
  'Duplicate order',
  'Item unavailable',
  'Order entered incorrectly',
] as const

/** Reasoned cancellation: presets fill one field that always remains editable. */
type CancelOrderDialogProps = {
  open: boolean
  orderNumber: number
  busy?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

export function CancelOrderDialog(props: CancelOrderDialogProps) {
  if (!props.open) return null
  return <OpenCancelOrderDialog {...props} />
}

function OpenCancelOrderDialog({
  orderNumber,
  busy = false,
  onClose,
  onConfirm,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState('')

  return (
    <Modal
      open
      onClose={onClose}
      aria-label={`Cancel order ${orderNumber}`}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl p-4"
    >
      <h2 className="text-lg font-black text-content">Cancel order {orderNumber}</h2>
      <p className="mt-1 text-sm text-content-muted">
        The order leaves active work, but its reason and audit trail remain.
      </p>

      <div
        className="mt-4 grid grid-cols-2 gap-2"
        role="group"
        aria-label="Common cancellation reasons"
      >
        {REASONS.map((candidate) => (
          <Button
            key={candidate}
            variant={reason === candidate ? 'primary' : 'secondary'}
            size="phone"
            aria-pressed={reason === candidate}
            onClick={() => setReason(candidate)}
          >
            {candidate}
          </Button>
        ))}
      </div>

      <Input
        className="mt-3"
        aria-label="Cancellation reason"
        placeholder="Choose above or type a reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="control" onClick={onClose}>
          Keep order
        </Button>
        <Button
          variant="danger"
          size="control"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason.trim())}
        >
          Confirm cancel
        </Button>
      </div>
    </Modal>
  )
}
