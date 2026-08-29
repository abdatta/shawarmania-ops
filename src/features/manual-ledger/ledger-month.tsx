import { NotepadText, Settings2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { AsOfChip } from '@/components/ui/as-of-chip'
import { Card } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button-variants'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import { formatBusinessDate, PROFIT_BASIS_LABELS } from '@/domain'

import { cn } from '@/lib/cn'

import { readMonth, type MonthReading } from './ledger'

/**
 * The month, for one outlet (#36) — **temporary, deleted with the capability.**
 *
 * One outlet at a time, through the switcher every other outlet-scoped surface
 * uses. Comparing the two shops side by side is genuinely more useful at month
 * end and is deliberately not here: it belongs to the owner console (#13), and a
 * small version of it inside a surface designed to be deleted would leave two
 * screens answering one question, one of them the throwaway (design D9).
 *
 * Three things this screen has to say out loud, because a figure that does not say
 * them is misread:
 *
 *  - **the aggregators are netted per day**, from each day's own stored rate, so a
 *    rate renegotiated mid-month is right on both sides of the change;
 *  - **the profit is cash basis**, as `profit-estimates` requires of any profit
 *    figure in this app;
 *  - **it is an operating figure**, because this ledger records no equipment at
 *    all. It answers whether trading covered running costs, not where every rupee
 *    went.
 */
export function LedgerMonth({ outletId, month }: { outletId: string; month: string }) {
  const { manualLedger: adapter } = useAdapters()

  const [reading, setReading] = useState<MonthReading | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Loads once per mount; the parent remounts on an outlet or month change, so no
  // reset is needed here. See the `key` in `manual-ledger-surface.tsx`.
  useEffect(() => {
    let active = true

    void adapter
      .getMonth(outletId, month)
      .then((data) => {
        if (active) setReading(readMonth(data.days, data.expenses))
      })
      .catch(() => {
        if (active) setError('Could not load the month. Try again in a moment.')
      })

    return () => {
      active = false
    }
  }, [adapter, outletId, month])

  if (error) {
    return (
      <p
        role="alert"
        data-testid="ledger-month-error"
        className="text-sm font-semibold text-danger"
      >
        {error}
      </p>
    )
  }

  if (reading === null) {
    // Three cards land: revenue, expenses, and the profit estimate.
    return (
      <LoadingFigures
        label="this month’s figures"
        rows={[7, 6, 4]}
        data-testid="ledger-month-loading"
      />
    )
  }

  // An unrecorded month is not a month that earned nothing. Showing zero for both
  // would be reporting a measurement nobody took.
  if (!reading.recorded) {
    return (
      <EmptyState
        icon={NotepadText}
        title="Nothing is recorded for this month at this outlet yet. Record a day and the month’s figures build themselves from it."
        action={undefined}
      />
    )
  }

  /*
   * Whether any day in this month is still waiting for its commission.
   *
   * Read once and used for every label below, so the heading, the two channel rows,
   * the revenue total and the profit figure cannot disagree about whether they are
   * showing a ceiling. Three screens quietly stating different confidences about
   * the same month is exactly the drift this is written once to prevent.
   */
  const pending = reading.undeterminedDays > 0

  return (
    <div className="space-y-3">
      <Card className="space-y-2" data-testid="month-revenue">
        {/*
          The same words the day view uses for the same rows. It was "What came in,
          over 2 days" — which read as a sentence rather than a heading, and named
          the section differently from the card a tap away that shows one day of it.
          The count is a fact about the month, not part of its name.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h2 className="text-sm font-bold text-content">Sales breakdown</h2>
          <p className="text-xs text-content-muted" data-testid="month-days-recorded">
            {reading.daysRecorded === 1
              ? '1 day recorded'
              : `${reading.daysRecorded} days recorded`}
          </p>
        </div>
        <Row label="Cash" paise={reading.grossCashPaise} testId="month-cash" />
        <Row label="UPI" paise={reading.grossUpiPaise} testId="month-upi" />

        <div className="border-t border-border pt-2">
          <Row
            label="Zomato, as stated"
            paise={reading.grossZomatoPaise}
            testId="month-zomato-gross"
            tag={<AsOfChip at={reading.zomatoAsOfAt} testId="month-zomato-as-of" />}
          />
          <Row
            label={pending ? 'Less Zomato commission, so far' : 'Less Zomato commission'}
            paise={-reading.zomatoCommissionPaise}
            testId="month-zomato-commission"
          />
          <Row
            label={pending ? 'Zomato, received at most' : 'Zomato, actually received'}
            paise={reading.netZomatoPaise}
            testId="month-zomato-net"
            bold
          />
        </div>

        <div className="border-t border-border pt-2">
          <Row
            label="Swiggy, as stated"
            paise={reading.grossSwiggyPaise}
            testId="month-swiggy-gross"
            tag={<AsOfChip at={reading.swiggyAsOfAt} testId="month-swiggy-as-of" />}
          />
          <Row
            label={pending ? 'Less Swiggy commission, so far' : 'Less Swiggy commission'}
            paise={-reading.swiggyCommissionPaise}
            testId="month-swiggy-commission"
          />
          <Row
            label={pending ? 'Swiggy, received at most' : 'Swiggy, actually received'}
            paise={reading.netSwiggyPaise}
            testId="month-swiggy-net"
            bold
          />
        </div>

        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-bold text-content">
            {pending ? 'Revenue received, at most' : 'Revenue actually received'}
          </span>
          <Money
            paise={reading.netRevenuePaise}
            className="font-bold"
            data-testid="month-revenue-net"
          />
        </div>
        <p className="text-xs text-content-muted">
          Each aggregator day is reduced by the commission charged on that day, and the results
          added up. A day charged differently therefore affects only itself.
        </p>
        {pending && (
          /*
           * The sentence that makes every figure above honest.
           *
           * A ceiling shown without it is an approximation presented as a fact,
           * which is the failure this whole capability exists to remove. It names
           * the count and the reason the wait ends, so the reader knows both how
           * much is still moving and that it will stop.
           */
          <p className="text-xs text-content" data-testid="month-undetermined">
            <strong>
              {reading.undeterminedDays === 1
                ? '1 day is still waiting for its commission'
                : `${reading.undeterminedDays} days are still waiting for their commission`}
              .
            </strong>{' '}
            Zomato only states what it kept once a week closes, so these figures are the most that
            can have arrived. They settle by themselves.
          </p>
        )}
      </Card>

      <Card className="space-y-2" data-testid="month-expenses">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-content">Expenses breakdown</h2>
          {/*
            `../categories` rather than `categories`: #11 moved this surface from
            `ledger` to `ledger/notebook`, so a link relative to the current route
            would now resolve to `ledger/notebook/categories`. The categories
            screen stayed where it was, at `ledger/categories`, beside this one.
          */}
          <Link
            to="../categories"
            // `relative="path"` is load-bearing. Without it React Router resolves
            // `..` against the ROUTE hierarchy, and this surface's route is the
            // single pattern `ledger/notebook`, so `..` pops both segments and
            // lands on `/demo/:role/categories`, which resolves to nothing. With
            // it, `..` pops one URL segment and gives `ledger/categories`.
            relative="path"
            className={buttonVariants({ variant: 'secondary', size: 'phone' })}
          >
            <Settings2 aria-hidden size={15} />
            Manage categories
          </Link>
        </div>
        {reading.expensesByCategory.length === 0 ? (
          <p className="text-sm text-content-muted">
            No expenses recorded this month. Cash withdrawn from the drawer is not an expense and is
            not counted here.
          </p>
        ) : (
          <>
            {reading.expensesByCategory.map((total) => (
              <div key={total.category} data-testid={`month-category-${total.category}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-content">{total.category}</span>
                  <Money paise={total.amountPaise} className="text-sm font-semibold" />
                </div>
                {/*
                  Every row behind the total. The category identifies the cost;
                  an optional note adds detail such as quantity.
                */}
                <ul className="mt-0.5 space-y-0.5">
                  {total.lines.map((line, index) => (
                    <li
                      key={`${line.businessDate}-${index}`}
                      className="flex items-baseline justify-between gap-2 text-xs text-content-muted"
                    >
                      <span className="min-w-0">
                        {formatBusinessDate(line.businessDate)}
                        {line.note ? ` — ${line.note}` : ''}
                        {line.isCash ? '' : ' (not cash)'}
                      </span>
                      <Money paise={line.amountPaise} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-bold text-content">Everything spent</span>
              <Money
                paise={reading.totalExpensesPaise}
                className="font-bold"
                data-testid="month-expenses-total"
              />
            </div>
            <Row
              label="Of which came out of the drawer"
              paise={reading.cashExpensesPaise}
              testId="month-expenses-cash"
            />
            <p className="text-xs text-content-muted">
              Aggregator commission is not here: it is already taken off the revenue above, and
              counting it twice would understate the month.
            </p>
          </>
        )}
      </Card>

      <Card className="space-y-2" data-testid="month-profit">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-content">
            {pending ? 'Estimated profit, at most' : 'Estimated profit'}
          </span>
          <Money paise={reading.profit.profitPaise} display data-testid="month-profit-figure" />
        </div>
        {/*
          The basis, in words, beside the figure — required of every profit figure
          in this app by `profit-estimates`, because cash basis and consumption
          basis answer different questions and a blend of them is always wrong.
        */}
        <p className="text-sm font-semibold text-content" data-testid="month-profit-basis">
          {PROFIT_BASIS_LABELS.cash} operating estimate
        </p>
        <p className="text-xs text-content-muted">
          Revenue actually received, less everything recorded as spent. It answers whether this
          month&rsquo;s trading covered its running costs.
        </p>
        <p className="text-xs text-content-muted">
          <strong>An operating figure, not a full account of money out.</strong> Equipment and
          anything else outliving the month is deliberately not recorded in this ledger, so nothing
          here accounts for it. Where such a purchase came out of the drawer it is recorded as cash
          withdrawn, which keeps that day&rsquo;s count honest without entering this figure.
        </p>
        <p className="text-xs text-content-muted">
          Stock is not valued here either, so there is no consumption-basis figure to offer.
        </p>
      </Card>
    </div>
  )
}

function Row({
  label,
  paise: amount,
  testId,
  bold = false,
  tag,
}: {
  label: string
  paise: number
  testId: string
  bold?: boolean
  /** A small chip beside the label, on the day view's terms. */
  tag?: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span
        className={cn(
          'inline-flex flex-wrap items-baseline gap-1.5',
          bold ? 'text-sm font-semibold text-content' : 'text-sm text-content-muted',
        )}
      >
        {label}
        {tag}
      </span>
      <Money paise={amount} data-testid={testId} className={bold ? 'font-semibold' : undefined} />
    </div>
  )
}
