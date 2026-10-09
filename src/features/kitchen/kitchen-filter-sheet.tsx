import { useEffect, useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type KitchenCategory,
  type KitchenFilterMode,
  type KitchenSort,
} from '@/data-access/adapters'
import { cn } from '@/lib/cn'

/**
 * The kitchen chooses its own food (#70, design D6): *Only these* or
 * *Everything except*, over its outlet's categories. **Everything except**
 * is what makes a category added next month appear on this kitchen without
 * anybody remembering to add it here. Saved on the tablet's own record, so it
 * survives a reload, a reinstall and a cleared browser.
 *
 * The board's order is chosen here too, and saved with it: oldest first, the
 * order cooks work in, unless this kitchen prefers the newest on top. It is a
 * setting rather than a decision in the code so that a kitchen which wants it
 * the other way needs no release (owner, 2026-10-09).
 */

/** Two or more exclusive choices drawn as buttons, the selected one filled. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (next: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-12 rounded-xl border-2 px-3 font-semibold',
            value === option
              ? 'border-primary bg-primary text-on-primary'
              : 'border-border bg-surface text-content',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
export function KitchenFilterSheet({
  open,
  mode,
  categoryIds,
  sort,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: KitchenFilterMode
  categoryIds: readonly string[]
  sort: KitchenSort
  onClose: () => void
  onSaved: () => void
}) {
  const { kitchen } = useAdapters()
  const [categories, setCategories] = useState<KitchenCategory[] | null>(null)
  const [draftMode, setDraftMode] = useState<KitchenFilterMode>(mode)
  const [draft, setDraft] = useState<Set<string>>(new Set(categoryIds))
  const [draftSort, setDraftSort] = useState<KitchenSort>(sort)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The parent mounts this sheet afresh each time it opens, so the draft starts
  // from the saved filter by its initial state rather than by an effect.
  useEffect(() => {
    if (!open) return
    let active = true
    void kitchen
      .listCategories()
      .then((rows) => {
        if (active) setCategories(rows.filter((row) => row.isActive))
      })
      .catch(() => {
        if (active) setError('Could not load this outlet’s categories. Try again.')
      })
    return () => {
      active = false
    }
  }, [open, kitchen])

  function toggle(id: string) {
    setDraft((held) => {
      const next = new Set(held)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await kitchen.setFilter(draftMode, [...draft], draftSort)
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'The filter could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet
      open={open}
      title="What this kitchen shows"
      onClose={saving ? () => undefined : onClose}
      error={error}
      footer={
        <div className="grid gap-2">
          <Button size="phone" onClick={() => void save()} disabled={saving || !categories}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" size="phone" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-content-muted">Order</h3>
          <Choice
            label="Order"
            value={draftSort}
            onChange={setDraftSort}
            options={[
              ['oldest_first', 'Oldest first'],
              ['newest_first', 'Newest first'],
            ]}
          />
        </section>

        <h3 className="text-sm font-bold uppercase tracking-wide text-content-muted">Dishes</h3>
        <Choice
          label="Filter mode"
          value={draftMode}
          onChange={setDraftMode}
          options={[
            ['include', 'Only these'],
            ['exclude', 'Everything except'],
          ]}
        />

        <p className="text-sm text-content-muted">
          {draftMode === 'exclude'
            ? 'This kitchen shows every category you do not tick, including ones added later.'
            : 'This kitchen shows only the categories you tick.'}
        </p>

        <fieldset className="space-y-2">
          <legend className="sr-only">Categories</legend>
          {(categories ?? []).map((category) => (
            <label
              key={category.id}
              className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-surface px-3"
            >
              <input
                type="checkbox"
                className="size-5"
                checked={draft.has(category.id)}
                onChange={() => toggle(category.id)}
              />
              <span className="text-lg">{category.name}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </FormSheet>
  )
}
