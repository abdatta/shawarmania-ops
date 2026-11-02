import { Bike, Store } from 'lucide-react'
import { useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'

import type { OrderScope } from './order-scope-memory'

/**
 * Counter or Delivery, as a small pill that opens a sheet
 * (delivery-orders-are-made-not-billed, D7). The owner looks at delivery
 * figures now and then, so the choice stays out of the page's way, as Compare
 * does [owner, 2026-11-01]. Its words light up only while it reads Delivery.
 */
export function OrderScopePill({
  scope,
  onChange,
  testId,
  compact = false,
}: {
  /** The icon alone, beside other pills in a tight row; the label still names it. */
  compact?: boolean
  scope: OrderScope
  onChange: (scope: OrderScope) => void
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const Icon = scope === 'delivery' ? Bike : Store
  return (
    <>
      <Button
        size="phone"
        variant="ghost"
        className="shrink-0 rounded-full px-1"
        aria-label={`Which orders: ${scope === 'delivery' ? 'Delivery' : 'Counter'}`}
        aria-haspopup="dialog"
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 text-xs">
          <Icon
            size={14}
            aria-hidden
            className={scope === 'delivery' ? 'text-accent-text' : undefined}
          />
          {!compact && (
            <span className={scope === 'delivery' ? 'font-bold text-accent-text' : undefined}>
              {scope === 'delivery' ? 'Delivery' : 'Counter'}
            </span>
          )}
        </span>
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title="Which orders">
        <div className="grid gap-2">
          {(
            [
              ['counter', 'Counter'],
              ['delivery', 'Delivery'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={value === scope ? 'primary' : 'secondary'}
              aria-pressed={value === scope}
              data-testid={`${testId}-${value}`}
              onClick={() => {
                onChange(value)
                setOpen(false)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </FormSheet>
    </>
  )
}
