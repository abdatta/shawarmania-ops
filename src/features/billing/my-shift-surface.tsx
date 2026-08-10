import { AlertTriangle, ClipboardList } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import {
  BILLING_PAYMENT_METHODS,
  DataActionError,
  type BillingAttentionItem,
  type ShiftBillingHistory,
} from '@/data-access/adapters'
import { formatDateTime } from '@/domain'
import { newUuid } from '@/lib/uuid'

import { ShiftBillList } from './shift-bill-list'
import { useCounterState } from './use-counter-state'

export function MyShiftSurface({
  embedded = false,
  refreshKey = 0,
  onActivityChanged,
}: {
  embedded?: boolean
  refreshKey?: number
  onActivityChanged?: () => void
} = {}) {
  const { billing } = useAdapters()
  const { shift } = useCounterState()
  const [history, setHistory] = useState<ShiftBillingHistory | null>(null)
  const [attention, setAttention] = useState<BillingAttentionItem[]>([])
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!shift) {
      setAttention([])
      return setHistory({ bills: [], totals: [] })
    }
    const [nextHistory, nextAttention] = await Promise.all([
      billing.listShiftHistory(shift.id),
      billing.listAttention(),
    ])
    setHistory(nextHistory)
    setAttention(nextAttention)
  }, [billing, shift])

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => setMessage('Could not load this shift.'))
  }, [load, refreshKey])

  const resolve = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation()
      setMessage(success)
      setReason('')
      await load()
      onActivityChanged?.()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That item could not be resolved.',
      )
    }
  }

  if (history === null)
    return (
      <LoadingRegion label="this shift" className="space-y-2">
        <Shimmer className="h-12" />
        <Shimmer className="h-28" />
      </LoadingRegion>
    )

  return (
    <section className={embedded ? 'space-y-3' : 'space-y-5'} aria-labelledby="my-shift-title">
      <div>
        {embedded ? (
          <h3 id="my-shift-title" className="text-sm font-black text-content">
            Bills this shift
          </h3>
        ) : (
          <h1 id="my-shift-title" className="text-2xl font-black text-content">
            My shift
          </h1>
        )}
        <p className={embedded ? 'text-xs text-content-muted' : 'text-sm text-content-muted'}>
          Paid bills from this tablet&rsquo;s current shift only.
        </p>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
        >
          {message}
        </p>
      )}
      <div
        className={embedded ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}
      >
        {BILLING_PAYMENT_METHODS.map((method) => {
          const total = history.totals.find((candidate) => candidate.method === method)
          return (
            <div
              key={method}
              data-testid={`shift-total-${method}`}
              className={
                embedded
                  ? 'rounded-lg bg-surface-raised p-2'
                  : 'rounded-xl border border-border bg-surface p-3'
              }
            >
              <p className="text-xs font-bold uppercase text-content-muted">{method}</p>
              <Money paise={total?.totalPaise ?? 0} display />
            </div>
          )
        })}
      </div>
      {history.bills.length === 0 ? (
        embedded ? (
          <p className="rounded-lg bg-surface-raised p-3 text-sm text-content-muted">
            No paid bills in this shift yet.
          </p>
        ) : (
          <EmptyState icon={ClipboardList} title="No paid bills in this shift yet." />
        )
      ) : (
        <ShiftBillList bills={history.bills} compact={embedded} />
      )}
      {attention
        .filter((item) => item.state === 'needs_attention')
        .map((item) => (
          <article
            key={item.reference}
            className={
              embedded
                ? 'rounded-lg border-2 border-danger bg-surface p-3'
                : 'rounded-xl border-2 border-danger bg-surface p-4'
            }
          >
            <div className="flex gap-2">
              <AlertTriangle aria-hidden className="shrink-0 text-danger" />
              <div className="min-w-0">
                <h2 className="font-bold text-content">Payment needs attention</h2>
                <p className="text-sm text-content-muted">{item.refusedTrace}</p>
                <p className="mt-1 text-xs text-content-muted">
                  Reference {item.reference.slice(0, 8)} · {formatDateTime(item.receivedAt)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="phone"
                onClick={() =>
                  void resolve(
                    () => billing.correctAttention(item.reference, newUuid()),
                    'A linked correction was created with a new identity. The refused trace remains here.',
                  )
                }
              >
                Correct with new copy
              </Button>
              <Input
                className="min-w-48 flex-1"
                aria-label="Discard reason"
                placeholder="Reason to discard"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="danger"
                size="phone"
                disabled={!reason.trim()}
                onClick={() =>
                  void resolve(
                    () => billing.discardAttention(item.reference, reason),
                    'The item was discarded with its reason and trace retained.',
                  )
                }
              >
                Discard
              </Button>
            </div>
          </article>
        ))}
    </section>
  )
}
