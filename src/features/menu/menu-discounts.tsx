import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type {
  DiscountPreset,
  MenuCategoryWithItems,
  MenuDiscount,
  MenuDiscountPatch,
  NewMenuDiscount,
} from '@/data-access/adapters'
import { formatPaise, rupeesToPaise } from '@/domain'

/**
 * The owner's side of a discount: what comes off, and which categories it comes
 * off. One card on the Menu screen, and one sheet behind it.
 *
 * **The word is Discount.** Not sale, not offer, not promotion — anywhere in the
 * product, including the copy inside this sheet [owner, 2026-09-03].
 *
 * Several discounts may run at once at different values over different
 * categories, added one at a time. That is deliberately not one form with a
 * repeater: adding them one at a time keeps each one's categories unambiguous,
 * and the list below the button is where the set is read.
 */

function describeValue(discount: MenuDiscount) {
  return discount.basis === 'percent'
    ? `${(discount.valueBp ?? 0) / 100}%`
    : formatPaise(discount.valuePaise ?? 0)
}

function categoryNames(discount: MenuDiscount, categories: MenuCategoryWithItems[]): string {
  const names = discount.categoryIds
    .map((id) => categories.find((entry) => entry.category.id === id)?.category.name)
    .filter((name): name is string => Boolean(name))
  // Everything on the menu is one phrase rather than a list of every heading —
  // the same simplification the counter's own discount rows make.
  if (names.length > 0 && names.length === categories.length) return 'All Items'
  return names.join(', ')
}

export function MenuDiscountsCard({
  discounts,
  categories,
  presets,
  busy,
  onCreate,
  onUpdate,
  onRemove,
  onSetPresets,
}: {
  discounts: MenuDiscount[]
  categories: MenuCategoryWithItems[]
  presets: DiscountPreset[]
  busy: boolean
  onCreate: (discount: Omit<NewMenuDiscount, 'outletId'>) => Promise<void>
  onUpdate: (id: string, patch: MenuDiscountPatch) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onSetPresets: (presets: DiscountPreset[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  /** The discount being changed, or null when starting a new one. */
  const [editing, setEditing] = useState<MenuDiscount | null>(null)
  const [basis, setBasis] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const allChosen = categories.length > 0 && chosen.length === categories.length

  /**
   * The most a rupee discount over the chosen categories may be.
   *
   * The database refuses a per-unit amount above the cheapest item it covers,
   * because such a discount would take more off a line than the line is worth.
   * That limit is knowable here — the categories and their prices are already
   * on screen — so the form states the real figure and refuses before the
   * write, rather than letting the database say no after the sheet has closed.
   *
   * Null until categories are chosen, because there is nothing to bound yet.
   */
  const cheapestCovered = useMemo(() => {
    const prices = categories
      .filter((entry) => chosen.includes(entry.category.id))
      .flatMap((entry) => entry.items.filter((item) => item.is_active))
      .map((item) => item.price_paise)
    return prices.length > 0 ? Math.min(...prices) : null
  }, [categories, chosen])

  function openSheet() {
    setEditing(null)
    setBasis('percent')
    setValue('')
    setChosen([])
    setProblem(null)
    setOpen(true)
  }

  function openEdit(discount: MenuDiscount) {
    setEditing(discount)
    setBasis(discount.basis)
    setValue(
      String(
        (discount.basis === 'percent' ? (discount.valueBp ?? 0) : (discount.valuePaise ?? 0)) / 100,
      ),
    )
    setChosen([...discount.categoryIds])
    setProblem(null)
    setOpen(true)
  }

  function toggle(categoryId: string) {
    setChosen((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const numeric = Number(value.trim())
    if (!value.trim() || !Number.isFinite(numeric) || numeric <= 0) {
      setProblem('A discount needs a value greater than nought.')
      return
    }
    if (chosen.length === 0) {
      setProblem('Choose at least one category for this discount.')
      return
    }
    if (basis === 'percent' && numeric > 100) {
      setProblem('A percentage discount cannot be more than 100%.')
      return
    }
    if (
      basis === 'amount' &&
      cheapestCovered !== null &&
      rupeesToPaise(numeric) > cheapestCovered
    ) {
      setProblem(
        `That is more than ${formatPaise(cheapestCovered)}, the cheapest item this covers.`,
      )
      return
    }

    setProblem(null)
    setSaving(true)
    const written = {
      basis,
      // Basis points, so a fractional percentage stays an integer all the way
      // down and no float ever enters the money path.
      valueBp: basis === 'percent' ? Math.round(numeric * 100) : null,
      valuePaise: basis === 'amount' ? rupeesToPaise(numeric) : null,
      categoryIds: [...chosen],
    }
    try {
      // Editing changes what is running; every line already captured keeps the
      // terms it was sold under either way.
      if (editing) await onUpdate(editing.id, written)
      else await onCreate(written)
      setOpen(false)
    } catch (cause) {
      // The sheet stays open and says what happened. A refusal that closed the
      // form and printed itself on the page behind it left the reader looking
      // at a message about a form they could no longer see or correct.
      setProblem(
        cause instanceof Error && cause.message
          ? cause.message
          : 'That discount could not be saved. Try again in a moment.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 space-y-2" data-testid="menu-discounts">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-content">Menu Discounts</h2>
        <Button size="phone" data-testid="set-discounts" disabled={busy} onClick={openSheet}>
          Add Discount
        </Button>
      </div>

      {/*
        Nothing at all when nothing is running. A line saying so is a row of
        text the owner reads once and then scrolls past every time afterwards,
        and the button above already says what to do about it.
      */}
      {discounts.length > 0 && (
        <ul className="divide-y divide-border" aria-label="Menu discounts">
          {discounts.map((discount) => (
            <li
              key={discount.id}
              data-testid={`menu-discount-${discount.id}`}
              className="flex items-center gap-2 py-1.5"
            >
              {/* One line: the value and what it covers read together anyway. */}
              <p className="min-w-0 flex-1 truncate text-sm text-content">
                <span className="font-semibold">{describeValue(discount)} off</span>
                <span className="text-content-muted"> · {categoryNames(discount, categories)}</span>
              </p>
              <Button
                variant="secondary"
                size="phone"
                className="w-10 px-0"
                aria-label={`Edit the ${describeValue(discount)} discount`}
                disabled={busy}
                onClick={() => openEdit(discount)}
              >
                <Pencil aria-hidden size={15} />
              </Button>
              <Button
                variant="secondary"
                size="phone"
                className="w-10 px-0"
                aria-label={`Stop the ${describeValue(discount)} discount`}
                disabled={busy}
                onClick={() => void onRemove(discount.id)}
              >
                <Trash2 aria-hidden size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <DiscountPresets presets={presets} busy={busy} onSetPresets={onSetPresets} />

      <FormSheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit discount' : 'Add discount'}
        error={problem}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="control" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="control"
              disabled={busy || saving}
              data-testid="save-discount"
              onClick={submit}
            >
              {editing ? 'Save discount' : 'Start discount'}
            </Button>
          </div>
        }
      >
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <span className="mb-1 block text-xs font-bold uppercase text-content-muted">
              How much
            </span>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                className="h-11"
                inputMode="decimal"
                autoComplete="off"
                aria-label="Discount value"
                placeholder={basis === 'percent' ? '15' : '20'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <div className="flex gap-1" role="group" aria-label="Discount unit">
                {(['percent', 'amount'] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={basis === option ? 'primary' : 'secondary'}
                    size="phone"
                    className="w-12 px-0"
                    aria-pressed={basis === option}
                    data-testid={`discount-basis-${option}`}
                    onClick={() => setBasis(option)}
                  >
                    {option === 'percent' ? '%' : '₹'}
                  </Button>
                ))}
              </div>
            </div>
            {/*
              One limit, the one that applies to the unit currently selected.
              Showing both makes the reader work out which is theirs, and the
              rupee limit is a real number here rather than a description of one
              — the categories are already in hand, so the cheapest item they
              cover is a calculation and not a question.
            */}
            <p className="mt-1 text-xs text-content-muted" data-testid="discount-limit">
              {basis === 'percent'
                ? 'Up to 100%.'
                : cheapestCovered === null
                  ? 'Choose categories to see the most this can be.'
                  : `Up to ${formatPaise(cheapestCovered)}, the cheapest item covered.`}
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-content-muted">On which</span>
              <Button
                type="button"
                variant="ghost"
                size="phone"
                data-testid="select-all-categories"
                onClick={() =>
                  setChosen(allChosen ? [] : categories.map((entry) => entry.category.id))
                }
              >
                {allChosen ? 'Clear all' : 'Select all'}
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {categories.map(({ category }) => (
                <li key={category.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={chosen.includes(category.id)}
                      onChange={() => toggle(category.id)}
                    />
                    <span className="text-sm font-semibold text-content">{category.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </form>
      </FormSheet>
    </Card>
  )
}

/**
 * The counter panel's percentage presets.
 *
 * Between none and four. Four is a layout fact rather than an arbitrary cap: the
 * biller's panel fits four across one row, and a preset row that wraps is worse
 * than one preset fewer.
 */
function DiscountPresets({
  presets,
  busy,
  onSetPresets,
}: {
  presets: DiscountPreset[]
  busy: boolean
  onSetPresets: (presets: DiscountPreset[]) => Promise<void>
}) {
  const [adding, setAdding] = useState('')
  const [addingBasis, setAddingBasis] = useState<'percent' | 'amount'>('percent')

  const label = (preset: DiscountPreset) =>
    preset.basis === 'percent' ? `${preset.value / 100}%` : formatPaise(preset.value)

  return (
    /*
      Collapsed by default, because presets are set once and then left alone
      while the discounts above them change. The summary still carries their
      values, so the owner can confirm what the counter offers without opening
      anything — which is the only question this section usually has to answer.
    */
    <details className="border-t border-border pt-2" data-testid="discount-presets">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase text-content-muted">
        <ChevronRight
          aria-hidden
          size={14}
          className="transition-transform [details[open]_&]:rotate-90"
        />
        Counter presets
        <span className="font-semibold normal-case tracking-normal">
          {presets.length > 0 ? presets.map(label).join(' · ') : 'None'}
        </span>
      </summary>

      <p className="mb-2 mt-2 text-xs text-content-muted">
        What the counter offers in one tap. Up to four.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <span
            key={`${preset.basis}-${preset.value}`}
            data-testid={`preset-${preset.basis}-${preset.value}`}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2 text-sm font-bold text-content"
          >
            {label(preset)}
            <Button
              variant="ghost"
              size="phone"
              className="size-7 px-0"
              aria-label={`Remove the ${label(preset)} preset`}
              disabled={busy}
              onClick={() =>
                void onSetPresets(
                  presets.filter(
                    (candidate) =>
                      !(candidate.basis === preset.basis && candidate.value === preset.value),
                  ),
                )
              }
            >
              <Trash2 aria-hidden size={13} />
            </Button>
          </span>
        ))}

        {presets.length < 4 && (
          <span className="flex items-center gap-1">
            <Input
              className="h-9 w-16"
              inputMode="decimal"
              autoComplete="off"
              aria-label="New preset value"
              placeholder={addingBasis === 'percent' ? '%' : '₹'}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
            />
            {/*
              Two buttons rather than a dropdown: there are exactly two units,
              and a select costs a tap to open before the tap that chooses. It is
              also the same %/₹ pair the discount sheet and the counter panel
              already use, so the control means one thing everywhere.
            */}
            <span className="flex gap-1" role="group" aria-label="New preset unit">
              {(['percent', 'amount'] as const).map((option) => (
                <Button
                  key={option}
                  variant={addingBasis === option ? 'primary' : 'secondary'}
                  size="phone"
                  className="size-9 px-0"
                  aria-pressed={addingBasis === option}
                  data-testid={`preset-unit-${option}`}
                  onClick={() => setAddingBasis(option)}
                >
                  {option === 'percent' ? '%' : '₹'}
                </Button>
              ))}
            </span>
            <Button
              variant="secondary"
              size="phone"
              data-testid="add-preset"
              disabled={busy || adding.trim() === ''}
              onClick={() => {
                const numeric = Number(adding.trim())
                if (!Number.isFinite(numeric) || numeric <= 0) return
                if (addingBasis === 'percent' && numeric > 100) return
                const next: DiscountPreset = {
                  basis: addingBasis,
                  // Basis points for a percentage, paise for an amount — the
                  // same integer convention the rest of the discount path uses.
                  value:
                    addingBasis === 'percent' ? Math.round(numeric * 100) : rupeesToPaise(numeric),
                }
                if (
                  presets.some(
                    (preset) => preset.basis === next.basis && preset.value === next.value,
                  )
                ) {
                  setAdding('')
                  return
                }
                void onSetPresets(
                  [...presets, next].sort(
                    (left, right) =>
                      left.basis.localeCompare(right.basis) || left.value - right.value,
                  ),
                )
                setAdding('')
              }}
            >
              Add preset
            </Button>
          </span>
        )}
      </div>
    </details>
  )
}

/** Exported for the counter, which groups its rows by the same rule. */
export { categoryNames as menuDiscountCategoryNames, describeValue as describeDiscountValue }
