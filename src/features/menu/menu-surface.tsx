import { CircleOff, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { VegMarker } from '@/components/ui/veg-marker'
import { useAdapters, type Tables } from '@/data-access'
import { DataActionError, type MenuCategoryWithItems } from '@/data-access/adapters'
import { paiseToRupees, rupeesToPaise } from '@/domain'
import { useSession } from '@/session/context'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * Menu — what this outlet sells, and for how much.
 *
 * One component, two authorities. A Franchise Admin edits; a Biller reads the
 * same screen and is told, in a sentence, that a manager changes it. The
 * boundary is not the missing button: the mock refuses a Biller's write exactly
 * where `menu_items_write` will, so the demo teaches the product that exists
 * rather than the one the buttons imply (design D6).
 *
 * Two frequent actions, and they are deliberately different sizes of thing.
 * **Availability is one tap on the row** — it happens when the kitchen runs out,
 * mid-service, one-handed. **A price change is a form**, because it is rare and
 * consequential, and because it deserves the sentence explaining that it applies
 * to future bills only. Line items snapshot their price at the moment of sale,
 * so that sentence is a description of the schema rather than a promise.
 *
 * An unavailable item stays on the list. A tile that vanishes when the kitchen
 * runs out reads as a bug to whoever was looking straight at it, and the manager
 * needs somewhere to turn it back on.
 */

interface ItemDraft {
  categoryId: string
  name: string
  /** Rupees, as typed. Converted to integer paise at the boundary, never held as one. */
  price: string
  description: string
  isVeg: boolean
}

const EMPTY_ITEM_DRAFT: ItemDraft = {
  categoryId: '',
  name: '',
  price: '',
  description: '',
  isVeg: false,
}

export function MenuSurface() {
  const session = useSession()
  const { menu: adapter } = useAdapters()

  /**
   * Who may write. The control is the convenience; the refusal is the boundary,
   * and it lives one layer down — the same division the roster screen makes
   * about staff codes.
   */
  const canEdit = session.role === 'super_admin' || session.role === 'franchise_admin'
  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, selector: outletSelector } = useOutletScope()

  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [categoryFormOpen, setCategoryFormOpen] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [editing, setEditing] = useState<Tables<'menu_items'> | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM_DRAFT)

  const load = useCallback(async () => {
    if (!outletId) return
    setMenu(await adapter.listMenu(outletId))
  }, [adapter, outletId])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!outletId) {
          if (active) setMenu([])
          return
        }
        const next = await adapter.listMenu(outletId)
        if (active) setMenu(next)
      } catch {
        if (active) setError('Could not load the menu. Try again in a moment.')
      }
    })()
    return () => {
      active = false
    }
  }, [adapter, outletId])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  const categories = menu ?? []

  function openAdd(categoryId: string) {
    setEditing(null)
    setDraft({ ...EMPTY_ITEM_DRAFT, categoryId })
    setError(null)
    setItemFormOpen(true)
  }

  function openEdit(item: Tables<'menu_items'>) {
    setEditing(item)
    setDraft({
      categoryId: item.category_id,
      name: item.name,
      price: String(paiseToRupees(item.price_paise)),
      description: item.description ?? '',
      isVeg: item.is_veg,
    })
    setError(null)
    setItemFormOpen(true)
  }

  /**
   * The first thing wrong with the draft, as a sentence — or null.
   *
   * `noValidate` is on this form as on every other in the app, so refusals are
   * written in this app's voice rather than drawn by the browser; `required`
   * stays because it is also what sets `aria-required`.
   */
  function firstProblem(): string | null {
    if (draft.name.trim() === '') {
      return 'An item needs a name — it is what the biller taps and what the bill records.'
    }
    if (draft.categoryId === '') {
      return 'An item needs a category — that is how the counter groups it.'
    }
    const rupees = Number(draft.price.trim())
    if (draft.price.trim() === '' || !Number.isFinite(rupees) || rupees < 0) {
      return 'An item needs a price, as a number of rupees.'
    }
    return null
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault()
    const problem = firstProblem()
    if (problem) {
      setError(problem)
      return
    }
    if (!outletId) return

    const pricePaise = rupeesToPaise(Number(draft.price.trim()))
    await run(async () => {
      if (editing) {
        await adapter.updateItem(editing.id, {
          name: draft.name,
          categoryId: draft.categoryId,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
      } else {
        await adapter.createItem({
          outletId,
          categoryId: draft.categoryId,
          name: draft.name,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
      }
      setItemFormOpen(false)
    })
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault()
    if (categoryName.trim() === '') {
      setError('A category needs a name — it is the heading the counter groups under.')
      return
    }
    if (!outletId) return
    await run(async () => {
      await adapter.createCategory({ outletId, name: categoryName })
      setCategoryName('')
      setCategoryFormOpen(false)
    })
  }

  const priceChanged =
    editing !== null &&
    Number.isFinite(Number(draft.price.trim())) &&
    draft.price.trim() !== '' &&
    rupeesToPaise(Number(draft.price.trim())) !== editing.price_paise

  const addCategoryButton = canEdit ? (
    <AddButton
      label="Add category"
      data-testid="add-category"
      onClick={() => {
        setError(null)
        setCategoryFormOpen(true)
      }}
    />
  ) : undefined

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        scope={outletSelector}
        title="Menu"
        subtitle={
          canEdit
            ? 'What this outlet sells. Turning an item off takes it out of the counter’s reach without removing it.'
            : 'What this outlet sells. Changes are made by a manager.'
        }
        action={categories.length > 0 ? addCategoryButton : undefined}
      />

      {!canEdit && (
        <p
          data-testid="menu-read-only"
          className="mb-3 rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted"
        >
          This is the menu as it stands. Prices and availability are changed by a manager — if
          something has run out, tell them and it will disappear from the counter here.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="menu-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {menu === null ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : categories.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title={
            canEdit
              ? 'Nothing on the menu yet. Start with a category — Shawarma, Burgers — and the items go inside it.'
              : 'Nothing is on the menu yet. A manager sets it up.'
          }
          action={addCategoryButton}
        />
      ) : (
        <div className="space-y-4" data-testid="menu-list">
          {categories.map(({ category, items }) => (
            <Card key={category.id} className="space-y-2" data-testid={`category-${category.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-content">{category.name}</h2>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="phone"
                    disabled={busy}
                    onClick={() => openAdd(category.id)}
                    data-testid={`add-item-${category.id}`}
                  >
                    Add item
                  </Button>
                )}
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-content-muted">
                  Nothing in this category yet.
                  {canEdit && ' Add the first item and it appears at the counter.'}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      data-testid={`menu-item-${item.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                    >
                      <VegMarker isVeg={item.is_veg} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-content">{item.name}</p>
                        {item.description && (
                          <p className="truncate text-xs text-content-muted">{item.description}</p>
                        )}
                      </div>

                      <Money paise={item.price_paise} className="text-sm font-semibold" />

                      {!item.is_available && (
                        <span
                          data-testid={`unavailable-${item.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-warning px-2 py-0.5 text-xs font-semibold text-content"
                        >
                          <CircleOff aria-hidden size={12} className="text-warning" />
                          Off the menu
                        </span>
                      )}

                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant={item.is_available ? 'ghost' : 'secondary'}
                            size="phone"
                            disabled={busy}
                            data-testid={`toggle-${item.id}`}
                            onClick={() =>
                              void run(() =>
                                adapter.setItemAvailability(item.id, !item.is_available),
                              )
                            }
                          >
                            {item.is_available ? 'Turn off' : 'Turn on'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="phone"
                            disabled={busy}
                            data-testid={`edit-${item.id}`}
                            onClick={() => openEdit(item)}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      <FormSheet
        open={categoryFormOpen}
        onClose={() => setCategoryFormOpen(false)}
        title="Add category"
        error={error}
        footer={
          <button
            type="submit"
            form="menu-category-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Create category'}
          </button>
        }
      >
        <form id="menu-category-form" onSubmit={submitCategory} className="space-y-4" noValidate>
          <Field label="Name" id="menu-category-name">
            <Input
              id="menu-category-name"
              required
              value={categoryName}
              placeholder="e.g. Beverages"
              onChange={(event) => setCategoryName(event.target.value)}
            />
          </Field>
        </form>
      </FormSheet>

      {/* Keyed so opening the sheet for a different item remounts rather than
          leaving the previous one's values behind. */}
      <FormSheet
        key={editing?.id ?? 'new-item'}
        open={itemFormOpen}
        onClose={() => setItemFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add item'}
        error={error}
        footer={
          <button
            type="submit"
            form="menu-item-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
          </button>
        }
      >
        <form id="menu-item-form" onSubmit={submitItem} className="space-y-4" noValidate>
          <Field label="Name" id="menu-item-name">
            <Input
              id="menu-item-name"
              required
              value={draft.name}
              placeholder="e.g. Classic Chicken Shawarma"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>

          <Field label="Category" id="menu-item-category">
            <Select
              id="menu-item-category"
              required
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            >
              <option value="">Choose a category</option>
              {categories.map(({ category }) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Price (₹)" id="menu-item-price">
            <Input
              id="menu-item-price"
              required
              inputMode="decimal"
              value={draft.price}
              placeholder="e.g. 139"
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
            {priceChanged && (
              <p
                data-testid="price-change-warning"
                className="rounded-lg border border-warning bg-surface-raised p-2 text-xs text-content"
              >
                This price applies to bills rung from now on. Every bill already recorded keeps the
                price it was charged at — nothing already sold is rewritten.
              </p>
            )}
          </Field>

          <Field label="Description (optional)" id="menu-item-description">
            <Input
              id="menu-item-description"
              value={draft.description}
              placeholder="e.g. Bestseller"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={draft.isVeg}
              onChange={(event) => setDraft({ ...draft, isVeg: event.target.checked })}
            />
            Vegetarian
          </label>
        </form>
      </FormSheet>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
