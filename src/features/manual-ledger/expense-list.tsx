import { Banknote, ChevronDown, MapPinOff, Wallet } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { RowActionsMenu } from '@/components/layout/row-actions-menu'
import { AddButton } from '@/components/ui/add-button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { CategoryInput } from '@/components/ui/category-input'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import { DataActionError, type LedgerActor, type ManualLedgerExpense } from '@/data-access/adapters'
import { formatBusinessDate, formatDateTime, normalizeCategory, rupeesToPaise } from '@/domain'

import { Field } from './field'

/**
 * The manual ledger's expense list and its form — **one component, mounted by
 * two surfaces.**
 *
 * This was a region inside `ledger-day.tsx`, which is 1,400 lines built around
 * the day row: the opening-cash chain, the live drawer difference, every figure
 * card. Outlet staff hold no day row at all, so the intuitive shape — the ledger
 * opened to them with revenue and drawer stripped by role — would have meant a
 * role check in front of every figure on that component, each one a place a
 * figure leaks later. Extraction is the honest version of the same instinct:
 * real reuse of the part both readers share, and no role branching in the large
 * file (design D7).
 *
 * **It owns the writing, not the reading.** The parent loads the rows and calls
 * `onChanged` to reload, because the day surface derives its whole drawer
 * reading from the same list and a component that hid the rows inside itself
 * would have to hand them back out again.
 *
 * **Every refusal here is also the database's.** What this hides is what the
 * reader cannot do, so the surface does not offer an act that will fail; the
 * policies and the guard are what actually refuse it.
 */

export interface ExpenseListViewer {
  /** Who is reading. Rows they recorded are the rows they may still fix. */
  id: string
  /**
   * Whether they may correct and withdraw rows somebody else recorded, on any
   * date. True for an owner and for a manager at this outlet; false for staff,
   * whose reach the database narrows to their own rows on the running day.
   */
  mayTouchAnyRow: boolean
}

export interface ExpenseListProps {
  expenses: ManualLedgerExpense[] | null
  outletId: string
  /** What a newly recorded expense is dated. */
  businessDate: string
  /**
   * The outlet's current trading day. Staff may only write against it, so a row
   * from any other date is read-only to them however it was reached.
   */
  currentBusinessDate: string
  viewer: ExpenseListViewer
  /** The staff surface spans two days and has to say which is which. */
  showDates?: boolean
  /**
   * The section heading above the list. Null on a surface whose page title
   * already says "Expenses", where a second one a thumb's width below it is the
   * same word twice for no reader.
   */
  heading?: string | null
  emptyTitle: string
  onChanged: () => Promise<void> | void
}

interface ExpenseDraft {
  category: string
  amount: string
  isCash: boolean
  note: string
}

const BLANK_EXPENSE: ExpenseDraft = { category: '', amount: '', isCash: true, note: '' }

/** "someone" rather than a blank, for a name the reader genuinely cannot resolve. */
function nameOf(actor: LedgerActor | null): string {
  return actor?.name ?? 'someone'
}

export function ExpenseList({
  expenses,
  outletId,
  businessDate,
  currentBusinessDate,
  viewer,
  showDates = false,
  heading = 'Expenses',
  emptyTitle,
  onChanged,
}: ExpenseListProps) {
  const { manualLedger: adapter, expenseCategories: categoriesAdapter } = useAdapters()

  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ManualLedgerExpense | null>(null)
  const [draft, setDraft] = useState<ExpenseDraft>(BLANK_EXPENSE)
  const [withdrawing, setWithdrawing] = useState<ManualLedgerExpense | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function loadCategories() {
    const list = await categoriesAdapter.list()
    setCategories(list.map((category) => category.name))
  }

  /**
   * May this reader still change this row?
   *
   * The same two limits the guard enforces, so the buttons match the answers.
   * A withdrawn row is final for everybody, including the owner: a correction
   * after withdrawal is a new expense.
   */
  function mayChange(expense: ManualLedgerExpense): boolean {
    if (expense.voidedAt !== null) return false
    if (viewer.mayTouchAnyRow) return true
    return expense.recordedBy.id === viewer.id && expense.businessDate === currentBusinessDate
  }

  /** Whether this list holds a kebab at all — see where the slot is rendered. */
  const anyChangeable = expenses?.some(mayChange) ?? false

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const rupees = Number(draft.amount.trim())
    if (draft.amount.trim() === '' || !Number.isFinite(rupees) || rupees <= 0) {
      setError('An expense needs an amount above zero, as a number of rupees.')
      return
    }
    const category = normalizeCategory(draft.category)
    if (!category) {
      setError('Choose or type what the money was spent on.')
      return
    }

    setBusy(true)
    try {
      if (editing) {
        await adapter.updateExpense(editing.id, {
          category,
          isCash: draft.isCash,
          amountPaise: rupeesToPaise(rupees),
          note: draft.note,
        })
      } else {
        await adapter.createExpense({
          outletId,
          businessDate,
          category,
          isCash: draft.isCash,
          amountPaise: rupeesToPaise(rupees),
          note: draft.note,
        })
      }
      setOpen(false)
      setEditing(null)
      setDraft(BLANK_EXPENSE)
      await Promise.all([onChanged(), loadCategories()])
    } catch (cause) {
      // Nothing is cleared. A failed submit with no connection keeps every field
      // as typed so one tap retries, which is the whole offline story until the
      // outbox lands with #9.
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not save. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {heading === null ? (
          <span />
        ) : (
          <h2 className="text-sm font-bold text-content">{heading}</h2>
        )}
        <AddButton
          label="Add expense"
          data-testid="add-ledger-expense"
          onClick={() => {
            setError(null)
            setEditing(null)
            setDraft(BLANK_EXPENSE)
            void loadCategories()
            setOpen(true)
          }}
        />
      </div>

      {expenses === null ? (
        <LoadingList
          label="expenses"
          rows={3}
          blockHeight="h-16"
          className="space-y-2"
          data-testid="ledger-expenses-loading"
        />
      ) : expenses.length === 0 ? (
        // No action here: the Add button sits directly above this box, so a second
        // one would be the same door twice, a hand's width apart.
        <EmptyState icon={Wallet} title={emptyTitle} />
      ) : (
        <ul className="space-y-2" data-testid="ledger-expense-list">
          {expenses.map((expense) => {
            const withdrawn = expense.voidedAt !== null
            const isOpen = expanded === expense.id
            const panelId = `ledger-expense-detail-${expense.id}`
            const changeable = mayChange(expense)
            return (
              <li key={expense.id}>
                <Card
                  className={
                    // A withdrawn row reads as **withdrawn card**, not as struck
                    // text on a live one. Three signals rather than one, because
                    // a strikethrough alone is a hairline on a phone in daylight
                    // and colour alone is a signal not every reader receives:
                    // the surface recedes, the border goes dashed and the shadow
                    // that lifts a live card off the page goes away. Nothing
                    // here relies on opacity — dimming already-muted text is how
                    // a row stops meeting contrast while still being the thing
                    // somebody is trying to read.
                    withdrawn
                      ? 'space-y-1.5 p-3 border-dashed bg-surface-raised/40 shadow-none'
                      : 'space-y-1.5 p-3'
                  }
                  data-testid={`ledger-expense-${expense.id}`}
                  data-withdrawn={withdrawn ? 'true' : undefined}
                >
                  {/*
                    **The whole card is the disclosure**, the way an attendance
                    card's header is — chevron included, but the chevron is only
                    the indicator of which way it is facing, not the target. A
                    dedicated 44px chevron button costs a control on every row
                    for a tap the row itself could take (design D8: an expandable
                    card, because the detail is more than a tooltip holds and a
                    tooltip is a hover idiom on a thumb surface).

                    `role="button"` on a div rather than a real `<button>`,
                    because the kebab is a control that lives *inside* this
                    region and a button may not nest one. The keyboard contract
                    is written out by hand for the same reason, and the menu
                    stops its own clicks from reaching the row.
                  */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    data-testid={`expand-expense-${expense.id}`}
                    onClick={() => setExpanded(isOpen ? null : expense.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setExpanded(isOpen ? null : expense.id)
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded text-left focus-visible:focus-ring"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-x-2">
                      <span className="min-w-0 flex-1">
                        {withdrawn ? (
                          /*
                            **A withdrawn row keeps its name and loses the rest.**
                            One line, struck through: the note, the badges and the
                            attribution are history, and printing them at full
                            height beside live expenses makes the list longer
                            exactly where it is least worth reading. Half the
                            height is itself the signal — the eye skips the row
                            without having to parse it — but the category is what
                            makes it skippable rather than merely short, because
                            "Withdrawn" alone is a row you have to open to know
                            whether it is the one you were looking for.
                          */
                          <span
                            className="text-sm font-semibold text-content-muted line-through decoration-2"
                            data-testid={`ledger-withdrawn-${expense.id}`}
                          >
                            {expense.category}
                            <span className="sr-only"> — withdrawn, counting toward nothing</span>
                          </span>
                        ) : (
                          <>
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-content">
                              {expense.category}
                              {expense.isCash ? (
                                <span
                                  data-testid={`ledger-cash-${expense.id}`}
                                  className="inline-flex items-center gap-1 rounded-lg border border-primary px-2 py-0.5 text-xs font-semibold text-content"
                                >
                                  <Banknote aria-hidden size={12} />
                                  Cash
                                  {/*
                                    The rest of the sentence, for a reader who cannot see
                                    the note. On a phone the badge sits between a category
                                    and an amount on one line, and "Cash — from the drawer"
                                    pushed both of those onto lines of their own.
                                  */}
                                  <span className="sr-only"> — from the drawer</span>
                                </span>
                              ) : (
                                <span className="text-xs font-normal text-content-muted">
                                  Not cash
                                </span>
                              )}
                              {/*
                                **The vocabulary attendance already uses**, not a
                                new one: `MapPinOff` and "not on site" are what an
                                approval given away from the outlet says, so the
                                same fact reads the same way wherever somebody
                                meets it.

                                Shown **only on a drawer expense**. The live
                                expenses surface marks every remote owner entry,
                                but it can afford to: that path refuses remote
                                cash outright, so its remote rows cannot move a
                                drawer. This notebook has no such refusal, so the
                                marker earns its place exactly where expected cash
                                moved without anybody at the outlet spending it
                                (design D9).
                              */}
                              {expense.recordedAway && expense.isCash && (
                                <span
                                  data-testid={`ledger-away-${expense.id}`}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs font-semibold text-content-muted"
                                >
                                  <MapPinOff aria-hidden size={11} />
                                  <span className="sr-only">Recorded: </span>
                                  not on site
                                </span>
                              )}
                            </span>
                            {/*
                              **What the row is about, not who typed it.** The
                              recorder moved behind the chevron: it settles an
                              argument once a month and cost a line of small print
                              on every row every day. The note stays, because it is
                              the only thing here the category does not already
                              say.
                            */}
                            {(expense.note || showDates) && (
                              <span className="mt-0.5 block text-xs text-content-muted">
                                {expense.note}
                                {expense.note && showDates && ' · '}
                                {showDates && (
                                  <span data-testid={`ledger-expense-date-${expense.id}`}>
                                    {formatBusinessDate(expense.businessDate)}
                                  </span>
                                )}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    {/*
                      **Reserved per list, not per row.** Where any row offers a
                      menu the slot is held on all of them, so the amounts beside
                      it stay one column rather than stepping left on the
                      withdrawn rows and the ones somebody else recorded. Where no
                      row offers one — a staff reader looking at a colleague's day
                      — the slot is not rendered at all, because a column of
                      nothing on every row is what made this list feel padded.
                    */}
                    <div
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      className={
                        anyChangeable ? 'order-first flex w-8 shrink-0 justify-center' : 'hidden'
                      }
                    >
                      {changeable && (
                        <RowActionsMenu
                          compact
                          align="start"
                          label={`Actions for ${expense.category}`}
                          actions={[
                            {
                              label: 'Edit',
                              testId: `edit-expense-${expense.id}`,
                              onSelect: () => {
                                setError(null)
                                setEditing(expense)
                                setDraft({
                                  category: expense.category,
                                  amount: String(expense.amountPaise / 100),
                                  isCash: expense.isCash,
                                  note: expense.note ?? '',
                                })
                                void loadCategories()
                                setOpen(true)
                              },
                            },
                            {
                              label: 'Withdraw',
                              testId: `withdraw-expense-${expense.id}`,
                              onSelect: () => {
                                setError(null)
                                setWithdrawing(expense)
                              },
                            },
                          ]}
                        />
                      )}
                    </div>
                    {/*
                      **A column, not a trailing figure.** The amounts sit at
                      one horizontal position down the whole list, wide enough
                      for a five-figure rupee sum, so somebody totalling the
                      day by eye reads a column instead of hunting each number
                      across a different indent.
                    */}
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Money
                        paise={expense.amountPaise}
                        className={`min-w-[5.5rem] text-right text-base font-semibold ${
                          withdrawn ? 'text-content-muted line-through decoration-2' : ''
                        }`}
                      />
                      <ChevronDown
                        aria-hidden
                        size={14}
                        className={`shrink-0 text-content-muted transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </div>

                  {isOpen && (
                    <dl
                      id={panelId}
                      className="space-y-1 border-t border-border pt-2 text-xs text-content-muted"
                      data-testid={`ledger-expense-detail-${expense.id}`}
                    >
                      {/*
                        Only what the row above stopped saying. A live row carries
                        its note and its badges in full; a withdrawn one is down to
                        its name, so the rest waits here.
                      */}
                      {withdrawn && (
                        <>
                          <div className="flex justify-between gap-3">
                            <dt>Paid with</dt>
                            <dd className="text-right">
                              {expense.isCash ? 'Cash, out of the drawer' : 'Not cash'}
                            </dd>
                          </div>
                          {expense.note && (
                            <div className="flex justify-between gap-3">
                              <dt>Note</dt>
                              <dd className="text-right">{expense.note}</dd>
                            </div>
                          )}
                          {showDates && (
                            <div className="flex justify-between gap-3">
                              <dt>Day</dt>
                              <dd
                                className="text-right"
                                data-testid={`ledger-expense-date-${expense.id}`}
                              >
                                {formatBusinessDate(expense.businessDate)}
                              </dd>
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex justify-between gap-3">
                        <dt>Recorded</dt>
                        <dd className="text-right" data-testid={`ledger-recorder-${expense.id}`}>
                          {nameOf(expense.recordedBy)}, {formatDateTime(expense.createdAt)}
                        </dd>
                      </div>
                      {/*
                        Not on a withdrawn row. Withdrawing is itself an update,
                        so the guard stamps the correcting account as it does for
                        any other — and since a withdrawn row can never be
                        corrected afterwards, that account is always the one that
                        withdrew it. Printing both lines reports one act twice,
                        a minute apart, as though two things had happened.
                      */}
                      {expense.updatedBy && !withdrawn && (
                        <div className="flex justify-between gap-3">
                          <dt>Last corrected</dt>
                          <dd className="text-right">
                            {nameOf(expense.updatedBy)}, {formatDateTime(expense.updatedAt)}
                          </dd>
                        </div>
                      )}
                      {expense.voidedAt && (
                        <div className="flex justify-between gap-3">
                          <dt>Withdrawn</dt>
                          <dd className="text-right">
                            {nameOf(expense.voidedBy)}, {formatDateTime(expense.voidedAt)}
                          </dd>
                        </div>
                      )}
                      {/*
                        Only where one was given. A reason is optional
                        [owner, 2026-08-09], and an empty "Reason —" row would
                        read as a field somebody failed to fill rather than one
                        nobody was asked for.
                      */}
                      {expense.voidedReason && (
                        <div className="flex justify-between gap-3">
                          <dt>Because</dt>
                          <dd className="text-right">{expense.voidedReason}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <FormSheet
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(null)
        }}
        title={editing ? 'Edit expense' : 'Add expense'}
        error={error}
        footer={
          <button
            type="submit"
            form="ledger-expense-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : editing ? 'Save expense' : 'Record expense'}
          </button>
        }
      >
        <form id="ledger-expense-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Category" id="expense-category">
            <CategoryInput
              id="expense-category"
              label="Expense category"
              value={draft.category}
              suggestions={categories}
              testId="expense-category"
              onChange={(category) => setDraft({ ...draft, category })}
            />
          </Field>

          <Field label="Note (optional)" id="expense-description">
            <Input
              id="expense-description"
              value={draft.note}
              placeholder="e.g. 10 kg from Nadia Poultry"
              data-testid="expense-description"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </Field>

          <Field label="Amount (₹)" id="expense-amount">
            <Input
              id="expense-amount"
              required
              inputMode="decimal"
              value={draft.amount}
              placeholder="e.g. 2400"
              data-testid="expense-amount"
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </Field>

          <Field label="Paid with" id="expense-is-cash">
            <Select
              id="expense-is-cash"
              value={draft.isCash ? 'cash' : 'other'}
              data-testid="expense-is-cash"
              onChange={(event) => setDraft({ ...draft, isCash: event.target.value === 'cash' })}
            >
              <option value="cash">Cash, out of the drawer</option>
              <option value="other">Anything else — UPI, card, transfer</option>
            </Select>
            <p className="text-xs text-content-muted">
              Only cash reaches the day&rsquo;s count. Everything else is still an expense.
            </p>
          </Field>
        </form>
      </FormSheet>

      {/*
        The copy this replaces read "Nothing records that it was ever here",
        which was true of a delete and is the opposite of what happens now. And
        no reason is asked for: it is optional [owner, 2026-08-09], so a dialog
        demanding one would be asking for something the database does not want.
      */}
      <ConfirmDialog
        open={withdrawing !== null}
        title="Withdraw this expense?"
        consequence={
          withdrawing
            ? `“${withdrawing.category}” stops counting toward this day and the month. It stays on the list, struck through, showing that you withdrew it.`
            : ''
        }
        confirmLabel="Withdraw it"
        onClose={() => setWithdrawing(null)}
        onConfirm={() => {
          const target = withdrawing
          setWithdrawing(null)
          if (!target) return
          setBusy(true)
          void adapter
            .voidExpense(target.id)
            .then(() => onChanged())
            .catch((cause: unknown) => {
              setError(
                cause instanceof DataActionError
                  ? cause.message
                  : 'That did not work. Try again in a moment.',
              )
            })
            .finally(() => setBusy(false))
        }}
      />
    </div>
  )
}
