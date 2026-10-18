import { AlertTriangle } from 'lucide-react'

import type { BillingDeliveryDiagnostic } from '@/data-access/adapters'
import { formatDayTime, isCorrectableRefusal } from '@/domain'

const ACTION_LABELS: Record<string, string> = {
  pay_now: 'Bills paid',
  pay_order: 'Orders paid',
  create_order: 'Orders created',
  revise_order: 'Orders updated',
  cancel_order: 'Orders cancelled',
  manager_cancel_order: 'Orders cancelled by a manager',
  void_bill: 'Bills cancelled',
  correct_bill_payment: 'Payments corrected',
  confirm_billing_end_of_day: 'Tablet sign-offs',
}

function plainWords(value: string) {
  return value.replaceAll('_', ' ')
}

function actionLabel(commandType: string) {
  return (
    ACTION_LABELS[commandType] ??
    plainWords(commandType).replace(/^./, (letter) => letter.toUpperCase())
  )
}

/** How long ago, in the fewest words that are still exact enough to act on. */
export function syncAge(receivedAt: string, now: Date): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - Date.parse(receivedAt)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return formatDayTime(receivedAt, now)
}

/**
 * The tablets' sync, as one chip above the day's Stats (billing-day-at-a-glance,
 * design D3): the newest received command's age, which is a reading of now and
 * ignores the date, or the chosen day's refusals, each listed beneath in plain
 * words. Both come from the day's one read, so the Stats tab's red count is the
 * length of exactly this list (billing-history-reads-what-it-shows, design D2).
 * The grouped counts and the technical details it replaced were never read
 * (owner, 2026-10-16).
 *
 * Deliberately not an attention badge: that spec reserves those for work the
 * reader can act on, and a manager cannot clear a refusal from this screen.
 */
export function ManagerSyncStatus({
  problems,
  newestAt: newest,
  now = new Date(),
}: {
  problems: readonly BillingDeliveryDiagnostic[]
  newestAt: string | null
  now?: Date
}) {
  return (
    <section className="space-y-2" aria-label="Tablet sync">
      <p
        data-testid="sync-chip"
        className={`inline-flex min-h-9 items-center gap-2 rounded-full border bg-surface px-3 text-sm font-semibold text-content ${problems.length > 0 ? 'border-danger' : newest === null ? 'border-border' : 'border-success'}`}
      >
        <span
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full ${problems.length > 0 ? 'bg-danger' : newest === null ? 'bg-content-muted' : 'bg-success'}`}
        />
        {problems.length > 0
          ? `${problems.length} sync ${problems.length === 1 ? 'problem' : 'problems'}`
          : newest === null
            ? 'No tablet activity yet'
            : `In sync · ${syncAge(newest, now)}`}
      </p>

      {problems.length > 0 && (
        <div className="space-y-2" aria-label="Sync problems">
          {problems.map((item) => (
            <article
              key={item.reference}
              className="flex items-start gap-3 rounded-xl border border-danger bg-surface p-3"
            >
              <AlertTriangle aria-hidden size={20} className="mt-0.5 shrink-0 text-danger" />
              <div>
                <p className="font-bold text-content">
                  {actionLabel(item.commandType)} needs attention
                  {item.orderNumber === null ? '' : ` · Order ${item.orderNumber}`}
                </p>
                <p className="mt-1 text-sm text-content-muted">
                  The server reported {plainWords(item.resultCategory)}{' '}
                  {formatDayTime(item.receivedAt)}.
                  {isCorrectableRefusal(item.resultCategory)
                    ? ' The tablet that sent it can correct it.'
                    : ' Resending it cannot change the answer, so the tablet should discard it.'}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
