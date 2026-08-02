import { Package, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type InventoryItemSummary,
  type InventoryUnit,
} from '@/data-access/adapters'
import { formatQuantity, resolveBusinessDate, type MovementType } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * Stock — what is in the shop, and the ledger that says why.
 *
 * Recording a movement is the primary action, so it is one tap from the item's
 * row rather than behind an edit form: it happens standing in a kitchen at the
 * end of a shift.
 *
 * **The sign is the app's business, not the person's.** Somebody counting stock
 * types how much was used; a minus in front of it would be one more thing to get
 * wrong, and getting it wrong would silently *add* stock that does not exist.
 * The one exception is a correction, whose direction is the entire point of it.
 *
 * Low stock is an icon and the words, not a colour. Roughly one man in twelve
 * cannot read a colour-only signal, and this is a list read at speed.
 */

const UNITS: { value: InventoryUnit; label: string }[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'litre', label: 'Litres' },
  { value: 'packet', label: 'Packets' },
  { value: 'piece', label: 'Pieces' },
]

const MOVEMENTS: { value: MovementType; label: string; hint: string }[] = [
  { value: 'added', label: 'Added', hint: 'A delivery, or anything else coming in.' },
  { value: 'used', label: 'Used', hint: 'Consumed in service.' },
  { value: 'wasted', label: 'Wasted', hint: 'Spoiled, dropped, or thrown away.' },
  {
    value: 'correction',
    label: 'Correction',
    hint: 'A recount. Type a minus for less than recorded — and say what was wrong.',
  },
]

interface MovementDraft {
  movementType: MovementType
  quantity: string
  note: string
}

const EMPTY_MOVEMENT: MovementDraft = { movementType: 'used', quantity: '', note: '' }

/** What an owner recording into somebody else's books is told, once. */
const REMOTE_ENTRY_NOTE =
  'Recording into an outlet you do not run. Only a correction is available, and this will be recorded as yours.'

interface ItemDraft {
  name: string
  unit: InventoryUnit
  lowStockThreshold: string
}

const EMPTY_ITEM: ItemDraft = { name: '', unit: 'kg', lowStockThreshold: '' }

export function InventorySurface() {
  const { inventory: adapter, outlets } = useAdapters()

  const [items, setItems] = useState<InventoryItemSummary[] | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState<InventoryItemSummary | null>(null)
  const [movement, setMovement] = useState<MovementDraft>(EMPTY_MOVEMENT)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM)

  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, managed, selector: outletSelector } = useOutletScope()

  // As on expenses: at an outlet the caller does not run, only a correction is
  // available, because that is the only movement `inventory_movements_insert`
  // accepts from the owner's branch. Receiving and consuming stock is done
  // standing in the shop (multi-outlet-people, design D8).
  const movements = managed ? MOVEMENTS : MOVEMENTS.filter((kind) => kind.value === 'correction')

  const load = useCallback(async () => {
    if (!outletId) return
    setItems(await adapter.listItems(outletId))
  }, [adapter, outletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void (async () => {
      try {
        const [list, outlet] = await Promise.all([
          adapter.listItems(outletId),
          outlets.getOutlet(outletId),
        ])
        if (!active) return
        setItems(list)
        // Resolved through the outlet's own cutover, never taken as "the date
        // on this phone": stock counted at 00:30 belongs to the shift that is
        // still going on.
        setBusinessDate(
          outlet ? resolveBusinessDate(new Date(), outlet.business_day_cutover) : null,
        )
      } catch {
        if (active) setError('Could not load the stock list. Try again in a moment.')
      }
    })()
    return () => {
      active = false
    }
  }, [adapter, outlets, outletId])

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

  async function submitMovement(event: FormEvent) {
    event.preventDefault()
    if (!moving || !businessDate) return

    const quantity = Number(movement.quantity.trim())
    if (movement.quantity.trim() === '' || !Number.isFinite(quantity) || quantity === 0) {
      setError('A movement needs a quantity, and it cannot be zero.')
      return
    }

    await run(async () => {
      await adapter.recordMovement({
        inventoryItemId: moving.id,
        movementType: movement.movementType,
        quantity,
        note: movement.note,
        businessDate,
      })
      setMoving(null)
      setMovement(managed ? EMPTY_MOVEMENT : { ...EMPTY_MOVEMENT, movementType: 'correction' })
    })
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault()
    if (!outletId) return
    if (itemDraft.name.trim() === '') {
      setError('A stock item needs a name — it is what the movement form asks about.')
      return
    }
    const threshold = Number(itemDraft.lowStockThreshold.trim() || '0')
    if (!Number.isFinite(threshold) || threshold < 0) {
      setError('A low-stock threshold must be a number, and cannot be negative.')
      return
    }

    await run(async () => {
      await adapter.createItem({
        outletId,
        name: itemDraft.name,
        unit: itemDraft.unit,
        lowStockThreshold: threshold,
      })
      setItemDraft(EMPTY_ITEM)
      setItemFormOpen(false)
    })
  }

  const addButton = (
    <AddButton
      label="Add stock item"
      data-testid="add-stock-item"
      onClick={() => {
        setError(null)
        setItemDraft(EMPTY_ITEM)
        setItemFormOpen(true)
      }}
    />
  )

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        scope={outletSelector}
        title="Stock"
        subtitle="What is in the shop, and the ledger behind every figure."
        action={managed && items && items.length > 0 ? addButton : undefined}
      />

      {error && (
        <p
          role="alert"
          data-testid="stock-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {items === null ? (
        // The `space-y-2` stock list, at the height of a card holding a name,
        // its quantity, and the buttons beside them.
        <LoadingList
          label="what this outlet stocks"
          rows={5}
          blockHeight="h-16"
          className="space-y-2"
          data-testid="stock-loading"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing is being tracked yet. Add the things you count — chicken, pita, packaging — and every delivery and every day's use goes on their ledgers."
          action={managed ? addButton : undefined}
        />
      ) : (
        <ul className="space-y-2" data-testid="stock-list">
          {items.map((item) => (
            <li key={item.id}>
              <Card
                className="flex flex-wrap items-center gap-x-3 gap-y-2"
                data-testid={`stock-${item.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-content">
                    {item.name}
                    {item.isLow && (
                      <span
                        data-testid={`low-stock-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-warning px-2 py-0.5 text-xs font-semibold text-content"
                      >
                        <TriangleAlert aria-hidden size={12} className="text-warning" />
                        Low stock
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-content-muted" data-testid={`quantity-${item.id}`}>
                    {formatQuantity(item.currentQuantity, item.unit)} · reorder at{' '}
                    {formatQuantity(item.lowStockThreshold, item.unit)}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="primary"
                    size="phone"
                    disabled={busy}
                    data-testid={`record-${item.id}`}
                    onClick={() => {
                      setError(null)
                      setMovement(
                        managed
                          ? EMPTY_MOVEMENT
                          : { ...EMPTY_MOVEMENT, movementType: 'correction' },
                      )
                      setMoving(item)
                    }}
                  >
                    Record
                  </Button>
                  <Link
                    to={item.id}
                    className={buttonVariants({ variant: 'ghost', size: 'phone' })}
                    data-testid={`ledger-${item.id}`}
                  >
                    Ledger
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <FormSheet
        key={moving?.id ?? 'none'}
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={moving ? `Record a movement — ${moving.name}` : 'Record a movement'}
        error={error}
        footer={
          <button
            type="submit"
            form="movement-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Recording…' : 'Record movement'}
          </button>
        }
      >
        <form id="movement-form" onSubmit={submitMovement} className="space-y-4" noValidate>
          {!managed && (
            <p
              data-testid="remote-entry-note"
              className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted"
            >
              {REMOTE_ENTRY_NOTE}
            </p>
          )}

          <Field label="What happened" id="movement-type">
            <Select
              id="movement-type"
              value={movement.movementType}
              onChange={(event) =>
                setMovement({ ...movement, movementType: event.target.value as MovementType })
              }
            >
              {movements.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-content-muted">
              {MOVEMENTS.find((kind) => kind.value === movement.movementType)?.hint}
            </p>
          </Field>

          <Field label={`How much${moving ? ` (${moving.unit})` : ''}`} id="movement-quantity">
            <Input
              id="movement-quantity"
              required
              inputMode="decimal"
              value={movement.quantity}
              onChange={(event) => setMovement({ ...movement, quantity: event.target.value })}
            />
          </Field>

          <Field label="Note" id="movement-note">
            <Input
              id="movement-note"
              value={movement.note}
              placeholder="Optional, except on a correction"
              onChange={(event) => setMovement({ ...movement, note: event.target.value })}
            />
          </Field>
        </form>
      </FormSheet>

      <FormSheet
        open={itemFormOpen}
        onClose={() => setItemFormOpen(false)}
        title="Add stock item"
        error={error}
        footer={
          <button
            type="submit"
            form="stock-item-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Create item'}
          </button>
        }
      >
        <form id="stock-item-form" onSubmit={submitItem} className="space-y-4" noValidate>
          <Field label="Name" id="stock-name">
            <Input
              id="stock-name"
              required
              value={itemDraft.name}
              placeholder="e.g. Pita bread"
              onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })}
            />
          </Field>

          <Field label="Counted in" id="stock-unit">
            <Select
              id="stock-unit"
              value={itemDraft.unit}
              onChange={(event) =>
                setItemDraft({ ...itemDraft, unit: event.target.value as InventoryUnit })
              }
            >
              {UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Warn me at" id="stock-threshold">
            <Input
              id="stock-threshold"
              required
              inputMode="decimal"
              value={itemDraft.lowStockThreshold}
              placeholder="e.g. 10"
              onChange={(event) =>
                setItemDraft({ ...itemDraft, lowStockThreshold: event.target.value })
              }
            />
            <p className="text-xs text-content-muted">
              At or below this, the item is marked low on this screen.
            </p>
          </Field>

          <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
            A new item starts at nothing. Record what arrived and the quantity follows from the
            ledger — it is never typed in directly, which is what keeps the two agreeing.
          </p>
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
