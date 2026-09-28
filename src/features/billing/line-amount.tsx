import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { isWaivedPackaging, lineTotalPaise } from '@/domain'
import { cn } from '@/lib/cn'

/**
 * A line's amount where a bill is read back: its total, or — for waived
 * packaging — the price struck through and *Free*, as the counter drew it.
 */
export function LineAmount({ line, className }: { line: BillLineDraft; className?: string }) {
  const total = lineTotalPaise(line.unitPricePaise, line.quantity)
  if (!isWaivedPackaging(line)) return <Money paise={total} className={className} />
  return (
    <span
      className={cn('flex flex-col items-end leading-tight', className)}
      data-testid="line-waived"
    >
      <Money paise={total} className="text-xs font-normal text-content-muted line-through" />
      <span className="text-success">Free</span>
    </span>
  )
}
