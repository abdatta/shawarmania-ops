import { ArrowDown, ArrowUp, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import { VegMarker } from '@/components/ui/veg-marker'
import {
  DataActionError,
  type MenuCategoryWithItems,
  type MenuHighlights,
} from '@/data-access/adapters'
import type { Tables } from '@/data-access'

/** Reorder a draft without mutating the committed selection. */
function moved(ids: string[], index: number, direction: -1 | 1) {
  const next = [...ids]
  const other = index + direction
  if (other < 0 || other >= next.length) return next
  ;[next[index], next[other]] = [next[other]!, next[index]!]
  return next
}

function Dish({ item }: { item: Tables<'menu_items'> }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <VegMarker isVeg={item.is_veg} />
      <span className="min-w-0 flex-1 text-sm font-semibold text-content">{item.name}</span>
      {item.is_available ? (
        <Money paise={item.price_paise} className="shrink-0 text-sm" />
      ) : (
        <span className="text-xs font-semibold text-content-muted">Unavailable</span>
      )}
    </div>
  )
}

export function MenuHighlightsCard({
  highlights,
  categories,
  busy,
  onSave,
}: {
  highlights: MenuHighlights
  categories: MenuCategoryWithItems[]
  busy: boolean
  onSave: (next: MenuHighlights) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(highlights)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = categories.flatMap((entry) => entry.items)
  const byId = new Map(items.map((item) => [item.id, item]))
  const selected = highlights.itemIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const draftItems = draft.itemIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const query = search.trim().toLocaleLowerCase()

  function openEdit() {
    setDraft({ title: highlights.title, itemIds: [...highlights.itemIds] })
    setSearch('')
    setError(null)
    setEditing(true)
  }

  function toggle(id: string) {
    setDraft((current) => ({
      ...current,
      itemIds: current.itemIds.includes(id)
        ? current.itemIds.filter((chosen) => chosen !== id)
        : [...current.itemIds, id],
    }))
  }

  async function save() {
    if (!draft.title.trim()) {
      setError('Give this section a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ title: draft.title.trim(), itemIds: [...draft.itemIds] })
      setEditing(false)
    } catch (cause) {
      setError(
        cause instanceof DataActionError ? cause.message : 'Could not save highlights. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="mb-3 space-y-2 p-3" data-testid="menu-highlights">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-bold text-content">
              <Sparkles size={18} aria-hidden className="shrink-0 text-primary" />
              <span className="truncate" title={highlights.title}>
                {highlights.title}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-content-muted">
              Highlight dishes at the top of your menu.
            </p>
          </div>
          <Button
            variant="secondary"
            size="phone"
            className="shrink-0 px-3"
            aria-label="Edit highlights"
            disabled={busy}
            onClick={openEdit}
          >
            Edit
          </Button>
        </div>
        {selected.length > 0 && (
          <ul className="divide-y divide-border" data-testid="highlighted-items">
            {selected.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-2">
                <Dish item={item} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FormSheet
        open={editing}
        onClose={() => {
          if (!saving) setEditing(false)
        }}
        title="Edit highlights"
        error={error}
        footer={
          <Button
            className="w-full"
            size="phone"
            disabled={saving || busy}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save highlights'}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label htmlFor="highlight-title" className="text-sm font-semibold text-content">
              Section name
            </label>
            <Input
              id="highlight-title"
              className="h-11 min-w-0 flex-1"
              maxLength={60}
              value={draft.title}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>
          {draftItems.length === 0 ? (
            <p className="text-sm text-content-muted">No dishes highlighted yet.</p>
          ) : (
            <ol
              aria-label="Highlighted dishes"
              className="divide-y divide-border"
              data-testid="highlight-selection"
            >
              {draftItems.map((item, index) => (
                <li key={item.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-content">
                    {item.name}
                  </span>
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="phone"
                      className="w-11 px-0"
                      aria-label={`Move ${item.name} up in highlights`}
                      disabled={saving || index === 0}
                      onClick={() =>
                        setDraft({ ...draft, itemIds: moved(draft.itemIds, index, -1) })
                      }
                    >
                      <ArrowUp size={16} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="phone"
                      className="w-11 px-0"
                      aria-label={`Move ${item.name} down in highlights`}
                      disabled={saving || index === draftItems.length - 1}
                      onClick={() =>
                        setDraft({ ...draft, itemIds: moved(draft.itemIds, index, 1) })
                      }
                    >
                      <ArrowDown size={16} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="phone"
                      className="w-11 px-0"
                      disabled={saving}
                      aria-label={`Remove ${item.name} from highlights`}
                      onClick={() => toggle(item.id)}
                    >
                      <X size={16} aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2">
            <label htmlFor="highlight-search" className="sr-only">
              Choose dishes
            </label>
            <Input
              id="highlight-search"
              className="h-11"
              type="search"
              placeholder="Search dishes or categories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {categories.map(({ category, items: categoryItems }) => {
              const matching = categoryItems.filter((item) =>
                `${category.name} ${item.name}`.toLocaleLowerCase().includes(query),
              )
              if (matching.length === 0) return null
              return (
                <fieldset key={category.id} className="space-y-1">
                  <legend className="mb-1 text-xs font-bold text-content-muted">
                    {category.name}
                  </legend>
                  {matching.map((item) => (
                    <label
                      key={item.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-raised"
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={draft.itemIds.includes(item.id)}
                        disabled={saving}
                        onChange={() => toggle(item.id)}
                        aria-label={`Highlight ${item.name}`}
                      />
                      <Dish item={item} />
                    </label>
                  ))}
                </fieldset>
              )
            })}
            {!items.some((item) =>
              `${categories.find((entry) => entry.category.id === item.category_id)?.category.name} ${item.name}`
                .toLocaleLowerCase()
                .includes(query),
            ) && <p className="text-sm text-content-muted">No matching dishes.</p>}
          </div>
        </div>
      </FormSheet>
    </>
  )
}
