import { Ban, Check, Share2, Sparkles, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { useChangeGate } from '@/change-gates/context'
import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { RowActionsMenu } from '@/components/layout/row-actions-menu'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { CategoryInput } from '@/components/ui/category-input'
import { CategoryMatchDialog } from '@/components/ui/category-match-dialog'
import { Input } from '@/components/ui/input'
import { LoadingList, LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { RevealAdded } from '@/components/ui/reveal-added'
import { VegMarker } from '@/components/ui/veg-marker'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type MenuCategoryWithItems,
  type MenuDiscount,
  type MenuHighlights,
  type MenuItemPhoto,
} from '@/data-access/adapters'
import { matchCategory, paiseToRupees, rupeesToPaise, type CategoryMatch } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { publicMenuLink } from '@/lib/public-menu-link'
import { useShareLink } from '@/lib/use-share-link'
import { getPartState, isRenderable } from '@/gates/registry'
import { useSession } from '@/session/context'

import { MenuDiscountsCard } from './menu-discounts'
import { MenuHighlightsCard } from './menu-highlights'
import { MenuPhotoField } from './photo/menu-photo-field'
import { UNCHANGED, type PhotoDraft } from './photo/photo-draft'
import { PhotoPrepareError } from './photo/prepare-photo'
import { savePhotoDraft, type PhotoSaveProgress } from './photo/save-photo'

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
  const { outletId, selector: outletSelector } = useOutletScope()
  // An outlet change unmounts every draft and loaded row together.
  return (
    <OutletMenuSurface
      key={outletId ?? 'loading'}
      outletId={outletId}
      outletSelector={outletSelector}
    />
  )
}

function OutletMenuSurface({
  outletId,
  outletSelector,
}: {
  outletId: string | null
  outletSelector: ReactNode
}) {
  const { menu: adapter } = useAdapters()
  const session = useSession()
  const presentation = isRenderable(getPartState('menu-presentation'), session.mode)
    ? adapter.presentation
    : undefined
  // Dish photos (#84): off, the editor and the rows are exactly as before.
  const photosOn = useChangeGate('dish-photos')
  const photos = photosOn ? adapter.photos : undefined
  const [menu, setMenu] = useState<MenuCategoryWithItems[] | null>(null)
  const [highlights, setHighlights] = useState<MenuHighlights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [editing, setEditing] = useState<Tables<'menu_items'> | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT)
  const [pendingMatches, setPendingMatches] = useState<CategoryMatch[] | null>(null)
  const [renaming, setRenaming] = useState<Tables<'menu_categories'> | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [removing, setRemoving] = useState<Tables<'menu_items'> | null>(null)
  const [discounts, setDiscounts] = useState<MenuDiscount[]>([])
  const [revealedItem, setRevealedItem] = useState<string | null>(null)
  const [revealedCategory, setRevealedCategory] = useState<string | null>(null)
  const [publicMenuSlug, setPublicMenuSlug] = useState<string | null>(null)
  const [photoList, setPhotoList] = useState<ReadonlyMap<string, MenuItemPhoto>>(new Map())
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>(UNCHANGED)
  const [photoProgress, setPhotoProgress] = useState<PhotoSaveProgress | null>(null)
  const [photoFailed, setPhotoFailed] = useState<string | null>(null)
  // The dish a failed photo belongs to, saved already: Retry and a second Save
  // change it rather than create it again.
  const [photoItem, setPhotoItem] = useState<Tables<'menu_items'> | null>(null)
  const publicMenuUrl = publicMenuLink(publicMenuSlug)
  // The link and nothing else [owner, 2026-09-29].
  const menuShare = useShareLink(publicMenuUrl)

  const load = useCallback(async () => {
    if (!outletId) return []
    // One read, because a discount that is current while the menu beside it is
    // stale prices a line wrong.
    const [next, nextHighlights, nextPhotos] = await Promise.all([
      adapter.readOutletMenu(outletId),
      presentation?.readHighlights(outletId) ?? Promise.resolve(null),
      photos?.listPhotos(outletId) ?? Promise.resolve(null),
    ])
    setMenu(next.categories)
    setHighlights(nextHighlights)
    setDiscounts(next.discounts)
    setPublicMenuSlug(next.publicMenuSlug ?? null)
    if (nextPhotos) setPhotoList(new Map(nextPhotos.map((photo) => [photo.itemId, photo])))
    return next.categories
  }, [adapter, outletId, presentation, photos])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!outletId) return
        const [next, nextHighlights, nextPhotos] = await Promise.all([
          adapter.readOutletMenu(outletId),
          presentation?.readHighlights(outletId) ?? Promise.resolve(null),
          photos?.listPhotos(outletId) ?? Promise.resolve(null),
        ])
        if (active) {
          setMenu(next.categories)
          setHighlights(nextHighlights)
          setDiscounts(next.discounts)
          setPublicMenuSlug(next.publicMenuSlug ?? null)
          if (nextPhotos) setPhotoList(new Map(nextPhotos.map((photo) => [photo.itemId, photo])))
        }
      } catch {
        if (active) setError('Could not load the menu. Try again in a moment.')
      }
    })()
    return () => {
      active = false
    }
  }, [adapter, outletId, presentation, photos])

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

  function resetPhoto() {
    setPhotoDraft(UNCHANGED)
    setPhotoFailed(null)
    setPhotoItem(null)
  }

  function openAdd() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    resetPhoto()
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
    resetPhoto()
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
    // A dish saved before its photo failed is changed, not created again.
    const target = editing ?? photoItem
    await run(async () => {
      let saved: Tables<'menu_items'>
      if (target) {
        saved = await adapter.updateItemWithCategory(target.id, {
          categoryName: chosenCategory,
          name: draft.name,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
        setRevealedItem(saved.id)
      } else {
        const created = await adapter.createItemWithCategory({
          outletId,
          categoryName: chosenCategory,
          name: draft.name,
          pricePaise,
          description: draft.description,
          isVeg: draft.isVeg,
        })
        saved = created.item
        setRevealedCategory(created.category.id)
        setRevealedItem(created.item.id)
      }
      setPendingMatches(null)
      // The photo goes after the dish's own fields, which stay saved if it fails.
      if (photos && photoDraft.kind !== 'unchanged') {
        setPhotoItem(saved)
        const sent = await sendPhoto(saved)
        await load()
        if (!sent) return
      }
      setItemFormOpen(false)
      await load()
    })
  }

  async function sendPhoto(item: Tables<'menu_items'>): Promise<boolean> {
    if (!photos) return true
    setPhotoFailed(null)
    try {
      await savePhotoDraft(
        photos,
        item.id,
        photoDraft,
        photoList.get(item.id) ?? null,
        setPhotoProgress,
      )
      setPhotoDraft(UNCHANGED)
      return true
    } catch (cause) {
      setPhotoFailed(
        cause instanceof DataActionError || cause instanceof PhotoPrepareError
          ? cause.message
          : 'Check the connection and try again.',
      )
      return false
    } finally {
      setPhotoProgress(null)
    }
  }

  async function retryPhoto() {
    const item = photoItem
    if (!item) return
    await run(async () => {
      const sent = await sendPhoto(item)
      await load()
      if (sent) setItemFormOpen(false)
    })
  }

  function closeItemForm() {
    setItemFormOpen(false)
    resetPhoto()
  }

  const editingPhoto = photos ? (photoList.get((editing ?? photoItem)?.id ?? '') ?? null) : null

  const saveLabel = !busy
    ? editing
      ? 'Save changes'
      : 'Create item'
    : photoProgress?.stage === 'sending'
      ? `Sending photo ${photoProgress.done} of ${photoProgress.total}…`
      : photoProgress?.stage === 'preparing'
        ? 'Preparing photo…'
        : 'Saving…'

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

  async function moveItem(entry: MenuCategoryWithItems, index: number, direction: -1 | 1) {
    if (!presentation) return
    const ids = entry.items.map((item) => item.id)
    const other = index + direction
    if (!ids[index] || !ids[other]) return
    ;[ids[index], ids[other]] = [ids[other]!, ids[index]!]
    await run(async () => {
      await presentation.reorderItems(entry.category.id, ids)
      await load()
    })
  }

  async function saveHighlights(next: MenuHighlights) {
    if (!presentation || !outletId) return
    await presentation.setHighlights(outletId, next)
    await load()
  }

  const priceChanged =
    editing !== null &&
    Number.isFinite(Number(draft.price.trim())) &&
    draft.price.trim() !== '' &&
    rupeesToPaise(Number(draft.price.trim())) !== editing.price_paise

  const addButton = <AddButton label="Add" data-testid="add-menu-item" onClick={openAdd} />

  /*
    The public menu exists to be handed to customers, so it is shared rather
    than opened, exactly as a bill's receipt link is: share sheet, else a copy
    with a tick, else the address as text (the-menu-is-public, design D5). A
    labelled button beside Add, in the quiet secondary colours so Add stays the
    one highlighted action [owner, 2026-09-29].
  */
  const shareButton = publicMenuUrl && (
    <Button
      variant="secondary"
      size="phone"
      className="whitespace-nowrap"
      onClick={() => void menuShare.share()}
      aria-label={menuShare.copied ? 'Public menu link copied' : 'Share public menu'}
      data-testid="share-public-menu"
    >
      {menuShare.copied ? <Check aria-hidden size={18} /> : <Share2 aria-hidden size={18} />}
      {menuShare.copied ? 'Copied' : 'Share'}
    </Button>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Menu"
        subtitle="What this outlet sells. Add the item; its category is created with it when needed."
        action={
          <>
            {shareButton}
            {addButton}
          </>
        }
      />

      {/* Announced when the copy lands; the icon turning to a tick is the sighted half. */}
      <p aria-live="polite" className="sr-only">
        {menuShare.copied ? 'Public menu link copied.' : ''}
      </p>
      {menuShare.revealed && publicMenuUrl && (
        <p
          data-testid="public-menu-url"
          className="mb-3 rounded-lg border border-border bg-surface p-3 font-mono text-xs break-all text-content"
        >
          {publicMenuUrl}
        </p>
      )}

      {error && (
        <p role="alert" data-testid="menu-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {menu === null ? (
        <LoadingRegion label="menu discounts" className="mb-3">
          <Shimmer className="h-[70px]" />
        </LoadingRegion>
      ) : (
        <MenuDiscountsCard
          discounts={discounts}
          categories={categories}
          busy={busy}
          // Deliberately not wrapped in `run`: a refusal belongs inside the
          // sheet the reader is still looking at, not on the page behind it.
          onCreate={async (discount) => {
            if (!outletId) return
            await adapter.createDiscount({ ...discount, outletId })
            await load()
          }}
          // Also unwrapped: an edit's refusal belongs in the sheet too.
          onUpdate={async (id, patch) => {
            await adapter.updateDiscount(id, patch)
            await load()
          }}
          onRemove={(id) =>
            run(async () => {
              await adapter.removeDiscount(id)
              await load()
            })
          }
        />
      )}

      {presentation &&
        (highlights === null ? (
          <LoadingRegion label="menu highlights" className="mb-3" data-testid="highlights-loading">
            <Shimmer className="h-[70px]" />
          </LoadingRegion>
        ) : (
          <MenuHighlightsCard
            highlights={highlights}
            categories={categories}
            busy={busy}
            onSave={saveHighlights}
          />
        ))}

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
                  {items.map((item, itemIndex) => (
                    <RevealAdded
                      as="li"
                      key={item.id}
                      active={revealedItem === item.id}
                      data-testid={`menu-item-${item.id}`}
                      className={`flex items-center gap-3 py-2 ${!item.is_available ? 'bg-surface-raised text-content-muted' : ''}`}
                    >
                      <div
                        className={`flex min-w-0 flex-1 items-center gap-3 ${!item.is_available ? 'opacity-70' : ''}`}
                      >
                        <VegMarker isVeg={item.is_veg} />
                        {photos && photoList.has(item.id) && (
                          <img
                            src={photoList.get(item.id)!.thumbUrl}
                            alt=""
                            loading="lazy"
                            width={32}
                            height={32}
                            data-testid={`menu-photo-row-${item.id}`}
                            className="size-8 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-content">
                              {item.name}
                            </p>
                            {highlights?.itemIds.includes(item.id) && (
                              <span
                                role="img"
                                aria-label="Highlighted"
                                title="Highlighted"
                                className="inline-flex shrink-0 text-primary"
                              >
                                <Sparkles size={14} aria-hidden />
                              </span>
                            )}
                            {!item.is_available && (
                              <span
                                role="img"
                                aria-label="Unavailable"
                                title="Unavailable"
                                data-testid={`unavailable-${item.id}`}
                                className="inline-flex shrink-0 text-content-muted"
                              >
                                <Ban size={14} aria-hidden />
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="truncate text-xs text-content-muted">
                              {item.description}
                            </p>
                          )}
                        </div>
                        <Money
                          paise={item.price_paise}
                          className="shrink-0 text-sm font-semibold"
                        />
                      </div>
                      <RowActionsMenu
                        label={`Actions for ${item.name}`}
                        compact
                        actions={[
                          ...(presentation
                            ? [
                                {
                                  label: 'Move up',
                                  disabled: itemIndex === 0 || busy,
                                  onSelect: () => void moveItem({ category, items }, itemIndex, -1),
                                },
                                {
                                  label: 'Move down',
                                  disabled: itemIndex === items.length - 1 || busy,
                                  onSelect: () => void moveItem({ category, items }, itemIndex, 1),
                                },
                                {
                                  label: highlights?.itemIds.includes(item.id)
                                    ? 'Remove highlight'
                                    : 'Highlight',
                                  disabled: busy || highlights === null,
                                  onSelect: () =>
                                    void run(async () => {
                                      if (!highlights) return
                                      await saveHighlights({
                                        ...highlights,
                                        itemIds: highlights.itemIds.includes(item.id)
                                          ? highlights.itemIds.filter((id) => id !== item.id)
                                          : [...highlights.itemIds, item.id],
                                      })
                                    }),
                                },
                              ]
                            : []),
                          {
                            // Verbs for what happens, never a bare on/off: *off* did not
                            // say whether the item was sold out or gone (design D1).
                            label: item.is_available ? 'Mark unavailable' : 'Mark available',
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
                            label: 'Remove',
                            disabled: busy,
                            testId: `remove-${item.id}`,
                            onSelect: () => setRemoving(item),
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
        busy={busy}
        key={editing?.id ?? 'new-item'}
        open={itemFormOpen}
        onClose={closeItemForm}
        title={editing ? `Edit ${editing.name}` : 'Add item'}
        error={error}
        footer={
          <button
            type="submit"
            form="menu-item-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {saveLabel}
          </button>
        }
      >
        <form id="menu-item-form" onSubmit={submitItem} className="space-y-4" noValidate>
          {photos && (
            <MenuPhotoField
              saved={editingPhoto}
              draft={photoDraft}
              onDraftChange={(next) => {
                setPhotoDraft(next)
                setPhotoFailed(null)
              }}
              disabled={busy}
            />
          )}
          {photos && photoFailed && (
            <div
              role="alert"
              data-testid="menu-photo-failed"
              className="space-y-2 rounded-lg border border-danger bg-surface-raised p-3 text-sm"
            >
              <p className="font-semibold text-danger">Photo not saved</p>
              <p className="text-content">{photoFailed} The dish’s other changes are saved.</p>
              <Button
                variant="secondary"
                size="phone"
                disabled={busy}
                onClick={() => void retryPhoto()}
              >
                Retry
              </Button>
            </div>
          )}
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
        busy={busy}
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
        open={removing !== null}
        title={`Remove ${removing?.name ?? 'item'}?`}
        consequence="It disappears from the working menu. Captured order and bill lines keep their recorded name and price."
        confirmLabel="Remove item"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const item = removing
          setRemoving(null)
          if (item)
            void run(async () => {
              await adapter.removeItem(item.id)
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
