import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import {
  PROFIT_BASIS_DESCRIPTIONS,
  PROFIT_BASIS_LABELS,
  type ProfitBasis,
  type ProfitEstimate,
} from '@/domain'

/**
 * A profit figure, and the basis it was computed on — **never one without the
 * other**.
 *
 * The two bases answer different questions and mixing them is the classic error
 * in this domain (`docs/DATA_MODEL.md`, trap 1). A component that could render
 * the number alone would make forgetting to say which one is on screen possible,
 * so this one takes the whole estimate and always states it (design D5).
 */

const BASES: ProfitBasis[] = ['cash', 'consumption']

export function BasisPicker({
  value,
  onChange,
  id = 'profit-basis',
}: {
  value: ProfitBasis
  onChange: (basis: ProfitBasis) => void
  id?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-content-muted">
        Basis
      </label>
      <Select
        id={id}
        // Derived from the id, not fixed: two of these can be on screen in one
        // walkthrough and a shared test id would address whichever rendered
        // first.
        data-testid={id}
        className="h-11 w-auto"
        value={value}
        onChange={(event) => onChange(event.target.value as ProfitBasis)}
      >
        {BASES.map((basis) => (
          <option key={basis} value={basis}>
            {PROFIT_BASIS_LABELS[basis]}
          </option>
        ))}
      </Select>
    </div>
  )
}

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

      {/* The working, so the figure can be checked rather than trusted. */}
      <dl className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
        <Line label="Sales" paise={estimate.salesPaise} />
        <Line
          label={estimate.basis === 'cash' ? 'Less everything spent' : 'Less running costs'}
          paise={-estimate.expensesPaise}
        />
        {estimate.basis === 'consumption' && (
          <Line label="Less stock used, at cost" paise={-estimate.consumedPaise} />
        )}
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
