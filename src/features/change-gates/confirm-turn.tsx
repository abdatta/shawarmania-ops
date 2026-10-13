import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'

/** The database refuses a longer reason; the field stops there first. */
export const REASON_MAX = 200

/**
 * The confirmation before a turn, with an optional reason for the history.
 *
 * It says what will happen rather than asking "Are you sure?": every tablet
 * takes the change at its next free moment, which is the one fact that decides
 * whether now is a good time (design D6, D18).
 */
export function ConfirmTurn({
  open,
  title,
  turningOn,
  alsoOff = [],
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  turningOn: boolean
  /** The gates depending on this one that turning it off also turns off. */
  alsoOff?: string[]
  busy: boolean
  onConfirm: (reason: string | null) => void
  onClose: () => void
}) {
  const verb = turningOn ? 'Turn on' : 'Turn off'
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={`${verb} ${title}?`}
      className="m-auto w-full max-w-sm rounded-xl p-4"
    >
      {/* Mounted only while open, so each opening starts with an empty reason:
          last time's reason is not this time's. */}
      {open && (
        <TurnForm
          title={title}
          verb={verb}
          turningOn={turningOn}
          alsoOff={alsoOff}
          busy={busy}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      )}
    </Modal>
  )
}

function TurnForm({
  title,
  verb,
  turningOn,
  alsoOff,
  busy,
  onConfirm,
  onClose,
}: {
  title: string
  verb: string
  turningOn: boolean
  alsoOff: string[]
  busy: boolean
  onConfirm: (reason: string | null) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const reasonId = useId()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = reason.trim()
        onConfirm(trimmed === '' ? null : trimmed)
      }}
      data-testid="confirm-turn"
    >
      <h2 className="text-base font-semibold text-content">
        {verb} {title}?
      </h2>
      <p className="mt-2 text-sm text-content-muted">
        Every tablet switches at its next free moment, within a minute.
      </p>
      {alsoOff.length > 0 && (
        <p className="mt-2 text-sm text-content" data-testid="turn-also-off">
          This also turns off {alsoOff.join(', ')}, which{' '}
          {alsoOff.length === 1 ? 'depends' : 'depend'} on it.
        </p>
      )}
      <label htmlFor={reasonId} className="mt-4 block text-xs text-content-muted">
        Reason (optional)
      </label>
      <Input
        id={reasonId}
        value={reason}
        maxLength={REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
        className="mt-1"
        data-testid="turn-reason"
      />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="phone" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={turningOn ? 'primary' : 'danger'}
          size="phone"
          disabled={busy}
          data-testid="confirm-turn-submit"
        >
          {verb}
        </Button>
      </div>
    </form>
  )
}
