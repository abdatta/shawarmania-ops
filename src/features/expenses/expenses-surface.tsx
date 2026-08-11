import { Banknote, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { CategoryInput } from '@/components/ui/category-input'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import { DataActionError, type ExpenseRecord, type PaymentMethod } from '@/data-access/adapters'
import {
  formatBusinessDate,
  normalizeCategory,
  resolveBusinessDate,
  rupeesToPaise,
  shiftBusinessDate,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * Expenses — one business day at a time.
 *
 * **Cash rows are marked, and marked in words.** They are the only ones that
 * reach the drawer, so at close somebody has to find them by eye among the UPI
 * and other entries; a colour alone would not survive a bright counter or a
 * colour-blind reader.
 *
 * Four fields and no more. An expense form that asked for a supplier, a bill
 * number and a GST breakup would be filled in wrongly or not at all, and what
 * the cash reconciliation actually needs is the amount and the method.
 *
 * Raw materials appear here like any other category. Whether they are counted
 * against the day they were bought or the stock they became is the P&L
 * double-counting question, and it belongs to `owner-console-live` (#13) —
 * `docs/DATA_MODEL.md` owns it and this screen must not answer it.
 */

/** Said once, on both surfaces the owner's remote path reaches. */
const REMOTE_ENTRY_NOTE =
  'Recording into an outlet you do not run. Only entries that cannot touch its drawer are available, and this will be recorded as yours.'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
]

const METHOD_WORDS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
}

interface Draft {
  category: string
  /** Rupees, as typed. Converted to integer paise at the boundary. */
  amount: string
  paymentMethod: PaymentMethod
  description: string
}

const EMPTY_DRAFT: Draft = {
  category: '',
  amount: '',
  paymentMethod: 'cash',
  description: '',
}

export function ExpensesSurface() {
  const { expenses: adapter, expenseCategories: categoriesAdapter, outlets } = useAdapters()

  // `today` is the anchor the day picker offers a week back from; `businessDate`
  // is which of those days is on screen. Two values rather than one, because
  // deriving the options from the selection would make yesterday's list start at
  // yesterday and quietly lose the way back to today.
  const [today, setToday] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [expenses, setExpenses] = useState<ExpenseRecord[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, managed, selector: outletSelector } = useOutletScope()

  // At an outlet the caller does not run — which is only ever the owner — the
  // form offers what the database will accept and nothing else: a non-cash
  // entry, because `expenses_insert` refuses `cash` from that branch. The
  // policy is the boundary; this is how the bound is read rather than
  // discovered by being refused (multi-outlet-people, design D8).
  const methods = managed ? METHODS : METHODS.filter((method) => method.value !== 'cash')

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
        // The day this screen opens on is resolved through the outlet's cutover,
        // not read off the device: an expense entered at 00:30 belongs to the
        // trading day that is still running.
        const resolved = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        setToday(resolved)
        setBusinessDate(resolved)
      })
      .catch(() => {
        if (active) setError('Could not work out which day this is. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  const load = useCallback(async () => {
    if (!outletId || !businessDate) return
    setExpenses(await adapter.listExpenses(outletId, businessDate))
  }, [adapter, outletId, businessDate])

  useEffect(() => {
    let active = true
    void categoriesAdapter
      .list()
      .then((list) => {
        if (active) setCategories(list.map((category) => category.name))
      })
      .catch(() => {
        if (active) setError('Could not load expense categories. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [categoriesAdapter])

  useEffect(() => {
    if (!outletId || !businessDate) return
    let active = true
    void adapter
      .listExpenses(outletId, businessDate)
      .then((list) => {
        if (active) setExpenses(list)
      })
      .catch(() => {
        if (active) setError('Could not load the day’s expenses. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId, businessDate])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!outletId || !businessDate) return

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
    setError(null)
    try {
      await adapter.createExpense({
        outletId,
        businessDate,
        category,
        amountPaise: rupeesToPaise(rupees),
        paymentMethod: draft.paymentMethod,
        description: draft.description,
      })
      setDraft(EMPTY_DRAFT)
      setFormOpen(false)
      await load()
      setCategories((current) =>
        current.some((name) => name.toLocaleLowerCase() === category.toLocaleLowerCase())
          ? current
          : [...current, category].sort((a, b) => a.localeCompare(b)),
      )
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

  const addButton = (
    <AddButton
      label="Add expense"
      data-testid="add-expense"
      onClick={() => {
        setError(null)
        setDraft(managed ? EMPTY_DRAFT : { ...EMPTY_DRAFT, paymentMethod: 'upi' })
        setFormOpen(true)
      }}
    />
  )

  const total = (expenses ?? []).reduce((running, expense) => running + expense.amountPaise, 0)
  const cashTotal = (expenses ?? [])
    .filter((expense) => expense.paymentMethod === 'cash')
    .reduce((running, expense) => running + expense.amountPaise, 0)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        scope={outletSelector}
        title="Expenses"
        subtitle={
          businessDate
            ? `${formatBusinessDate(businessDate)} — cash entries are marked, because they alone come out of the drawer.`
            : undefined
        }
        action={addButton}
      />

      {businessDate && today && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="expense-day" className="text-xs font-semibold text-content-muted">
            Day
          </label>
          <Select
            id="expense-day"
            className="h-11 w-auto"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
            data-testid="expense-day"
          >
            {Array.from({ length: 7 }, (_, index) => shiftBusinessDate(today, -index)).map(
              (date) => (
                <option key={date} value={date}>
                  {formatBusinessDate(date)}
                </option>
              ),
            )}
          </Select>
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="expenses-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {expenses === null ? (
        // The `space-y-2` list of one-line expense cards, at that card's height.
        <LoadingList
          label="this day’s expenses"
          rows={3}
          blockHeight="h-16"
          className="space-y-2"
          data-testid="expenses-loading"
        />
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nothing recorded for this day yet. Add what the outlet spent — the cash ones will show up on the day’s cash count."
          action={addButton}
        />
      ) : (
        <>
          <ul className="space-y-2" data-testid="expense-list">
            {expenses.map((expense) => (
              <li key={expense.id}>
                <Card
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  data-testid={`expense-${expense.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-content">
                      {expense.category}
                      {expense.paymentMethod === 'cash' ? (
                        <span
                          data-testid={`cash-${expense.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary px-2 py-0.5 text-xs font-semibold text-content"
                        >
                          <Banknote aria-hidden size={12} />
                          Cash
                          {/*
                            The rest of the sentence stays for a reader who cannot
                            see the badge. Visibly it is one word, because on a
                            phone this sits between a category and an amount on one
                            line and the full phrase pushed both onto their own.
                          */}
                          <span className="sr-only"> — from the drawer</span>
                        </span>
                      ) : (
                        <span className="text-xs font-normal text-content-muted">
                          {METHOD_WORDS[expense.paymentMethod]}
                        </span>
                      )}
                    </p>
                    {expense.description && (
                      <p className="truncate text-xs text-content-muted">{expense.description}</p>
                    )}
                  </div>
                  <Money paise={expense.amountPaise} className="text-sm font-semibold" />
                </Card>
              </li>
            ))}
          </ul>

          <Card className="mt-3 space-y-1" data-testid="expense-totals">
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-content-muted">Spent this day</span>
              <Money paise={total} className="font-semibold" />
            </p>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-content-muted">Of which cash</span>
              <Money paise={cashTotal} className="font-semibold" data-testid="expense-cash-total" />
            </p>
            <p className="text-xs text-content-muted">
              Only the cash figure reaches the day&rsquo;s count. A UPI expense is real money, but
              it never came out of this drawer.
            </p>
          </Card>
        </>
      )}

      <FormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add expense"
        error={error}
        footer={
          <button
            type="submit"
            form="expense-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Record expense'}
          </button>
        }
      >
        <form id="expense-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Category" id="expense-category">
            <CategoryInput
              id="expense-category"
              label="Expense category"
              value={draft.category}
              suggestions={categories}
              onChange={(category) => setDraft({ ...draft, category })}
            />
          </Field>

          <Field label="Amount (₹)" id="expense-amount">
            <Input
              id="expense-amount"
              required
              inputMode="decimal"
              value={draft.amount}
              placeholder="e.g. 2400"
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </Field>

          {!managed && (
            <p
              data-testid="remote-entry-note"
              className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted"
            >
              {REMOTE_ENTRY_NOTE}
            </p>
          )}

          <Field label="Paid with" id="expense-method">
            <Select
              id="expense-method"
              value={draft.paymentMethod}
              onChange={(event) =>
                setDraft({ ...draft, paymentMethod: event.target.value as PaymentMethod })
              }
            >
              {methods.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-content-muted">
              Cash comes out of the drawer and shows on the day&rsquo;s count. Nothing else does.
            </p>
          </Field>

          <Field label="Description (optional)" id="expense-description">
            <Input
              id="expense-description"
              value={draft.description}
              placeholder="e.g. Chicken from Nadia Poultry"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
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
