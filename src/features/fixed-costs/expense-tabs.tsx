import { Link, useSearchParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

import { useFixedCostsUnpaidAttention } from './attention'
import { useExpensesBase } from './use-fixed-tab'

/**
 * **Daily | Fixed**, the two tabs of the one Expenses entry
 * (fixed-costs-are-spread-over-the-month, owner, 2026-10-19). Drawn like the
 * Ledger's One day | The month, but each tab is its own address, so Back, a
 * badge and a link from Needs attention each land on the tab they mean.
 *
 * Tabs rather than one scroll because the two answer different scopes: Daily is
 * one business day under its date stepper, Fixed is the month and what is owed,
 * and on one page the stepper would read as controlling both.
 */
export function ExpenseTabs({ current }: { current: 'daily' | 'fixed' }) {
  const base = useExpensesBase()
  const [address] = useSearchParams()
  const outlet = address.get('outlet')
  const query = outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''
  // The Expenses badge counts fixed costs left unpaid, so the tab that holds
  // them carries it too (owner, 2026-10-20): arriving on Daily, the eye goes to
  // Fixed. The app's own badge, drawn as Delivery's channel switch draws it; the
  // amber and red are Overview's alone. One shared read, no new request.
  const owed = useFixedCostsUnpaidAttention()
  return (
    <nav
      aria-label="Expenses"
      className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
      data-testid="expense-tabs"
    >
      {(
        [
          ['daily', 'Daily', `${base}/ledger/expenses${query}`],
          ['fixed', 'Fixed', `${base}/ledger/fixed-costs${query}`],
        ] as const
      ).map(([key, label, to]) => (
        <Link
          key={key}
          to={to}
          replace
          aria-current={current === key ? 'page' : undefined}
          data-testid={`expense-tab-${key}`}
          className={cn(
            'flex h-[var(--size-control-phone)] items-center justify-center gap-1.5 rounded-lg text-sm font-semibold focus-visible:focus-ring',
            current === key
              ? 'bg-primary text-on-primary'
              : 'text-content-muted hover:bg-surface-raised hover:text-content',
          )}
        >
          {label}
          {key === 'fixed' && owed && (
            <Badge
              data-testid="expense-tab-fixed-owed"
              count={owed.count}
              label={`Fixed: ${owed.label}`}
              // A selected tab is filled with `--primary`, the badge's own colour:
              // the same asserted pair the other way round, as Delivery does.
              className={current === key ? 'bg-on-primary text-primary' : ''}
            />
          )}
        </Link>
      ))}
    </nav>
  )
}
