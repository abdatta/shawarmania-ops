import { CalendarClock, CheckCircle2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { AttentionField } from '@/components/ui/attention-field'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { LoadingRegion, LoadingTable, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useFieldAttention } from '@/components/ui/use-field-attention'
import { useAdapters } from '@/data-access'
import type { FixedCostsReading } from '@/data-access/fixed-costs'
import { formatPaise } from '@/domain'
import {
  activeDays,
  addMonths,
  balance,
  coverage,
  daysInMonth,
  FIXED_COST_CATEGORIES,
  FIXED_COST_CATEGORY_LABEL,
  isProrated,
  monthCost,
  monthOf,
  settlementFor,
  paymentUndo,
  dailySpreadPaise,
  thisMonthStatus,
  type FixedCostPayment,
  type ThisMonthStatus,
  type FixedCostCategory,
  type FixedCostFacts,
} from '@/domain/fixed-costs'
import { attentionChanged } from '@/features/attention/attention'
import { Field } from '@/features/expenses/field'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

import { messageOf, parseAmount } from './amounts'
import { ExpenseTabs } from './expense-tabs'
import { PaySheet } from './pay-sheet'
import { useExpensesBase } from './use-fixed-tab'
import { monthName, monthWords, shortDate, shortMonths } from './words'

/**
 * An outlet's fixed costs (fixed-costs-are-spread-over-the-month, design D9).
 *
 * A list like Team: one row per fixed cost, its category under its name, this
 * month's cost, and its balance in words, the whole row opening its own page.
 * Every figure is folded from the one read by `src/domain/fixed-costs.ts`, which
 * is also what the Ledger and Overview fold from, so no two screens disagree
 * about what a month cost or what is still owed.
 *
 * Owner and manager only, as the policies are. Salaries are typed names, never
 * accounts (owner, 2026-10-19).
 */
/**
 * How long a tapped row stays lit before its Pay sheet or its page opens
 * (owner, 2026-10-21). A tap is over in a tenth of a second and the sheet
 * covers the list at once on a phone, so the highlight was never seen. 300 ms
 * felt long on the phone (owner); 100 ms holds the tint just past the tap.
 */
export const PRESS_PAUSE_MS = 100

/** A row lit by a tap: on its Pay, or on the row to open its page. */
interface Lit {
  id: string
  pay: boolean
}

/** The row just tapped, lit for {@link PRESS_PAUSE_MS}, then what the tap does. */
function usePressPause() {
  const [pressed, setPressed] = useState<Lit | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  // A second tap inside the pause is the same tap, not another row's.
  const hold = useCallback((lit: Lit, then: () => void) => {
    if (timer.current !== null) return
    setPressed(lit)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setPressed(null)
      then()
    }, PRESS_PAUSE_MS)
  }, [])
  return { pressed, hold }
}

export function FixedCostsSurface() {
  const { fixedCosts } = useAdapters()
  const { outletId, selector } = useOutletScope()
  const [reading, setReading] = useState<{ key: string; value: FixedCostsReading } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [reads, setReads] = useState(0)
  // Pay from the row (owner, 2026-10-19): a salary day is ten payments in a
  // row, and opening each person first is a detour.
  const [paying, setPaying] = useState<FixedCostFacts | null>(null)
  const press = usePressPause()
  const navigate = useNavigate()
  const pay = (cost: FixedCostFacts) =>
    press.hold({ id: cost.id, pay: true }, () => setPaying(cost))
  const open = (cost: FixedCostFacts) =>
    press.hold({ id: cost.id, pay: false }, () => void navigate(cost.id, { relative: 'path' }))
  const lit: Lit | null = paying ? { id: paying.id, pay: true } : press.pressed
  const [recorded, setRecorded] = useState<{ name: string; countsIn: string } | null>(null)

  useEffect(() => {
    if (!outletId) return
    let active = true
    void fixedCosts
      .list(outletId)
      .then((value) => {
        if (active) setReading({ key: outletId, value })
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause, 'Could not load fixed costs. Try again in a moment.'))
      })
    return () => {
      active = false
    }
  }, [fixedCosts, outletId, reads])

  const current = reading?.key === outletId ? reading.value : null
  const month = current ? monthOf(current.today) : null
  const ongoing =
    current?.costs
      .filter((c) => !c.stopsOn || c.stopsOn >= current.today)
      // Overdue first (owner, 2026-10-20): the rows money is late on lead the
      // list, and keep their order among themselves.
      .sort(
        (a, b) =>
          Number(thisMonthStatus(b, current.today).overdue.length > 0) -
          Number(thisMonthStatus(a, current.today).overdue.length > 0),
      ) ?? []
  const stopped = current?.costs.filter((c) => c.stopsOn && c.stopsOn < current.today) ?? []
  // This month on its own (owner, 2026-10-19: "make it clear from the label
  // itself"). Overdue money is said on its own row, highlighted at the top of
  // the list, not again in a line above it (owner, 2026-10-20).
  const totals = useMemo(() => {
    if (!current) return null
    let totalPaise = 0
    let leftPaise = 0
    for (const cost of current.costs) {
      const status = thisMonthStatus(cost, current.today)
      totalPaise += status.costPaise
      leftPaise += status.leftPaise
    }
    // Paid is This month less Left to pay, and each row says it, so its tile
    // gave way to what the month costs a day (owner, 2026-10-21).
    const perDayPaise = dailySpreadPaise(current.costs, current.today)
    return { totalPaise, leftPaise, perDayPaise: perDayPaise - (perDayPaise % 100) }
  }, [current])

  return (
    <div className="mx-auto max-w-2xl">
      {/* The Fixed tab of the one Expenses entry (owner, 2026-10-19). */}
      <PageHeader
        title="Expenses"
        scope={selector}
        action={<AddButton label="Add a fixed cost" onClick={() => setAdding(true)} />}
      />
      <ExpenseTabs current="fixed" />
      {recorded && outletId && (
        <Recorded countsIn={recorded.countsIn} outletId={outletId} name={recorded.name} />
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {current === null || month === null ? (
        error ? null : (
          <LoadingRegion
            label="fixed costs"
            className="space-y-3"
            data-testid="fixed-costs-loading"
          >
            <div className="grid grid-cols-2 gap-2">
              <Shimmer className="h-14" />
              <Shimmer className="h-14" />
            </div>
            <LoadingTable label="fixed costs" rows={4} rowHeight="h-14" />
          </LoadingRegion>
        )
      ) : (
        <div className="space-y-4">
          {totals && current.costs.length > 0 && (
            <div>
              <dl className="grid grid-cols-3 gap-2" data-testid="fixed-costs-totals">
                <Tile caption="This month">
                  <Money paise={totals.totalPaise} />
                </Tile>
                <Tile caption="Left to pay">
                  <Money paise={totals.leftPaise} />
                </Tile>
                {/* Whole rupees: a day's share is an estimate, not a sum paid. */}
                <Tile caption="Per day">
                  <Money paise={totals.perDayPaise} />
                </Tile>
              </dl>
            </div>
          )}
          <div data-testid="fixed-cost-list">
            <CostTable
              costs={ongoing}
              today={current.today}
              lit={lit}
              onPay={pay}
              onOpen={open}
              empty={
                <EmptyState
                  icon={CalendarClock}
                  title="No fixed costs yet. Add each salary, the rent and the bills that come every month."
                />
              }
            />
          </div>
          {stopped.length > 0 && (
            <Section id="stopped-fixed-costs" title="Stopped">
              <CostTable
                costs={stopped}
                today={current.today}
                lit={lit}
                onPay={pay}
                onOpen={open}
              />
            </Section>
          )}
        </div>
      )}

      {current && paying && (
        <PaySheet
          open
          cost={paying}
          today={current.today}
          onClose={() => setPaying(null)}
          onPaid={(countsIn) => {
            setRecorded({ name: paying.name, countsIn })
            setPaying(null)
            setReads((n) => n + 1)
            attentionChanged()
          }}
        />
      )}

      {outletId && current && adding && (
        <AddSheet
          open={adding}
          outletId={outletId}
          today={current.today}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            setReads((n) => n + 1)
            attentionChanged()
          }}
        />
      )}
    </div>
  )
}

function CostTable({
  costs,
  today,
  lit = null,
  onPay,
  onOpen,
  empty,
}: {
  costs: FixedCostFacts[]
  today: string
  /** The row just tapped, or whose Pay sheet is open; its Pay too, if that was tapped. */
  lit?: Lit | null
  onPay: (cost: FixedCostFacts) => void
  onOpen: (cost: FixedCostFacts) => void
  empty?: ReactNode
}) {
  const month = monthOf(today)
  const columns: DataTableColumn<FixedCostFacts>[] = [
    {
      id: 'name',
      // No arrow column: Pay sits at the row's end, and the row itself still
      // opens the fixed cost's page (owner, 2026-10-19).
      header: 'Fixed cost',
      cell: (cost) => (
        <Link
          to={cost.id}
          relative="path"
          data-testid={`open-fixed-cost-${cost.id}`}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
            event.preventDefault()
            onOpen(cost)
          }}
          className="block py-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:focus-ring"
        >
          <span className="block font-semibold text-content">{cost.name}</span>
          <span className="block text-xs text-content-muted">
            {FIXED_COST_CATEGORY_LABEL[cost.category]}
            {isProrated(cost, month) && ` · ${activeDays(cost, month).count} days`}
          </span>
        </Link>
      ),
    },
    {
      // One column for this month (owner, 2026-10-19): what is paid of what it
      // costs, a bar for the same at a glance, and overdue or paid-ahead money on
      // its own line beneath, never inside this month's bar.
      id: 'month',
      header: 'This month',
      cell: (cost) => (
        <MonthProgress
          status={thisMonthStatus(cost, today)}
          testId={`status-${cost.id}`}
          ringTestId={`paid-ring-${cost.id}`}
        />
      ),
    },
    {
      id: 'pay',
      header: <span className="sr-only">Pay</span>,
      align: 'right',
      shrink: true,
      cell: (cost) => {
        const status = thisMonthStatus(cost, today)
        const owes = status.leftPaise > 0 || status.overdue.length > 0
        // Above the row's own link, so the tap pays rather than opens.
        return status.active || owes ? (
          <button
            type="button"
            onClick={() => onPay(cost)}
            aria-label={`Pay ${cost.name}`}
            data-testid={`pay-row-${cost.id}`}
            // A small pill in the app's own button fills: filled primary orange
            // only where a month is overdue, the secondary fill everywhere else
            // (owner, 2026-10-20), so a filled Pay means "this one is late" and
            // the row the alert is about is the one that stands out. The hit area
            // reaches past the pill so it is a thumb's width. `relative` with no
            // z-index: above its own row's link (later in the page), and under the
            // phone's bottom bar, which comes later still.
            className={cn(
              'relative inline-flex h-8 items-center rounded-full px-3.5 text-xs font-semibold',
              "before:absolute before:-inset-2 before:content-[''] focus-visible:focus-ring",
              status.overdue.length > 0
                ? 'bg-primary text-on-primary hover:brightness-95'
                : 'border border-border bg-surface text-content hover:bg-surface-raised',
              // Which Pay the thumb landed on, said by the pill itself (owner,
              // 2026-10-21): the pills sit close on a phone, and a sheet's title
              // is not always read. Its own border turns orange, at its own
              // thickness, over a light tint; a filled Pay deepens a shade. The
              // moment it is pressed, and for as long as its sheet is open.
              status.overdue.length > 0
                ? 'active:brightness-90'
                : 'active:border-primary active:bg-primary/10 active:text-accent-text',
              lit?.id === cost.id &&
                lit.pay &&
                (status.overdue.length > 0
                  ? 'brightness-90'
                  : 'border-primary bg-primary/10 text-accent-text'),
            )}
            data-selected={lit?.id === cost.id && lit.pay ? 'true' : undefined}
          >
            Pay
          </button>
        ) : null
      },
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={costs}
      rowKey={(cost) => cost.id}
      rowClassName={(cost) =>
        cn(
          'relative',
          // The row an alert is about stands out in the app's own orange tint
          // (owner, 2026-10-20), without a colour of its own.
          thisMonthStatus(cost, today).overdue.length > 0
            ? 'bg-primary/10 ring-1 ring-inset ring-primary/40'
            : 'hover:bg-surface-raised',
          // Any row tints the moment it is pressed, for its Pay or its page, and
          // stays tinted through the pause and behind its sheet (owner,
          // 2026-10-21: which row was touched, seen rather than read). A tint
          // only: no border of its own.
          'has-[:active]:bg-primary/20',
          lit?.id === cost.id && 'bg-primary/20',
        )
      }
      empty={empty ?? null}
    />
  )
}

/**
 * *₹4,000 of ₹12,000 paid*, then *+ ₹3,300 overdue from Sept* in amber or
 * *+ ₹5,000 ahead* in green where either applies.
 */
function MonthProgress({
  status,
  testId,
  ringTestId,
}: {
  status: ThisMonthStatus
  testId?: string
  ringTestId?: string
}) {
  const overdue = status.overdue.reduce((sum, row) => sum + row.paise, 0)
  // Overdue reads amber and paid ahead green, each on its own line.
  return (
    <span className="block min-w-[9.5rem] text-sm" data-testid={testId}>
      {!status.active ? (
        <span className="block text-content-muted">Stopped</span>
      ) : (
        <>
          <span className="relative block whitespace-nowrap text-content-muted">
            <PaidRing
              paidPaise={status.paidPaise}
              owedPaise={status.costPaise + overdue}
              testId={ringTestId}
            />
            {status.leftPaise === 0 ? (
              <>
                <Money paise={status.costPaise} className="font-semibold text-content" /> paid
              </>
            ) : (
              <>
                <Money paise={status.paidPaise} className="font-semibold text-content" /> of{' '}
                <Money paise={status.costPaise} /> paid
              </>
            )}
          </span>
        </>
      )}
      {overdue > 0 && (
        <span className="mt-1 block whitespace-nowrap text-xs font-semibold text-warning">
          + <Money paise={overdue} /> overdue from{' '}
          {shortMonths(status.overdue.map((row) => row.month))}
        </span>
      )}
      {status.aheadPaise > 0 && (
        <span className="mt-1 block whitespace-nowrap text-xs font-semibold text-success">
          + <Money paise={status.aheadPaise} /> ahead
        </span>
      )}
    </span>
  )
}

/**
 * What is paid of everything the row owes now, at a glance (owner, 2026-10-30):
 * an empty ring, filling amber, then the attendance list's Present tick once
 * this month and any overdue month are paid. It sits in the gap left of the
 * figure, so the figures stay aligned under the heading. The figure says the
 * same in words, so the ring is not read aloud.
 */
function PaidRing({
  paidPaise,
  owedPaise,
  testId,
}: {
  paidPaise: number
  owedPaise: number
  testId?: string | undefined
}) {
  const all = paidPaise >= owedPaise
  const part = all ? 1 : paidPaise / owedPaise
  // A 14px ring, as the Present tick is 14px; r 5.5 with a 2px stroke.
  const circumference = 2 * Math.PI * 5.5
  return (
    <span
      aria-hidden
      data-testid={testId}
      data-paid={all ? 'all' : String(part)}
      className="absolute -left-[1.1875rem] top-[0.1875rem] flex size-3.5"
    >
      {all ? (
        <CheckCircle2 size={14} className="text-success" />
      ) : (
        <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90">
          <circle cx="7" cy="7" r="5.5" fill="none" strokeWidth="2" className="stroke-border" />
          {part > 0 && (
            <circle
              cx="7"
              cy="7"
              r="5.5"
              fill="none"
              strokeWidth="2"
              strokeDasharray={`${part * circumference} ${circumference}`}
              className="stroke-warning"
            />
          )}
        </svg>
      )}
    </span>
  )
}

// ── One fixed cost's page ─────────────────────────────────────────────────

/**
 * **One fixed cost's own page.** Its name heads it; then its monthly amount,
 * this month and its balance as tiles; then its months, newest first, each with
 * what covered it; then its payments. Back steps back through the reader's own
 * history, as an outlet's page does, and goes to the list when opened first.
 */
export function FixedCostPage() {
  const { fixedCosts } = useAdapters()
  const { outletId } = useOutletScope()
  const navigate = useNavigate()
  const location = useLocation()
  const { fixedCostId = '' } = useParams()
  const [reading, setReading] = useState<FixedCostsReading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)
  const [sheet, setSheet] = useState<'pay' | 'edit' | 'stop' | null>(null)
  const [dropping, setDropping] = useState<{ month: string; coveredPaise: number } | null>(null)
  // Undo a payment (owner, 2026-10-19): the expense, and what its answer recorded.
  const [undoing, setUndoing] = useState<FixedCostPayment | null>(null)
  const [busy, setBusy] = useState(false)

  const back = useCallback(() => {
    if (location.key === 'default') void navigate('..', { relative: 'path', replace: true })
    else void navigate(-1)
  }, [location.key, navigate])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void fixedCosts
      .list(outletId)
      .then((value) => {
        if (active) setReading(value)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(messageOf(cause, 'Could not load this fixed cost. Try again in a moment.'))
      })
    return () => {
      active = false
    }
  }, [fixedCosts, outletId, reads])

  const cost =
    reading === null ? undefined : (reading.costs.find((c) => c.id === fixedCostId) ?? null)
  const changed = () => {
    setSheet(null)
    setDropping(null)
    setUndoing(null)
    setReads((n) => n + 1)
    attentionChanged()
  }
  // Where the last payment landed. A salary paid on the 2nd counts on the 31st,
  // so the expense is not on the day the reader would look for it: say where it
  // went, one tap from that day's expenses (owner, 2026-10-19).
  const [recorded, setRecorded] = useState<string | null>(null)

  async function act(run: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await run()
      changed()
    } catch (cause) {
      setError(messageOf(cause, 'That did not work. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        onBack={back}
        title={cost ? cost.name : 'Fixed cost'}
        action={
          cost ? (
            <button
              type="button"
              onClick={() => setSheet('edit')}
              aria-label={`Edit ${cost.name}`}
              data-testid="edit-fixed-cost"
              className={buttonVariants({ size: 'phone' })}
            >
              Edit
            </button>
          ) : undefined
        }
      />

      {recorded && outletId && <Recorded countsIn={recorded} outletId={outletId} />}

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {cost === undefined || reading === null ? (
        <PageShimmer />
      ) : cost === null ? (
        <EmptyState icon={CalendarClock} title="There is no fixed cost by that name here." />
      ) : (
        <CostDetail
          cost={cost}
          today={reading.today}
          busy={busy}
          onPay={() => setSheet('pay')}
          onStop={() => setSheet('stop')}
          onDrop={(month, coveredPaise) => setDropping({ month, coveredPaise })}
          onUndo={(settlementId) => void act(() => fixedCosts.voidSettlement(settlementId))}
          onUndoPayment={setUndoing}
        />
      )}

      {cost && reading && (
        <>
          {/* Each sheet mounts when it opens, so it always starts from blank. */}
          {sheet === 'pay' && (
            <PaySheet
              open
              cost={cost}
              today={reading.today}
              onClose={() => setSheet(null)}
              onPaid={(countsIn) => {
                setRecorded(countsIn)
                changed()
              }}
            />
          )}
          {sheet === 'edit' && (
            <EditSheet
              open
              cost={cost}
              today={reading.today}
              onClose={() => setSheet(null)}
              onSaved={changed}
            />
          )}
          {sheet === 'stop' && (
            <StopSheet
              open
              cost={cost}
              today={reading.today}
              onClose={() => setSheet(null)}
              onStopped={changed}
            />
          )}
          <ConfirmDialog
            open={undoing !== null}
            title="Undo this payment?"
            consequence={undoing ? undoWords(cost, undoing) : ''}
            confirmLabel="Undo"
            busy={busy}
            onClose={() => setUndoing(null)}
            onConfirm={() => {
              const target = undoing
              if (target) void act(() => fixedCosts.undoPayment(cost.id, target.id))
            }}
          />
          <ConfirmDialog
            open={dropping !== null}
            title={dropping ? `Drop the rest of ${monthName(dropping.month)}?` : ''}
            consequence={
              dropping
                ? `${monthName(dropping.month)} is settled at ${formatPaise(dropping.coveredPaise)}, what has been paid for it, and nothing more is owed for it.`
                : ''
            }
            confirmLabel="Drop"
            busy={busy}
            onClose={() => setDropping(null)}
            onConfirm={() => {
              const target = dropping
              if (target)
                void act(() => fixedCosts.settle(cost.id, target.month, target.coveredPaise))
            }}
          />
        </>
      )}
    </div>
  )
}

function CostDetail({
  cost,
  today,
  busy,
  onPay,
  onStop,
  onDrop,
  onUndo,
  onUndoPayment,
}: {
  cost: FixedCostFacts
  today: string
  busy: boolean
  onPay: () => void
  onStop: () => void
  onDrop: (month: string, coveredPaise: number) => void
  onUndo: (settlementId: string) => void
  onUndoPayment: (payment: FixedCostPayment) => void
}) {
  const month = monthOf(today)
  const lastMonth = cost.stopsOn && monthOf(cost.stopsOn) < month ? monthOf(cost.stopsOn) : month
  const status = thisMonthStatus(cost, today)
  // Months an advance has already reached, shown after this one.
  let through = lastMonth
  if (!cost.stopsOn)
    for (let k = 1; k <= 12; k += 1) {
      const next = addMonths(month, k)
      const reach = coverage(cost, next, today).months.at(-1)
      if (!reach || reach.coveredPaise === 0) break
      through = next
    }
  const months = coverage(cost, through, today).months.slice().reverse()
  const payments = [...cost.payments].sort(
    (a, b) => b.countsIn.localeCompare(a.countsIn) || b.createdAt.localeCompare(a.createdAt),
  )
  const stopped = cost.stopsOn !== null && cost.stopsOn < today

  return (
    <div className="space-y-6" data-testid={`fixed-cost-${cost.id}`}>
      {/*
        The figures lead and the words are their captions (owner, 2026-10-19):
        this month on its own, then overdue and paid ahead only when there is any.
      */}
      <dl className="grid grid-cols-2 gap-2" data-testid="fixed-cost-tiles">
        <Tile caption="Category">{FIXED_COST_CATEGORY_LABEL[cost.category]}</Tile>
        <Tile caption="Monthly amount">
          <Money paise={amountNow(cost, month)} />
        </Tile>
        <Tile caption="This month">
          {status.active ? <Money paise={status.costPaise} /> : 'Stopped'}
        </Tile>
        <Tile caption="Paid">
          <Money paise={status.paidPaise} />
        </Tile>
        <Tile caption="Left to pay">
          <Money paise={status.leftPaise} data-testid="fixed-cost-left" />
        </Tile>
        {status.overdue.length > 0 && (
          <Tile caption={`Overdue from ${monthWords(status.overdue.map((row) => row.month))}`}>
            <Money
              paise={status.overdue.reduce((sum, row) => sum + row.paise, 0)}
              className="text-warning"
              data-testid="fixed-cost-overdue"
            />
          </Tile>
        )}
        {status.aheadPaise > 0 && (
          <Tile caption="Paid ahead">
            <Money paise={status.aheadPaise} data-testid="fixed-cost-ahead" />
          </Tile>
        )}
        {cost.note && (
          <div className="col-span-2">
            <Tile caption="Note">{cost.note}</Tile>
          </div>
        )}
      </dl>

      <Section id="fixed-cost-months" title="Months">
        <ul className="space-y-2" data-testid="fixed-cost-months">
          {months.map((row) => {
            const settlement = settlementFor(cost, row.month)
            const future = row.month > month
            const ended = row.month < month
            const short = row.coveredPaise < row.costPaise
            const days = activeDays(cost, row.month).count
            return (
              <li
                key={row.month}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-raised px-3 py-2"
                data-testid={`month-${row.month}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-content">
                    {monthName(row.month)} · <Money paise={row.costPaise} />
                  </p>
                  <p className="text-xs text-content-muted">
                    {coverageWords(row.coveredPaise, row.costPaise, ended, future)}
                    {settlement
                      ? ' · settled'
                      : days < daysInMonth(row.month)
                        ? ` · ${days} of ${daysInMonth(row.month)} days`
                        : ''}
                  </p>
                </div>
                {settlement ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUndo(settlement.id)}
                    aria-label={`Undo ${monthName(row.month)}'s settlement`}
                    className={buttonVariants({ variant: 'ghost', size: 'phone' })}
                  >
                    Undo
                  </button>
                ) : (
                  !future &&
                  short &&
                  row.coveredPaise > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDrop(row.month, row.coveredPaise)}
                      aria-label={`Drop the rest of ${monthName(row.month)}`}
                      className={buttonVariants({ variant: 'ghost', size: 'phone' })}
                    >
                      Drop
                    </button>
                  )
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        id="fixed-cost-payments"
        title="Payments"
        actions={
          <button
            type="button"
            onClick={onPay}
            aria-label={`Pay ${cost.name}`}
            data-testid="pay-fixed-cost"
            className={buttonVariants({ size: 'phone' })}
          >
            Pay
          </button>
        }
      >
        {payments.length === 0 ? (
          <p className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-content-muted">
            Nothing paid yet.
          </p>
        ) : (
          <ul
            className="divide-y divide-border rounded-lg border border-border"
            data-testid="fixed-cost-payments"
          >
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-content">
                    Paid {shortDate(payment.paidOn)}
                    {monthOf(payment.countsIn) !== monthOf(payment.paidOn) && (
                      <span className="text-content-muted">
                        {' '}
                        · counted in {monthName(monthOf(payment.countsIn))}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-content-muted">
                    {payment.isCash ? 'Drawer cash' : 'UPI / bank or collected cash'}
                    {payment.note && ` · ${payment.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Money paise={payment.amountPaise} className="text-sm font-semibold" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUndoPayment(payment)}
                    aria-label={`Undo the ${formatPaise(payment.amountPaise)} paid ${shortDate(payment.paidOn)}`}
                    data-testid={`undo-payment-${payment.id}`}
                    className="text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
                  >
                    Undo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!stopped && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onStop}
            aria-label={`Stop ${cost.name}`}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'phone' }),
              'border-danger text-danger',
            )}
          >
            Stop
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * *Withdraws the ₹10,000 paid 2 Nov, reopens October and puts November back to
 * ₹12,000. Then pay it again with the right answer.*
 */
function undoWords(cost: FixedCostFacts, payment: FixedCostPayment): string {
  const undo = paymentUndo(cost, payment.id)
  const parts = [
    `withdraws the ${formatPaise(payment.amountPaise)} paid ${shortDate(payment.paidOn)}`,
  ]
  if (undo.settledMonths.length > 0) parts.push(`reopens ${monthWords(undo.settledMonths)}`)
  if (undo.amount)
    parts.push(
      `puts ${monthName(undo.amount.fromMonth)} back to ${formatPaise(undo.amount.restoredPaise)} a month`,
    )
  const sentence =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`
  return `This ${sentence}. The expense stays on its day, struck through. Then pay again with the right answer.`
}

function coverageWords(covered: number, cost: number, ended: boolean, future: boolean): string {
  if (future) return `${formatPaise(covered)} paid ahead`
  if (covered >= cost) return 'Paid'
  if (covered === 0) return ended ? 'Unpaid' : 'Not paid yet'
  return `${formatPaise(covered)} of ${formatPaise(cost)} paid`
}

function amountNow(cost: FixedCostFacts, month: string): number {
  let best = cost.amounts[0]
  for (const row of cost.amounts)
    if (
      row.fromMonth <= month &&
      (!best ||
        best.fromMonth > month ||
        row.fromMonth > best.fromMonth ||
        (row.fromMonth === best.fromMonth && row.createdAt > best.createdAt))
    )
      best = row
  return best?.amountPaise ?? 0
}

/** *Recorded on 31 Oct · View*: where the payment's expense landed, one tap away. */
function Recorded({
  countsIn,
  outletId,
  name,
}: {
  countsIn: string
  outletId: string
  name?: string
}) {
  const base = useExpensesBase()
  return (
    <p
      role="status"
      className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface-raised px-3 py-2 text-sm"
      data-testid="fixed-cost-recorded"
    >
      <span className="text-content">
        {name ? `${name} recorded on ` : 'Recorded on '}
        {shortDate(countsIn)}
      </span>
      <Link
        to={`${base}/ledger/expenses?outlet=${encodeURIComponent(outletId)}&date=${countsIn}`}
        className="font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
        data-testid="fixed-cost-recorded-view"
      >
        View
      </Link>
    </p>
  )
}

// ── The sheets ────────────────────────────────────────────────────────────

function AddSheet({
  open,
  outletId,
  today,
  onClose,
  onAdded,
}: {
  open: boolean
  outletId: string
  today: string
  onClose: () => void
  onAdded: () => void
}) {
  const { fixedCosts } = useAdapters()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<FixedCostCategory | ''>('')
  const [amount, setAmount] = useState('')
  const [startsOn, setStartsOn] = useState(monthOf(today))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attention = useFieldAttention<'name' | 'category' | 'amount'>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const monthlyPaise = parseAmount(amount)
    if (!name.trim()) return attention.flag('name', 'Give it a name: a person or what it pays for.')
    if (category === '') return attention.flag('category', 'Choose a category.')
    if (monthlyPaise === null)
      return attention.flag('amount', 'Enter the monthly amount, in rupees.')
    setBusy(true)
    setError(null)
    try {
      await fixedCosts.add({
        outletId,
        name: name.trim(),
        category,
        monthlyPaise,
        startsOn,
        note: note.trim() || null,
      })
      onAdded()
    } catch (cause) {
      setError(messageOf(cause, 'That fixed cost was not added. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Add a fixed cost"
      error={error}
      busy={busy}
      footer={
        <button
          type="submit"
          form="fixed-cost-add-form"
          disabled={busy}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
          data-testid="save-fixed-cost"
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      }
    >
      <form id="fixed-cost-add-form" onSubmit={submit} className="space-y-4" noValidate>
        <AttentionField
          attentionRef={attention.register('name')}
          message={attention.messageFor('name')}
        >
          <Field label="Name" id="fixed-cost-name">
            <Input
              id="fixed-cost-name"
              value={name}
              placeholder="e.g. Nayan, or Shop rent"
              data-testid="fixed-cost-name"
              onChange={(event) => {
                setName(event.target.value)
                attention.clear('name')
              }}
            />
          </Field>
        </AttentionField>
        <AttentionField
          attentionRef={attention.register('category')}
          message={attention.messageFor('category')}
        >
          <Field label="Category" id="fixed-cost-category">
            <Select
              id="fixed-cost-category"
              value={category}
              data-testid="fixed-cost-category"
              onChange={(event) => {
                setCategory(event.target.value as FixedCostCategory)
                attention.clear('category')
              }}
            >
              <option value="" disabled>
                Choose…
              </option>
              {FIXED_COST_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {FIXED_COST_CATEGORY_LABEL[key]}
                </option>
              ))}
            </Select>
          </Field>
        </AttentionField>
        <AttentionField
          attentionRef={attention.register('amount')}
          message={attention.messageFor('amount')}
        >
          <Field label="Monthly amount (₹)" id="fixed-cost-amount">
            <Input
              id="fixed-cost-amount"
              inputMode="decimal"
              value={amount}
              placeholder="e.g. 10000"
              data-testid="fixed-cost-amount"
              onChange={(event) => {
                setAmount(event.target.value)
                attention.clear('amount')
              }}
            />
          </Field>
        </AttentionField>
        <Field label="Starts" id="fixed-cost-starts">
          <Input
            id="fixed-cost-starts"
            type="date"
            value={startsOn}
            data-testid="fixed-cost-starts"
            onChange={(event) => setStartsOn(event.target.value || monthOf(today))}
          />
          {startsOn.slice(8) !== '01' && (
            <p className="text-xs text-content-muted">
              In {monthName(monthOf(startsOn))} we pay only for the days from {shortDate(startsOn)}.
            </p>
          )}
        </Field>
        <Field label="Note (optional)" id="fixed-cost-note">
          <Input
            id="fixed-cost-note"
            value={note}
            data-testid="fixed-cost-note"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </FormSheet>
  )
}

/**
 * Edit, every field (owner, 2026-10-19). A changed monthly amount asks from
 * which month, so the months already gone keep what they cost; the other fields
 * are the fixed cost's own and change everywhere it is named.
 */
function EditSheet({
  open,
  cost,
  today,
  onClose,
  onSaved,
}: {
  open: boolean
  cost: FixedCostFacts
  today: string
  onClose: () => void
  onSaved: () => void
}) {
  const { fixedCosts } = useAdapters()
  const month = monthOf(today)
  const currentAmount = amountNow(cost, month)
  const [name, setName] = useState(cost.name)
  const [category, setCategory] = useState<FixedCostCategory>(cost.category)
  const [amount, setAmount] = useState(String(currentAmount / 100))
  const [fromMonth, setFromMonth] = useState(addMonths(month, 1))
  const [startsOn, setStartsOn] = useState(cost.startsOn)
  const [note, setNote] = useState(cost.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountPaise = parseAmount(amount)
  const amountChanged = amountPaise !== null && amountPaise !== currentAmount
  const attention = useFieldAttention<'name' | 'amount'>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return attention.flag('name', 'Give it a name: a person or what it pays for.')
    if (amountPaise === null)
      return attention.flag('amount', 'Enter the monthly amount, in rupees.')
    setBusy(true)
    setError(null)
    try {
      const details = { name: name.trim(), category, startsOn, note: note.trim() || null }
      if (
        details.name !== cost.name ||
        details.category !== cost.category ||
        details.startsOn !== cost.startsOn ||
        details.note !== cost.note
      )
        await fixedCosts.update(cost.id, details)
      if (amountChanged) await fixedCosts.changeAmount(cost.id, fromMonth, amountPaise)
      onSaved()
    } catch (cause) {
      setError(messageOf(cause, 'That did not save. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={`Edit ${cost.name}`}
      error={error}
      busy={busy}
      footer={
        <button
          type="submit"
          form="fixed-cost-edit-form"
          disabled={busy}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
          data-testid="save-fixed-cost-edit"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form id="fixed-cost-edit-form" onSubmit={submit} className="space-y-4" noValidate>
        <AttentionField
          attentionRef={attention.register('name')}
          message={attention.messageFor('name')}
        >
          <Field label="Name" id="fixed-cost-edit-name">
            <Input
              id="fixed-cost-edit-name"
              value={name}
              data-testid="fixed-cost-edit-name"
              onChange={(event) => {
                setName(event.target.value)
                attention.clear('name')
              }}
            />
          </Field>
        </AttentionField>
        <Field label="Category" id="fixed-cost-edit-category">
          <Select
            id="fixed-cost-edit-category"
            value={category}
            data-testid="fixed-cost-edit-category"
            onChange={(event) => setCategory(event.target.value as FixedCostCategory)}
          >
            {FIXED_COST_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {FIXED_COST_CATEGORY_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <AttentionField
          attentionRef={attention.register('amount')}
          message={attention.messageFor('amount')}
        >
          <Field label="Monthly amount (₹)" id="fixed-cost-edit-amount">
            <Input
              id="fixed-cost-edit-amount"
              inputMode="decimal"
              value={amount}
              data-testid="fixed-cost-edit-amount"
              onChange={(event) => {
                setAmount(event.target.value)
                attention.clear('amount')
              }}
            />
          </Field>
        </AttentionField>
        {amountChanged && (
          <Field label="New amount from" id="fixed-cost-edit-from">
            <Select
              id="fixed-cost-edit-from"
              value={fromMonth}
              data-testid="fixed-cost-edit-from"
              onChange={(event) => setFromMonth(event.target.value)}
            >
              <option value={month}>This month</option>
              <option value={addMonths(month, 1)}>Next month</option>
            </Select>
          </Field>
        )}
        <Field label="Starts" id="fixed-cost-edit-starts">
          <Input
            id="fixed-cost-edit-starts"
            type="date"
            value={startsOn}
            max={cost.stopsOn ?? undefined}
            data-testid="fixed-cost-edit-starts"
            onChange={(event) => setStartsOn(event.target.value || cost.startsOn)}
          />
        </Field>
        <Field label="Note (optional)" id="fixed-cost-edit-note">
          <Input
            id="fixed-cost-edit-note"
            value={note}
            data-testid="fixed-cost-edit-note"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </FormSheet>
  )
}

function StopSheet({
  open,
  cost,
  today,
  onClose,
  onStopped,
}: {
  open: boolean
  cost: FixedCostFacts
  today: string
  onClose: () => void
  onStopped: () => void
}) {
  const { fixedCosts } = useAdapters()
  const [stopsOn, setStopsOn] = useState(today)
  const [clear, setClear] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stopped = { ...cost, stopsOn }
  const ahead = -balance(stopped, monthOf(stopsOn))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await fixedCosts.stop(cost.id, stopsOn, ahead > 0 && clear)
      onStopped()
    } catch (cause) {
      setError(messageOf(cause, 'That did not save. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={`Stop ${cost.name}`}
      error={error}
      busy={busy}
      footer={
        <button
          type="submit"
          form="fixed-cost-stop-form"
          disabled={busy}
          className={`${buttonVariants({ variant: 'danger', size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Stop'}
        </button>
      }
    >
      <form id="fixed-cost-stop-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Last day" id="fixed-cost-stops-on">
          <Input
            id="fixed-cost-stops-on"
            type="date"
            value={stopsOn}
            min={cost.startsOn}
            onChange={(event) => setStopsOn(event.target.value || today)}
          />
          <p className="text-xs text-content-muted">
            In {monthName(monthOf(stopsOn))} we pay{' '}
            {formatPaise(monthCost(stopped, monthOf(stopsOn)))}, then nothing more.
          </p>
        </Field>
        {ahead > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">{formatPaise(ahead)} paid ahead</legend>
            {[
              {
                value: true,
                words: `Clear ${formatPaise(ahead)}`,
                effect: 'Nothing is owed either way.',
              },
              {
                value: false,
                words: 'Keep it',
                effect: 'Shown under Stopped until it is cleared.',
              },
            ].map((option) => (
              <label
                key={String(option.value)}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2',
                  clear === option.value ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="fixed-cost-stop-ahead"
                  checked={clear === option.value}
                  onChange={() => setClear(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold">{option.words}</span>
                  <span className="block text-xs text-content-muted">{option.effect}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </form>
    </FormSheet>
  )
}

// ── Small parts ───────────────────────────────────────────────────────────

function Tile({
  caption,
  action,
  children,
}: {
  caption: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
      <div className="min-w-0">
        <dt className="text-xs text-content-muted">{caption}</dt>
        <dd className="text-sm font-semibold text-content">{children}</dd>
      </div>
      {action}
    </div>
  )
}

function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex min-h-10 items-center justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold text-content-muted">
          {title}
        </h3>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function PageShimmer() {
  return (
    <LoadingRegion label="this fixed cost" className="space-y-6" data-testid="fixed-cost-loading">
      <div className="grid grid-cols-2 gap-2">
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-20" />
      </div>
    </LoadingRegion>
  )
}
