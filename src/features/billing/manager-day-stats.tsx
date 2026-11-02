import { ChefHat, ReceiptText, Store, type LucideIcon } from 'lucide-react'

import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import type { BillingDayStats } from '@/data-access/adapters'

/**
 * A duration as the Stats tab reads it: `45s`, `6m 40s`, `1h 05m`; a dash where
 * nothing could be measured, never a zero that claims something was.
 */
export function formatStatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${whole}s`
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) return `${minutes}m ${String(whole % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

interface Figure {
  label: string
  value: string
  testId: string
}

/**
 * One group: a header over a 2 × 2 grid divided by hairlines, the number above
 * its caption — the Overview card's divided grid, deliberately unlike the
 * bordered Cash / UPI / Total / AOV tiles above the tabs (owner, 2026-10-16).
 */
function StatGroup({
  title,
  icon: Icon,
  figures,
}: {
  title: string
  icon: LucideIcon
  figures: readonly [Figure, Figure, Figure, Figure]
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-bold text-content">
        <Icon aria-hidden size={18} className="text-accent-text" />
        {title}
      </h3>
      <dl className="grid grid-cols-2">
        {figures.map((figure, index) => (
          <div
            key={figure.label}
            className={`flex flex-col-reverse px-4 py-3 ${index % 2 === 0 ? 'border-r border-border' : ''} ${index < 2 ? 'border-b border-border' : ''}`}
          >
            <dt className="text-sm text-content-muted">{figure.label}</dt>
            <dd data-testid={figure.testId} className="text-xl font-black leading-7 text-content">
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const count = (value: number) => value.toLocaleString('en-IN')

/** The chosen day's figures in three groups, one below the other (design D3). */
export function ManagerDayStats({ stats }: { stats: BillingDayStats }) {
  return (
    <div className="space-y-3" data-testid="day-stats">
      <StatGroup
        title="Counter"
        icon={Store}
        figures={[
          { label: 'Placed', value: count(stats.placed), testId: 'stat-placed' },
          { label: 'Updated', value: count(stats.updated), testId: 'stat-updated' },
          { label: 'Cancelled', value: count(stats.cancelled), testId: 'stat-cancelled' },
          { label: 'Paid', value: count(stats.paid), testId: 'stat-paid' },
        ]}
      />
      <StatGroup
        title="Kitchen"
        icon={ChefHat}
        figures={[
          { label: 'Seen', value: count(stats.seen), testId: 'stat-seen' },
          { label: 'Ready', value: count(stats.ready), testId: 'stat-ready' },
          {
            label: 'Avg to ready',
            value: formatStatDuration(stats.toReadySeconds),
            testId: 'stat-to-ready',
          },
          {
            label: 'Avg handover',
            value: formatStatDuration(stats.handoverSeconds),
            testId: 'stat-handover',
          },
        ]}
      />
      <StatGroup
        title="Bills"
        icon={ReceiptText}
        figures={[
          {
            label: 'Bills cancelled',
            value: count(stats.billsCancelled),
            testId: 'stat-bills-cancelled',
          },
          {
            label: 'Cancelled after paid',
            value: count(stats.cancelledAfterPaid),
            testId: 'stat-cancelled-after-paid',
          },
          {
            label: 'Payment undone',
            value: count(stats.paymentUndone),
            testId: 'stat-payment-undone',
          },
          {
            label: 'Payment changed',
            value: count(stats.paymentChanged),
            testId: 'stat-payment-changed',
          },
        ]}
      />
    </div>
  )
}

/** The three groups' own silhouette, so nothing moves when the read lands. */
export function ManagerDayStatsShimmer({ groups = 3 }: { groups?: 2 | 3 }) {
  return (
    <LoadingRegion label="the day’s stats" className="space-y-3">
      {(groups === 2 ? [0, 1] : [0, 1, 2]).map((group) => (
        <div key={group} className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5">
            <Shimmer className="h-5 w-24" />
          </div>
          <div className="grid grid-cols-2">
            {[0, 1, 2, 3].map((cell) => (
              <div
                key={cell}
                className={`space-y-1 px-4 py-3 ${cell % 2 === 0 ? 'border-r border-border' : ''} ${cell < 2 ? 'border-b border-border' : ''}`}
              >
                <Shimmer className="h-7 w-12" />
                <Shimmer className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}
