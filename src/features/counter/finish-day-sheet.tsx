import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { useAdapters } from '@/data-access'
import type { FinishDayReadiness } from '@/data-access/adapters'

export function FinishDaySheet({
  open,
  shiftId,
  onClose,
  onFinished,
  offline = false,
}: {
  open: boolean
  shiftId: string
  onClose: () => void
  onFinished: () => void
  offline?: boolean
}) {
  const { billing } = useAdapters()
  const [readiness, setReadiness] = useState<FinishDayReadiness | null>(null)
  const [checking, setChecking] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const answer = await billing.inspectFinishDay(shiftId)
      setReadiness(offline ? { ...answer, serverReachable: false, canFinish: false } : answer)
    } catch (cause) {
      setReadiness(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'The tablet could not check what is blocking Finish Day.',
      )
    } finally {
      setChecking(false)
    }
  }, [billing, shiftId, offline])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void check(), 0)
    return () => window.clearTimeout(timer)
  }, [check, open])

  async function finish() {
    if (!readiness?.canFinish) return
    setFinishing(true)
    setError(null)
    try {
      await billing.closeShift(shiftId)
      onFinished()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The day could not be finished.')
      await check()
    } finally {
      setFinishing(false)
    }
  }

  const busy = checking || finishing

  return (
    <FormSheet
      open={open}
      title="Finish day"
      onClose={busy ? () => undefined : onClose}
      error={error}
      footer={
        <div className="grid gap-2">
          {readiness?.canFinish ? (
            <>
              {readiness.editablePaymentCount > 0 && (
                <Button variant="secondary" size="phone" onClick={onClose} disabled={busy}>
                  Review recent payments
                </Button>
              )}
              <Button size="phone" onClick={() => void finish()} disabled={busy}>
                {finishing
                  ? 'Finishing…'
                  : readiness.editablePaymentCount > 0
                    ? 'Finish day now'
                    : 'Finish day'}
              </Button>
            </>
          ) : readiness && !readiness.serverReachable ? null : (
            <Button size="phone" onClick={() => void check()} disabled={busy}>
              {checking ? 'Checking again…' : 'Check again'}
            </Button>
          )}
          <Button variant="secondary" size="phone" onClick={onClose} disabled={busy}>
            Keep billing
          </Button>
        </div>
      }
    >
      {checking && !readiness ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-content-muted">
          <LoaderCircle aria-hidden size={18} className="animate-spin motion-reduce:animate-none" />
          Sending what is ready and checking the server…
        </div>
      ) : readiness ? (
        <div className="space-y-3" data-testid="finish-day-readiness">
          {readiness.canFinish ? (
            <div className="rounded-xl border border-success p-3">
              <p className="flex items-center gap-2 font-semibold text-content">
                <CheckCircle2 aria-hidden size={18} className="text-success" />
                The tablet is ready to finish.
              </p>
            </div>
          ) : (
            <p className="text-sm text-content-muted">
              Resolve each item below. Finish Day never skips billing work or an unavailable server
              check.
            </p>
          )}

          {!readiness.serverReachable && (
            <Blocker
              title="Finish Day is unavailable offline"
              resolution="Authoritative server state is unavailable. Keep billing, reconnect this tablet, and return here after every unsent action has drained. No local end-of-day confirmation was created."
            />
          )}
          {readiness.unsentCount > 0 && (
            <Blocker
              title={`${readiness.unsentCount} action${readiness.unsentCount === 1 ? '' : 's'} still sending`}
              resolution={
                readiness.serverReachable
                  ? 'Keep the tablet online. This sheet sends automatically; choose Check again after the count reaches zero.'
                  : 'Reconnect this tablet. Delivery resumes after the tablet and shift are confirmed again.'
              }
            />
          )}
          {readiness.needsAttentionCount > 0 && (
            <Blocker
              title={`${readiness.needsAttentionCount} action${readiness.needsAttentionCount === 1 ? ' needs' : 's need'} attention`}
              resolution="Close this sheet, open the marked item on the tablet, and correct or discard it with a reason."
            />
          )}
          {readiness.openOrderCount > 0 && (
            <Blocker
              title={`${readiness.openOrderCount} open order${readiness.openOrderCount === 1 ? '' : 's'}`}
              resolution="Close this sheet and prepare, pay, or cancel every open order in the pipeline."
            />
          )}

          {readiness.editablePaymentCount > 0 && (
            <div className="rounded-xl border border-warning p-3">
              <p className="font-semibold text-content">
                {readiness.editablePaymentCount} recent payment
                {readiness.editablePaymentCount === 1 ? ' can' : 's can'} still be edited
              </p>
              <p className="mt-1 text-sm text-content-muted">
                This is not a blocker. Review it now, keep billing, or finish immediately and end
                its quick-edit window.
              </p>
            </div>
          )}

          {readiness.attributionExceptionCount > 0 && (
            <p className="text-sm text-content-muted">
              {readiness.attributionExceptionCount} earlier flagged bill
              {readiness.attributionExceptionCount === 1 ? ' is' : 's are'} included in today’s
              takings and awaiting manager review. This does not block Finish Day.
            </p>
          )}
        </div>
      ) : null}
    </FormSheet>
  )
}

function Blocker({ title, resolution }: { title: string; resolution: string }) {
  return (
    <div className="rounded-xl border border-danger p-3">
      <p className="flex items-center gap-2 font-semibold text-content">
        <CircleAlert aria-hidden size={18} className="text-danger" />
        {title}
      </p>
      <p className="mt-1 text-sm text-content-muted">{resolution}</p>
    </div>
  )
}
