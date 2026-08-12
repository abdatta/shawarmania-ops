import { AlertTriangle, CheckCircle2, ChevronDown, Server } from 'lucide-react'

import type { BillingDeliveryDiagnostic } from '@/data-access/adapters'
import { formatDayTime } from '@/domain'

const ROUTINE_RESULTS = new Set(['accepted', 'replay', 'applied', 'corrected', 'discarded'])

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

function isSyncProblem(item: BillingDeliveryDiagnostic) {
  return !ROUTINE_RESULTS.has(item.resultCategory)
}

export function ManagerSyncStatus({ diagnostics }: { diagnostics: BillingDeliveryDiagnostic[] }) {
  const problems = diagnostics.filter(isSyncProblem)
  const successful = diagnostics.filter((item) => !isSyncProblem(item))
  const activityCounts = [
    ...successful.reduce((counts, item) => {
      counts.set(item.commandType, (counts.get(item.commandType) ?? 0) + 1)
      return counts
    }, new Map<string, number>()),
  ].sort((left, right) => right[1] - left[1])

  if (diagnostics.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-center">
        <Server aria-hidden size={26} className="mx-auto text-content-muted" />
        <p className="mt-2 font-bold text-content">No recent sync activity</p>
        <p className="mt-1 text-sm text-content-muted">
          Tablet activity will appear here after it reaches the server.
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-3" aria-labelledby="sync-status-heading">
      <div>
        <h2 id="sync-status-heading" className="text-lg font-black text-content">
          Tablet sync status
        </h2>
        <p className="text-sm text-content-muted">
          A read-only check that recent billing activity reached the server.
        </p>
      </div>

      <div
        className={`rounded-xl border bg-surface p-4 ${problems.length > 0 ? 'border-danger' : 'border-success'}`}
      >
        <div className="flex items-start gap-3">
          {problems.length > 0 ? (
            <AlertTriangle aria-hidden size={22} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <CheckCircle2 aria-hidden size={22} className="mt-0.5 shrink-0 text-success" />
          )}
          <div>
            <p className="font-black text-content">
              {problems.length > 0
                ? `${problems.length} recent sync ${problems.length === 1 ? 'problem' : 'problems'}`
                : 'No recent sync problems'}
            </p>
            <p className="mt-1 text-sm text-content-muted">
              {problems.length > 0
                ? 'Check the originating tablet for the correction or discard action.'
                : 'The recent tablet activity shown below reached the server.'}
            </p>
          </div>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="space-y-2" aria-label="Sync problems">
          {problems.map((item) => (
            <article
              key={item.reference}
              className="rounded-xl border border-danger bg-surface p-3"
            >
              <p className="font-bold text-content">
                {actionLabel(item.commandType)} needs attention
              </p>
              <p className="mt-1 text-sm text-content-muted">
                The server reported {plainWords(item.resultCategory)}{' '}
                {formatDayTime(item.receivedAt)}.
              </p>
            </article>
          ))}
        </div>
      )}

      {activityCounts.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <h3 className="font-black text-content">Recent activity delivered</h3>
          <dl className="mt-2 divide-y divide-border">
            {activityCounts.map(([commandType, count]) => (
              <div
                key={commandType}
                className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <dt className="text-sm text-content-muted">{actionLabel(commandType)}</dt>
                <dd className="font-bold text-content">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-bold text-content focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
          <span>Show technical details ({diagnostics.length})</span>
          <ChevronDown
            aria-hidden
            size={18}
            className="text-content-muted transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-border px-3">
          <p className="py-3 text-xs text-content-muted">
            Short references only. Customer details and command contents are never included.
          </p>
          <ul className="divide-y divide-border">
            {[...diagnostics]
              .sort((left, right) => Number(isSyncProblem(right)) - Number(isSyncProblem(left)))
              .map((item) => (
                <li key={item.reference} className="py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                    <span className="font-bold text-content">{actionLabel(item.commandType)}</span>
                    <span className="font-semibold text-content">
                      {plainWords(item.resultCategory)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-content-muted">
                    Reference {item.reference.slice(0, 8)} · received{' '}
                    {formatDayTime(item.receivedAt)}
                  </p>
                </li>
              ))}
          </ul>
        </div>
      </details>
    </section>
  )
}
