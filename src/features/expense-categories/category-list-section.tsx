import { ArrowDown, ArrowUp, ListChecks } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { RowActionsMenu } from '@/components/layout/row-actions-menu'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Switch } from '@/components/ui/switch'
import { useAdapters } from '@/data-access'
import { DataActionError, type ExpenseCategoryChoice } from '@/data-access/adapters'
import { normalizeCategory } from '@/domain'

interface Draft {
  id?: string
  /** The name before this edit, to say what a rename moves. */
  was: string | null
  name: string
  asksNote: boolean
  managersOnly: boolean
}

/**
 * The owners' list an expense's category is picked from
 * (a-check-in-at-the-shop-approves-itself, design D11; `expense-category-list`).
 *
 * In the owners' order, which is the order the tiles take. A rename moves the
 * recorded expenses with it, because renaming a bucket means the same bucket;
 * a removal leaves them as they are. The typed names below it stay for folding
 * old entries into the list's names.
 */
export function CategoryListSection({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const { expenseCategories: adapter } = useAdapters()
  const [choices, setChoices] = useState<ExpenseCategoryChoice[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<ExpenseCategoryChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setChoices(await adapter.choices())
  }, [adapter])

  useEffect(() => {
    let active = true
    void adapter
      .choices()
      .then((list) => {
        if (active) setChoices(list)
      })
      .catch(() => {
        if (active) setError('Could not load the list. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter])

  async function run(act: () => Promise<void>, failed: string) {
    setBusy(true)
    setError(null)
    try {
      await act()
      await Promise.all([load(), onChanged()])
      return true
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : failed)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const name = normalizeCategory(draft.name)
    if (!name) {
      setError('A category needs a name.')
      return
    }
    const saved = await run(
      () =>
        adapter.saveChoice({
          ...(draft.id ? { id: draft.id } : {}),
          name,
          asksNote: draft.asksNote,
          managersOnly: draft.managersOnly,
        }),
      'That did not save. Try again in a moment.',
    )
    if (saved) setDraft(null)
  }

  const renaming =
    draft?.was !== null &&
    draft?.was !== undefined &&
    normalizeCategory(draft.name).toLocaleLowerCase() !== draft.was.toLocaleLowerCase()

  return (
    <section className="space-y-2" data-testid="expense-category-choices">
      <div className="flex items-center justify-between gap-2 pt-1">
        <h2 className="text-sm font-bold text-content">The list</h2>
        <AddButton
          label="Add category"
          data-testid="add-category-choice"
          onClick={() => {
            setError(null)
            setDraft({ was: null, name: '', asksNote: false, managersOnly: false })
          }}
        />
      </div>

      {error && draft === null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {choices === null ? (
        <LoadingFigures label="the category list" rows={[4, 3]} />
      ) : choices.length === 0 ? (
        <EmptyState icon={ListChecks} title="No categories on the list. Expenses are typed." />
      ) : (
        <Card className="divide-y divide-border p-0">
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              className="flex items-center gap-2 px-3 py-2"
              data-testid={`category-choice-${choice.name}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-content">{choice.name}</p>
                {(choice.asksNote || choice.managersOnly) && (
                  <p className="mt-0.5 flex flex-wrap gap-1">
                    {choice.asksNote && <Tag>Asks what it was for</Tag>}
                    {choice.managersOnly && <Tag>Managers and owners</Tag>}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="phone"
                className="w-11 shrink-0 px-0"
                aria-label={`Move ${choice.name} up`}
                disabled={busy || index === 0}
                onClick={() =>
                  void run(() => adapter.moveChoice(choice.id, 'up'), 'That did not move.')
                }
              >
                <ArrowUp aria-hidden size={16} />
              </Button>
              <Button
                variant="ghost"
                size="phone"
                className="w-11 shrink-0 px-0"
                aria-label={`Move ${choice.name} down`}
                disabled={busy || index === choices.length - 1}
                onClick={() =>
                  void run(() => adapter.moveChoice(choice.id, 'down'), 'That did not move.')
                }
              >
                <ArrowDown aria-hidden size={16} />
              </Button>
              <RowActionsMenu
                compact
                label={`Actions for ${choice.name}`}
                actions={[
                  {
                    label: 'Edit',
                    testId: `edit-category-choice-${choice.name}`,
                    onSelect: () => {
                      setError(null)
                      setDraft({ ...choice, was: choice.name })
                    },
                  },
                  {
                    label: 'Remove',
                    testId: `remove-category-choice-${choice.name}`,
                    onSelect: () => {
                      setError(null)
                      setRemoving(choice)
                    },
                  },
                ]}
              />
            </div>
          ))}
        </Card>
      )}

      <FormSheet
        busy={busy}
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit category' : 'Add category'}
        error={error}
        footer={
          <button
            type="submit"
            form="category-choice-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        }
      >
        {draft && (
          <form id="category-choice-form" onSubmit={submit} className="space-y-4" noValidate>
            <label className="block space-y-1 text-sm font-semibold">
              Name
              <Input
                required
                value={draft.name}
                data-testid="category-choice-name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-content">Ask what it was for</span>
              <Switch
                checked={draft.asksNote}
                label="Ask what it was for"
                testId="category-choice-asks-note"
                onChange={(asksNote) => setDraft({ ...draft, asksNote })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-content">Managers and owners only</span>
              <Switch
                checked={draft.managersOnly}
                label="Managers and owners only"
                testId="category-choice-managers-only"
                onChange={(managersOnly) => setDraft({ ...draft, managersOnly })}
              />
            </div>
            {renaming && (
              <p className="rounded-xl border border-warning bg-surface-raised p-3 text-sm text-content">
                Expenses already recorded as <strong>{draft.was}</strong> move to the new name.
              </p>
            )}
          </form>
        )}
      </FormSheet>

      <ConfirmDialog
        open={removing !== null}
        title="Remove from the list?"
        consequence={
          removing
            ? `${removing.name} stops being offered. Expenses already recorded as ${removing.name} keep that name.`
            : ''
        }
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) void run(() => adapter.removeChoice(target.id), 'That was not removed.')
        }}
      />
    </section>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-content-muted">
      {children}
    </span>
  )
}
