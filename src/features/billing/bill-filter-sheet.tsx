import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

import {
  CUSTOMER_LABELS,
  KIND_LABELS,
  ORDER_WORDS,
  SERVICE_LABELS,
  SORT_LABELS,
  TENDER_LABELS,
  TRAIT_LABELS,
  type BillCustomer,
  type BillFilter,
  type BillSort,
} from './bill-filter'

/**
 * The Bills tab's one Filter sheet (billing-day-at-a-glance, design D4), the
 * kitchen's pattern: one button opens every choice. Choices apply as they are
 * tapped — nothing is saved, so there is nothing to Save or Cancel — and Done
 * closes it.
 */
function Option({
  selected,
  onClick,
  children,
  role,
}: {
  selected: boolean
  onClick: () => void
  children: string
  role?: 'radio'
}) {
  return (
    <button
      type="button"
      {...(role ? { role, 'aria-checked': selected } : { 'aria-pressed': selected })}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-xl border-2 px-3 text-sm font-semibold focus-visible:focus-ring',
        selected
          ? 'border-primary bg-primary text-on-primary'
          : 'border-border bg-surface text-content',
      )}
    >
      {children}
    </button>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={label}>
      <h3 className="text-sm font-bold uppercase tracking-wide text-content-muted">{label}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

function toggle<T>(chosen: readonly T[], value: T): T[] {
  return chosen.includes(value) ? chosen.filter((item) => item !== value) : [...chosen, value]
}

export function BillFilterSheet({
  open,
  filter,
  tablets,
  onChange,
  onClose,
}: {
  open: boolean
  filter: BillFilter
  /** The day's billing tablets by name; the Tablet group shows only for two or more. */
  tablets: readonly string[]
  onChange: (next: BillFilter) => void
  onClose: () => void
}) {
  const set = (patch: Partial<BillFilter>) => onChange({ ...filter, ...patch })
  const multi = <K extends 'kinds' | 'tenders' | 'services' | 'traits'>(
    key: K,
    labels: Record<BillFilter[K][number], string>,
  ) =>
    (Object.keys(labels) as BillFilter[K][number][]).map((value) => (
      <Option
        key={value}
        selected={(filter[key] as readonly string[]).includes(value)}
        onClick={() => set({ [key]: toggle(filter[key] as readonly string[], value) })}
      >
        {labels[value]}
      </Option>
    ))
  const [descendingWords, ascendingWords] = ORDER_WORDS[filter.sort]

  return (
    <FormSheet
      open={open}
      title="Show bills"
      onClose={onClose}
      footer={
        <Button size="phone" className="w-full" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-5" data-testid="bill-filter-sheet">
        <Group label="Sort by">
          {(Object.keys(SORT_LABELS) as BillSort[]).map((sort) => (
            <Option
              key={sort}
              role="radio"
              selected={filter.sort === sort}
              onClick={() => set({ sort })}
            >
              {SORT_LABELS[sort]}
            </Option>
          ))}
        </Group>
        <section className="space-y-2" aria-label="Order">
          <h3 className="text-sm font-bold uppercase tracking-wide text-content-muted">Order</h3>
          <div role="radiogroup" aria-label="Order" className="grid grid-cols-2 gap-2">
            <Option
              role="radio"
              selected={filter.descending}
              onClick={() => set({ descending: true })}
            >
              {descendingWords}
            </Option>
            <Option
              role="radio"
              selected={!filter.descending}
              onClick={() => set({ descending: false })}
            >
              {ascendingWords}
            </Option>
          </div>
        </section>
        <Group label="Bill">{multi('kinds', KIND_LABELS)}</Group>
        <Group label="Paid with">{multi('tenders', TENDER_LABELS)}</Group>
        <Group label="Customer">
          {(Object.keys(CUSTOMER_LABELS) as BillCustomer[]).map((customer) => (
            <Option
              key={customer}
              role="radio"
              selected={filter.customer === customer}
              onClick={() => set({ customer })}
            >
              {CUSTOMER_LABELS[customer]}
            </Option>
          ))}
        </Group>
        <Group label="Service">{multi('services', SERVICE_LABELS)}</Group>
        <Group label="Only bills that">{multi('traits', TRAIT_LABELS)}</Group>
        {tablets.length > 1 && (
          <Group label="Tablet">
            {tablets.map((tablet) => (
              <Option
                key={tablet}
                selected={filter.tablets.includes(tablet)}
                onClick={() => set({ tablets: toggle(filter.tablets, tablet) })}
              >
                {tablet}
              </Option>
            ))}
          </Group>
        )}
      </div>
    </FormSheet>
  )
}
