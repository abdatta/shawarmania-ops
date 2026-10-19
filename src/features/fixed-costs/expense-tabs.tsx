import { Link, useSearchParams } from 'react-router'

import { cn } from '@/lib/cn'

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
            'flex h-[var(--size-control-phone)] items-center justify-center rounded-lg text-sm font-semibold focus-visible:focus-ring',
            current === key
              ? 'bg-primary text-on-primary'
              : 'text-content-muted hover:bg-surface-raised hover:text-content',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
