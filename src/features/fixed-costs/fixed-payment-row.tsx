import { useNavigate } from 'react-router'

import { RowActionsMenu } from '@/components/layout/row-actions-menu'

import type { FixedMark } from './use-fixed-costs'
import { useExpensesBase } from './use-fixed-tab'

/** Where a fixed-cost payment is changed: its fixed cost's own page. */
function useFixedCostPage(mark: FixedMark): () => void {
  const navigate = useNavigate()
  const base = useExpensesBase()
  return () =>
    void navigate(
      `${base}/ledger/fixed-costs/${mark.fixedCostId}?outlet=${encodeURIComponent(mark.outletId)}`,
    )
}

/**
 * A fixed-cost payment's actions on the Expenses page (owner, 2026-10-19): its
 * note, and its fixed cost's page, where Undo takes back what its answer
 * recorded too. Never Withdraw here, which would leave that behind.
 */
export function FixedPaymentActions({
  mark,
  expenseId,
  label,
  onEditNote,
}: {
  mark: FixedMark
  expenseId: string
  label: string
  onEditNote: () => void
}) {
  const open = useFixedCostPage(mark)
  return (
    <RowActionsMenu
      compact
      align="start"
      label={label}
      actions={[
        { label: 'Edit note', testId: `edit-expense-${expenseId}`, onSelect: onEditNote },
        {
          label: `Change on ${mark.name}'s page`,
          testId: `open-fixed-cost-of-${expenseId}`,
          onSelect: open,
        },
      ]}
    />
  )
}

/** Above the note, while a fixed-cost payment's note is edited. */
export function FixedPaymentNoteHint({ mark }: { mark: FixedMark }) {
  const open = useFixedCostPage(mark)
  return (
    <p className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-content">
      {mark.label}: the amount, the day and how it was paid change by undoing it on {mark.name}
      &rsquo;s page and paying again.{' '}
      <button
        type="button"
        className="font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
        onClick={open}
      >
        Open it
      </button>
    </p>
  )
}
