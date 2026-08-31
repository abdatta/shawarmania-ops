import { Money } from '@/components/ui/money'
import { PROFIT_BASIS_DESCRIPTIONS, PROFIT_BASIS_LABELS, type ProfitEstimate } from '@/domain'

/**
 * A profit figure, and the basis it was computed on — **never one without the
 * other**.
 *
 * The two bases answer different questions and mixing them is the classic error
 * in this domain (`docs/DATA_MODEL.md`, trap 1). A component that could render
 * the number alone would make forgetting to say which one is on screen possible,
 * so this one takes the whole estimate and always states it (design D5).
 */

export function ProfitFigure({
  estimate,
  testId = 'profit-figure',
}: {
  estimate: ProfitEstimate
  testId?: string
}) {
  return (
    <div data-testid={testId} data-basis={estimate.basis} className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-content">Estimated profit</span>
        <Money paise={estimate.profitPaise} display data-testid={`${testId}-amount`} />
      </div>
      <p className="text-xs font-semibold text-content" data-testid={`${testId}-basis`}>
        {PROFIT_BASIS_LABELS[estimate.basis]}
      </p>
      <p className="text-xs text-content-muted">{PROFIT_BASIS_DESCRIPTIONS[estimate.basis]}</p>
      {estimate.isCeiling && (
        <p className="text-xs font-semibold text-warning" data-testid={`${testId}-ceiling`}>
          Ceiling — at least one aggregator commission is not determined yet.
        </p>
      )}

      {/* The working, so the figure can be checked rather than trusted. */}
      <dl className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
        <Line label="Sales" paise={estimate.salesPaise} />
        <Line label="Less recorded operating expenses" paise={-estimate.expensesPaise} />
      </dl>
    </div>
  )
}

function Line({ label, paise }: { label: string; paise: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd>
        <Money paise={paise} />
      </dd>
    </div>
  )
}
