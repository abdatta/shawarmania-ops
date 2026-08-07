import { Combine, Pencil, Tags, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type ExpenseCategoryOperation,
  type ExpenseCategorySuggestion,
} from '@/data-access/adapters'
import { formatDateTime, normalizeCategory } from '@/domain'

type Action =
  | { kind: 'rename'; category: ExpenseCategorySuggestion }
  | { kind: 'merge'; category: ExpenseCategorySuggestion }

export function ExpenseCategoriesSurface() {
  const { expenseCategories: adapter } = useAdapters()
  const [categories, setCategories] = useState<ExpenseCategorySuggestion[] | null>(null)
  const [operations, setOperations] = useState<ExpenseCategoryOperation[] | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [retiring, setRetiring] = useState<ExpenseCategorySuggestion | null>(null)
  const [target, setTarget] = useState('')
  const [rewriteHistory, setRewriteHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [nextCategories, nextOperations] = await Promise.all([
      adapter.list(),
      adapter.listOperations(),
    ])
    setCategories(nextCategories)
    setOperations(nextOperations)
  }, [adapter])

  useEffect(() => {
    let active = true
    void Promise.all([adapter.list(), adapter.listOperations()])
      .then(([nextCategories, nextOperations]) => {
        if (!active) return
        setCategories(nextCategories)
        setOperations(nextOperations)
      })
      .catch(() => {
        if (active) setError('Could not load the category list. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!action) return
    const normalized = normalizeCategory(target)
    if (!normalized) {
      setError('Choose or type the category this should become.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const moved =
        action.kind === 'rename'
          ? await adapter.rename(action.category.name, normalized, rewriteHistory)
          : await adapter.merge(action.category.name, normalized)
      setResult(
        `${action.kind === 'rename' ? 'Renamed' : 'Merged'} ${action.category.name}. ` +
          `${moved.ledgerRowsMoved} ledger rows and ${moved.expenseRowsMoved} expense rows moved.`,
      )
      setAction(null)
      setTarget('')
      setRewriteHistory(false)
      await load()
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That change did not finish.')
    } finally {
      setBusy(false)
    }
  }

  async function retire() {
    if (!retiring) return
    const name = retiring.name
    setRetiring(null)
    setBusy(true)
    setError(null)
    try {
      await adapter.retire(name)
      setResult(`${name} was retired from suggestions. Recorded expenses were not changed.`)
      await load()
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That category was not retired.')
    } finally {
      setBusy(false)
    }
  }

  const source = action?.category
  const movedLedger =
    action?.kind === 'rename' && !rewriteHistory ? 0 : (source?.ledgerUsageCount ?? 0)
  const movedExpenses =
    action?.kind === 'rename' && !rewriteHistory ? 0 : (source?.expenseUsageCount ?? 0)

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <PageHeader
        title="Expense categories"
        subtitle="Suggestions are business-wide. Recorded rows keep their own text until you deliberately rewrite history."
      />

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="text-sm font-semibold text-content">
          {result}
        </p>
      )}

      {categories === null ? (
        <LoadingFigures
          label="expense categories and their usage"
          rows={[5, 5, 4]}
          data-testid="expense-categories-loading"
        />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No categories yet. The first expense typed at either outlet will start this list."
        />
      ) : (
        <div className="space-y-2" data-testid="expense-category-list">
          {categories.map((category) => (
            <Card key={category.id} className="space-y-2" data-testid={`category-${category.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-content">{category.name}</h2>
                  <p className="text-xs text-content-muted">
                    Ledger {category.ledgerUsageCount} · Expenses {category.expenseUsageCount}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="secondary"
                    size="phone"
                    onClick={() => {
                      setAction({ kind: 'rename', category })
                      setTarget(category.name)
                      setRewriteHistory(false)
                    }}
                  >
                    <Pencil aria-hidden size={15} /> Rename
                  </Button>
                  <Button
                    variant="secondary"
                    size="phone"
                    disabled={categories.length < 2}
                    onClick={() => {
                      setAction({ kind: 'merge', category })
                      setTarget(
                        categories.find((candidate) => candidate.id !== category.id)?.name ?? '',
                      )
                    }}
                  >
                    <Combine aria-hidden size={15} /> Merge
                  </Button>
                  <Button variant="ghost" size="phone" onClick={() => setRetiring(category)}>
                    <Trash2 aria-hidden size={15} /> Retire
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-2" data-testid="category-operation-log">
        <h2 className="text-sm font-bold text-content">Category changes</h2>
        {operations === null ? (
          <LoadingFigures label="category change history" rows={[3]} />
        ) : operations.length === 0 ? (
          <p className="text-sm text-content-muted">No rename or merge has rewritten the month.</p>
        ) : (
          <ul className="space-y-2">
            {operations.map((operation) => (
              <li
                key={operation.id}
                className="border-t border-border pt-2 text-sm first:border-0 first:pt-0"
              >
                <p className="font-semibold text-content">
                  {operation.operation === 'merge' ? 'Merged' : 'Renamed'} {operation.nameBefore} →{' '}
                  {operation.nameAfter}
                </p>
                <p className="text-xs text-content-muted">
                  {operation.ledgerRowsMoved} ledger rows · {operation.expenseRowsMoved} expense
                  rows · {formatDateTime(operation.performedAt)} · account {operation.performedBy}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FormSheet
        open={action !== null}
        onClose={() => setAction(null)}
        title={action?.kind === 'merge' ? 'Merge category' : 'Rename category'}
        error={error}
        footer={
          <button
            type="submit"
            form="category-action-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy
              ? 'Changing…'
              : action?.kind === 'merge'
                ? 'Merge permanently'
                : 'Rename category'}
          </button>
        }
      >
        {source && (
          <form id="category-action-form" onSubmit={submit} className="space-y-4">
            {action?.kind === 'merge' ? (
              <label className="block space-y-1 text-sm font-semibold">
                Merge {source.name} into
                <Select value={target} onChange={(event) => setTarget(event.target.value)}>
                  {categories
                    ?.filter((category) => category.id !== source.id)
                    .map((category) => (
                      <option key={category.id} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                </Select>
              </label>
            ) : (
              <label className="block space-y-1 text-sm font-semibold">
                New name
                <Input
                  required
                  className="text-base"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </label>
            )}

            {action?.kind === 'rename' && (
              <label className="flex items-start gap-2 text-sm text-content">
                <input
                  type="checkbox"
                  checked={rewriteHistory}
                  onChange={(event) => setRewriteHistory(event.target.checked)}
                  className="mt-1 size-4 accent-primary"
                />
                Also rewrite recorded expenses. Leave this off to change suggestions for new rows
                only.
              </label>
            )}

            <p className="rounded-xl border border-warning bg-surface-raised p-3 text-sm text-content">
              This will move <strong>{movedLedger} manual-ledger rows</strong> and{' '}
              <strong>{movedExpenses} expense rows</strong>. There is no undo in the app.
            </p>
          </form>
        )}
      </FormSheet>

      <ConfirmDialog
        open={retiring !== null}
        title="Retire this category?"
        consequence={
          retiring
            ? `${retiring.name} disappears from suggestions. Its ${retiring.ledgerUsageCount} ledger rows and ${retiring.expenseUsageCount} expense rows keep that text. There is no undo in the app.`
            : ''
        }
        confirmLabel="Retire it"
        onClose={() => setRetiring(null)}
        onConfirm={() => void retire()}
      />
    </div>
  )
}
