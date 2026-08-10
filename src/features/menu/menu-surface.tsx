import { UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { RowActionsMenu } from '@/components/layout/row-actions-menu'
import { AddButton } from '@/components/ui/add-button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { CategoryInput } from '@/components/ui/category-input'
import { CategoryMatchDialog } from '@/components/ui/category-match-dialog'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { RevealAdded } from '@/components/ui/reveal-added'
import { VegMarker } from '@/components/ui/veg-marker'
import { useAdapters, type Tables } from '@/data-access'
import { DataActionError, type MenuCategoryWithItems } from '@/data-access/adapters'
import { matchCategory, paiseToRupees, rupeesToPaise, type CategoryMatch } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

interface ItemDraft {
  categoryName: string
  name: string
  price: string
  description: string
  isVeg: boolean
}

const EMPTY_DRAFT: ItemDraft = {
  categoryName: '',
  name: '',
  price: '',
  description: '',
  isVeg: false,
}

export function MenuSurface() {
  const { menu: adapter } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()
  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [editing, setEditing] = useState<Tables<'menu_items'> | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT)
  const [pendingMatches, setPendingMatches] = useState<CategoryMatch[] | null>(null)
  const [renaming, setRenaming] = useState<Tables<'menu_categories'> | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [retiring, setRetiring] = useState<Tables<'menu_items'> | null>(null)
  const [revealedItem, setRevealedItem] = useState<string | null>(null)
  const [revealedCategory, setRevealedCategory] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!outletId) return []
    const next = await adapter.listMenu(outletId)
    setMenu(next)
    return next
  }, [adapter, outletId])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const next = outletId ? await adapter.listMenu(outletId) : []
        if (active) setMenu(next)
      } catch {
        if (active) setError('Could not load the menu. Try again in a moment.')
      }
    })()
    return () => {
      active = false
    }
  }, [adapter, outletId])

  const categories = useMemo(() => menu ?? [], [menu])
  const suggestions = useMemo(() => categories.map(({ category }) => category.name), [categories])
  // The database resolves a category by `lower(btrim(name))`, so that exact rule
  // is what counts as already existing. Anything short of it — an accent, a
  // hyphen, a doubled space — is a near miss the matcher below has to catch.
  const categoryExists = suggestions.some(
    (name) => name.toLocaleLowerCase() === draft.categoryName.trim().toLocaleLowerCase(),
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
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

  function openAdd() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    setItemFormOpen(true)
  }

  function openEdit(item: Tables<'menu_items'>) {
    const category = categories.find(({ category }) => category.id === item.category_id)?.category
    setEditing(item)
    setDraft({
      categoryName: category?.name ?? '',
      name: item.name,
      price: String(paiseToRupees(item.price_paise)),
      description: item.description ?? '',
      isVeg: item.is_veg,
    })
    setError(null)
    setItemFormOpen(true)
  }

  function firstProblem() {
    if (!draft.name.trim()) return 'An item needs a name — it is what the bill records.'
    if (!draft.categoryName.trim())
      return 'An item needs a category — that is how the counter groups it.'
    const rupees = Number(draft.price.trim())
    if (!draft.price.trim() || !Number.isFinite(rupees) || rupees < 0) {
      return 'An item needs a price, as a number of rupees.'
    }
    return null
  }

  function submitItem(event: FormEvent) {
    event.preventDefault()
    const problem = firstProblem()
    if (problem) {
      setError(problem)
      return
    }
    if (!categoryExists) {
      // A confirmation shown for every new category is read for none of them,
      // and an outlet's whole menu is entered in one sitting. So only a real
      // resemblance stops the save.
      const matches = matchCategory(draft.categoryName, suggestions)
      if (matches.length > 0) {
        setPendingMatches(matches)
        return
      }
    }
    void saveItem()
  }

  async function saveItem(categoryOverride?: string) {
    if (!outletId) return
    const chosenCategory = categoryOverride ?? draft.categoryName
    const pricePaise = rupeesToPaise(Number(draft.price.trim()))
    await run(async () => {
      if (editing) {
        const item = await adapter.updateItemWithCategory(editing.id, {
          categoryName: chosenCategory,
          name: draft.name,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
        setRevealedItem(item.id)
      } else {
        const created = await adapter.createItemWithCategory({
          outletId,
          categoryName: chosenCategory,
          name: draft.name,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
        setRevealedCategory(created.category.id)
        setRevealedItem(created.item.id)
      }
      setPendingMatches(null)
      setItemFormOpen(false)
      await load()
    })
  }

  async function renameCategory(event: FormEvent) {
    event.preventDefault()
    if (!renaming || !categoryName.trim()) return
    await run(async () => {
      await adapter.updateCategory(renaming.id, { name: categoryName })
      setRenaming(null)
      await load()
    })
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    const current = categories[index]
    const other = categories[index + direction]
    if (!current || !other) return
    await run(async () => {
      await Promise.all([
        adapter.updateCategory(current.category.id, { sortOrder: other.category.sort_order }),
        adapter.updateCategory(other.category.id, { sortOrder: current.category.sort_order }),
      ])
      await load()
    })
  }

  const priceChanged =
    editing !== null &&
    Number.isFinite(Number(draft.price.trim())) &&
    draft.price.trim() !== '' &&
    rupeesToPaise(Number(draft.price.trim())) !== editing.price_paise

  const addButton = <AddButton label="Add" data-testid="add-menu-item" onClick={openAdd} />

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        scope={outletSelector}
        title="Menu"
        subtitle="What this outlet sells. Add the item; its category is created with it when needed."
        action={addButton}
      />

      {error && (
        <p role="alert" data-testid="menu-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {menu === null ? (
        <LoadingList
          label="the menu"
          rows={3}
          blockHeight="h-40"
          className="space-y-4"
          data-testid="menu-loading"
        />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="Nothing on the menu yet. Use Add above for the first item and name the category it belongs under."
        />
      ) : (
        <div className="space-y-4" data-testid="menu-list">
          {categories.map(({ category, items }, categoryIndex) => (
            <RevealAdded key={category.id} active={revealedCategory === category.id}>
              <Card className="space-y-2" data-testid={`category-${category.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-content">{category.name}</h2>
                  <RowActionsMenu
                    label={`Actions for ${category.name}`}
                    compact
                    actions={[
                      {
                        label: 'Rename',
                        onSelect: () => {
                          setRenaming(category)
                          setCategoryName(category.name)
                        },
                      },
                      {
                        label: 'Move up',
                        disabled: categoryIndex === 0 || busy,
                        onSelect: () => void moveCategory(categoryIndex, -1),
                      },
                      {
                        label: 'Move down',
                        disabled: categoryIndex === categories.length - 1 || busy,
                        onSelect: () => void moveCategory(categoryIndex, 1),
                      },
                    ]}
                  />
                </div>
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <RevealAdded
                      as="li"
                      key={item.id}
                      active={revealedItem === item.id}
                      data-testid={`menu-item-${item.id}`}
                      className={`flex items-center gap-3 py-2 ${!item.is_available ? 'bg-surface-raised text-content-muted opacity-70' : ''}`}
                    >
                      <VegMarker isVeg={item.is_veg} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-content">{item.name}</p>
                          {!item.is_available && (
                            <span
                              data-testid={`unavailable-${item.id}`}
                              className="rounded-md border border-border px-1.5 py-0.5 text-[0.6875rem] font-bold text-content-muted"
                            >
                              OFF
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="truncate text-xs text-content-muted">{item.description}</p>
                        )}
                      </div>
                      <Money paise={item.price_paise} className="shrink-0 text-sm font-semibold" />
                      <RowActionsMenu
                        label={`Actions for ${item.name}`}
                        compact
                        actions={[
                          {
                            label: item.is_available ? 'Turn off' : 'Turn on',
                            disabled: busy,
                            testId: `toggle-${item.id}`,
                            onSelect: () =>
                              void run(async () => {
                                await adapter.setItemAvailability(item.id, !item.is_available)
                                await load()
                              }),
                          },
                          {
                            label: 'Edit',
                            disabled: busy,
                            testId: `edit-${item.id}`,
                            onSelect: () => openEdit(item),
                          },
                          {
                            label: 'Retire',
                            disabled: busy,
                            testId: `retire-${item.id}`,
                            onSelect: () => setRetiring(item),
                          },
                        ]}
                      />
                    </RevealAdded>
                  ))}
                </ul>
              </Card>
            </RevealAdded>
          ))}
        </div>
      )}

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
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Category" id="menu-item-category">
            <CategoryInput
              id="menu-item-category"
              label="Category"
              value={draft.categoryName}
              suggestions={suggestions}
              onChange={(value) => setDraft({ ...draft, categoryName: value })}
            />
          </Field>
          <Field label="Price (₹)" id="menu-item-price">
            <Input
              id="menu-item-price"
              required
              inputMode="decimal"
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
            {priceChanged && (
              <p
                data-testid="price-change-warning"
                className="rounded-lg border border-warning bg-surface-raised p-2 text-xs text-content"
              >
                This price applies to bills rung from now on. Every captured line keeps the price it
                recorded.
              </p>
            )}
          </Field>
          <Field label="Description (optional)" id="menu-item-description">
            <Input
              id="menu-item-description"
              value={draft.description}
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

      {/* Mounted only while there is something to ask, so its selection starts
          empty every time it opens. */}
      {pendingMatches !== null && (
        <CategoryMatchDialog
          open
          typed={draft.categoryName.trim()}
          matches={pendingMatches}
          busy={busy}
          onChoose={(name) => {
            setDraft((current) => ({ ...current, categoryName: name }))
            void saveItem(name)
          }}
          onCreate={() => void saveItem()}
          onClose={() => setPendingMatches(null)}
        />
      )}

      <FormSheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename category"
        error={error}
        footer={
          <button
            type="submit"
            form="rename-menu-category"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            Save name
          </button>
        }
      >
        <form id="rename-menu-category" onSubmit={renameCategory} noValidate>
          <Field label="Category name" id="rename-category">
            <Input
              id="rename-category"
              required
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
          </Field>
        </form>
      </FormSheet>

      <ConfirmDialog
        open={retiring !== null}
        title={`Retire ${retiring?.name ?? 'item'}?`}
        consequence="It disappears from the working menu. Captured order and bill lines keep their recorded name and price."
        confirmLabel="Retire item"
        danger
        onClose={() => setRetiring(null)}
        onConfirm={() => {
          const item = retiring
          setRetiring(null)
          if (item)
            void run(async () => {
              await adapter.retireItem(item.id)
              await load()
            })
        }}
      />
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
