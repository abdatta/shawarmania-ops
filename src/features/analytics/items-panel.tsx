import { useState } from 'react'
import { ArrowDownWideNarrow, Flame, GitCompareArrows, Search } from 'lucide-react'
import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import { Explain } from '@/components/ui/why'
import type { AnalyticsItem, AnalyticsSnapshot } from '@/domain/sales-analytics-types'
import { totalDays } from '@/domain/sales-analytics'
import { Bars, ChangeChip, MiniBar } from './analytics-widgets'
import { download } from './analytics-utils'
import { AnalyticsScrollList } from './analytics-scroll-list'

export function ItemsPanel({ data, from }: { data: AnalyticsSnapshot; from: string }) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<string[]>([])
  const orders = totalDays(data.days.filter((d) => d.date >= from)).orders
  const byUnits = [...data.items].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))
  const max = Math.max(1, ...data.items.map((i) => i.units))
  const items = byUnits.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (view === 'all' || i.active) &&
      (view !== 'rising' || (i.previousUnits > 0 && i.units > i.previousUnits)) &&
      (view !== 'slow' || (i.previousUnits > 0 && i.units < i.previousUnits)),
  )
  if (view === 'worst') items.sort((a, b) => a.units - b.units || a.name.localeCompare(b.name))
  if (view === 'rising' || view === 'slow')
    items.sort(
      (a, b) =>
        (view === 'rising' ? -1 : 1) * (a.units / a.previousUnits - b.units / b.previousUnits) ||
        a.name.localeCompare(b.name),
    )
  const compared = selected
    .map((key) => data.items.find((i) => i.key === key))
    .filter((i): i is AnalyticsItem => !!i)
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Explain
          label="Ranking context"
          className="min-h-11"
          explanation={
            <p>
              Units sold in {orders} synced, settled counter orders. All is ordered most sold first;
              Worst is least sold first, including zero sellers. Rising and Slow show active dishes
              with growth or decline against a nonzero prior period, ordered by percentage change.
              Every bar uses the same scale. Zero sales do not prove a dish was stocked throughout.
              Check stock, launch dates and another comparable period before removal.
            </p>
          }
        >
          <Chip>{orders} counter orders</Chip>
        </Explain>
        <Button
          size="phone"
          variant="secondary"
          onClick={() => {
            setDraft(
              compared.length === 2
                ? compared.map((i) => i.key)
                : byUnits.slice(0, 2).map((i) => i.key),
            )
            setPickerSearch('')
            setPickerOpen(true)
          }}
        >
          <GitCompareArrows size={16} aria-hidden />
          Compare
        </Button>
      </div>
      {!orders && (
        <Card className="py-3">
          <CardTitle>No settled sales in this period</CardTitle>
          <p className="mt-1 text-sm text-content-muted">Try another range.</p>
        </Card>
      )}
      {compared.length === 2 && (
        <Card data-testid="dish-comparison">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>Head to head</CardTitle>
            <Button size="phone" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {compared.map((i, index) => (
              <div key={i.key} className="min-w-0">
                <span className="mb-1 flex items-center gap-1 text-xs text-content-muted">
                  <span
                    className={`size-2 rounded-full ${index ? 'bg-content-muted' : 'bg-primary'}`}
                    aria-hidden
                  />
                  {index ? 'B' : 'A'}
                </span>
                <p className="break-words text-sm font-semibold">{i.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-4">
            <ComparisonMetric
              label="Units sold"
              items={compared}
              values={compared.map((i) => i.units)}
            />
            <ComparisonMetric
              label="Orders containing dish"
              items={compared}
              values={compared.map((i) => i.orders)}
            />
            <ComparisonMetric
              label="Previous-period units"
              items={compared}
              values={compared.map((i) => i.previousUnits)}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {compared.map((i) => (
              <div key={i.key} className="flex flex-wrap items-center gap-1">
                <ChangeChip current={i.units} previous={i.previousUnits} />
                <span className="text-xs text-content-muted">
                  {orders ? `${Math.round((i.orders / orders) * 100)}% of orders` : 'No orders'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Dishes</CardTitle>
          <span className="text-xs text-content-muted">Units sold</span>
        </div>
        <div className="relative mb-2">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-3.5 text-content-muted"
          />
          <Input
            aria-label="Search dishes"
            placeholder="Find a dish"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mb-3 grid grid-cols-4 gap-1" role="group" aria-label="Dish filters">
          {[
            ['all', 'All'],
            ['worst', 'Worst'],
            ['rising', 'Rising'],
            ['slow', 'Slow'],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="phone"
              variant="ghost"
              className={`px-1 text-xs ${view === value ? 'bg-surface-raised text-accent-text' : 'text-content-muted'}`}
              aria-pressed={view === value}
              onClick={() => {
                setView(value!)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <AnalyticsScrollList
          key={`${view}:${search}`}
          rows={items}
          label="Dish rankings"
          render={(i) => (
            <li
              key={i.key}
              data-testid="dish-row"
              data-units={i.units}
              data-previous-units={i.previousUnits}
              className="py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-semibold">{i.name}</p>
                <span className="shrink-0 text-base font-bold tabular-nums">{i.units}</span>
              </div>
              <div className="my-2">
                <MiniBar value={i.units} max={max} />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <ChangeChip current={i.units} previous={i.previousUnits} />
                {!i.active ? (
                  <Chip>Retired</Chip>
                ) : !i.available ? (
                  <Chip>Unavailable</Chip>
                ) : i.highlighted ? (
                  <Chip icon={Flame}>Highlighted</Chip>
                ) : null}
                <span className="ml-auto text-xs text-content-muted">
                  {orders ? `${Math.round((i.orders / orders) * 100)}% of orders` : '—'}
                </span>
              </div>
            </li>
          )}
        />
      </Card>
      <div>
        <Card>
          <CardTitle className="mb-4">Categories</CardTitle>
          <Bars
            rows={data.categories
              .map((c) => ({ label: c.name, value: c.units }))
              .sort((a, b) => b.value - a.value)}
          />
          <Explain
            label="Category snapshots"
            className="mt-2 min-h-11 text-xs text-content-muted"
            explanation={
              <p>
                Units sold, grouped by the category captured on the bill. Older bills without a
                category snapshot are Uncategorised; today’s category is not used to rewrite
                history.
              </p>
            }
          >
            Units · captured categories
          </Explain>
        </Card>
      </div>
      <details className="rounded-xl border border-border bg-surface px-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <ArrowDownWideNarrow size={16} aria-hidden />
          Detailed figures & export
        </summary>
        <div className="space-y-3 pb-4">
          <Button
            size="phone"
            variant="secondary"
            onClick={() =>
              download('item-performance', [
                ['Dish', 'Category', 'Units', 'Previous units', 'Line revenue (paise)', 'Orders'],
                ...items.map((i) => [
                  i.name,
                  i.category,
                  i.units,
                  i.previousUnits,
                  i.revenue,
                  i.orders,
                ]),
              ])
            }
          >
            Export CSV
          </Button>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {['Dish', 'Units', 'Previous', 'Dish revenue'].map((h) => (
                    <th key={h} scope="col" className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} className="border-t border-border">
                    <th scope="row" className="min-w-40 p-2 font-medium">
                      {i.name}
                    </th>
                    <td className="p-2">{i.units}</td>
                    <td className="p-2">{i.previousUnits}</td>
                    <td className="whitespace-nowrap p-2">
                      <Money paise={i.revenue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      <FormSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Compare dishes"
        footer={
          <Button
            className="w-full"
            disabled={draft.length !== 2}
            onClick={() => {
              setSelected(draft)
              setPickerOpen(false)
            }}
          >
            Compare {draft.length}/2
          </Button>
        }
      >
        <Input
          aria-label="Find comparison dish"
          placeholder="Find a dish"
          value={pickerSearch}
          onChange={(e) => setPickerSearch(e.target.value)}
        />
        <div className="mt-3 divide-y divide-border">
          {byUnits
            .filter((i) => i.name.toLowerCase().includes(pickerSearch.toLowerCase()))
            .map((i) => (
              <label key={i.key} className="flex min-h-14 cursor-pointer items-center gap-3 py-3">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={draft.includes(i.key)}
                  disabled={draft.length === 2 && !draft.includes(i.key)}
                  onChange={(e) =>
                    setDraft(
                      e.target.checked ? [...draft, i.key] : draft.filter((key) => key !== i.key),
                    )
                  }
                />
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{i.name}</span>
                <span className="shrink-0 text-sm text-content-muted tabular-nums">{i.units}</span>
              </label>
            ))}
        </div>
      </FormSheet>
    </>
  )
}

function ComparisonMetric({
  label,
  items,
  values,
}: {
  label: string
  items: AnalyticsItem[]
  values: number[]
}) {
  const max = Math.max(1, ...values)
  return (
    <div>
      <p className="mb-2 text-xs text-content-muted">{label}</p>
      <div className="space-y-2">
        {items.map((i, index) => (
          <div
            key={i.key}
            className="flex items-center gap-2"
            aria-label={`${i.name}: ${values[index]} ${label.toLowerCase()}`}
          >
            <span className="w-3 text-xs text-content-muted">{index ? 'B' : 'A'}</span>
            <div className="flex-1">
              <MiniBar value={values[index] ?? 0} max={max} muted={!!index} />
            </div>
            <span className="w-10 text-right text-sm font-bold tabular-nums">{values[index]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
