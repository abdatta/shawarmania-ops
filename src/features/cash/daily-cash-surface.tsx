import { Banknote, Lock, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import { DataActionError, type DailyCashDay } from '@/data-access/adapters'
import {
  billReference,
  describeDifference,
  differencePaise,
  formatBusinessDate,
  formatDateTime,
  resolveBusinessDate,
  rupeesToPaise,
  shiftBusinessDate,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * Daily cash — the screen this business was commissioned to get right.
 *
 * Everything above the one input is **derived**, and labelled as derived: what
 * the drawer started with, what cash sales added, what cash expenses and
 * withdrawals took out, and therefore what should be in it. A manager supplies
 * exactly one number — what they counted — and the difference appears the moment
 * they type it, because that number is the entire point of the screen.
 *
 * The difference is stated in words as well as by sign. A minus sign is the
 * first thing a small screen or a photocopy loses, and *"₹240 short"* is not a
 * sentence anyone misreads.
 *
 * Closing writes a snapshot and the day stops moving. A bill that arrives
 * afterwards does **not** change it — it raises a reconciliation exception
 * instead, named on this screen with the bill and the amount, because silently
 * rewriting a figure somebody signed their name to is the failure this whole
 * chain exists to prevent.
 */

const DIFFERENCE_WORDS = {
  short: 'short — this much is missing from the drawer',
  over: 'over — this much more than expected was counted',
  balanced: 'the drawer balances exactly',
} as const

export function DailyCashSurface() {
  const { dailyCash: adapter, outlets } = useAdapters()

  const [today, setToday] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [day, setDay] = useState<DailyCashDay | null>(null)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [withdrawal, setWithdrawal] = useState({ amount: '', withdrawnBy: '', reason: '' })

  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, managed, selector: outletSelector } = useOutletScope()

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
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
    setDay(await adapter.getDay(outletId, businessDate))
  }, [adapter, outletId, businessDate])

  useEffect(() => {
    if (!outletId || !businessDate) return
    let active = true
    void adapter
      .getDay(outletId, businessDate)
      .then((loaded) => {
        if (active) setDay(loaded)
      })
      .catch(() => {
        if (active) setError('Could not load the day’s cash. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId, businessDate])

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

  const countedRupees = Number(counted.trim())
  const countedIsUsable =
    counted.trim() !== '' && Number.isFinite(countedRupees) && countedRupees >= 0
  // Computed as it is typed, through the same function the stored record uses —
  // and the same equation the database enforces as a constraint.
  const liveDifference =
    day && countedIsUsable
      ? differencePaise(rupeesToPaise(countedRupees), day.expectedClosingPaise)
      : null

  async function submitWithdrawal(event: FormEvent) {
    event.preventDefault()
    if (!outletId || !businessDate) return

    const rupees = Number(withdrawal.amount.trim())
    if (withdrawal.amount.trim() === '' || !Number.isFinite(rupees) || rupees <= 0) {
      setError('A withdrawal needs an amount above zero, as a number of rupees.')
      return
    }
    if (withdrawal.withdrawnBy.trim() === '') {
      setError('A withdrawal needs a name — who took the cash out.')
      return
    }

    await run(async () => {
      await adapter.recordWithdrawal({
        outletId,
        businessDate,
        amountPaise: rupeesToPaise(rupees),
        withdrawnBy: withdrawal.withdrawnBy,
        reason: withdrawal.reason,
      })
      setWithdrawal({ amount: '', withdrawnBy: '', reason: '' })
      setWithdrawalOpen(false)
    })
  }

  const closed = day?.closed ?? null

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Cash"
        subtitle={
          businessDate
            ? `${formatBusinessDate(businessDate)} — everything above the counted amount is worked out for you.`
            : undefined
        }
      />

      {businessDate && today && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="cash-day" className="text-xs font-semibold text-content-muted">
            Day
          </label>
          <Select
            id="cash-day"
            className="h-11 w-auto"
            value={businessDate}
            onChange={(event) => {
              // Switching days clears what was typed for the previous one. A
              // counted figure carried across would be an invitation to close
              // the wrong day with the right number.
              setCounted('')
              setNotes('')
              setError(null)
              setBusinessDate(event.target.value)
            }}
            data-testid="cash-day"
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
        <p role="alert" data-testid="cash-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {day === null ? (
        // The two cards that always land: the four figures and their total,
        // then the count-and-close form. The exception card is not reserved
        // because whether there is one is exactly what this read decides.
        <LoadingFigures label="today’s cash" rows={[6, 7]} data-testid="cash-loading" />
      ) : (
        <div className="space-y-3">
          {day.exceptions.length > 0 && (
            <Card className="space-y-2 border-warning" data-testid="reconciliation-exception">
              <p className="flex items-start gap-2 text-sm font-bold text-content">
                <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
                {day.exceptions.length === 1
                  ? 'A bill arrived after this day was closed.'
                  : `${day.exceptions.length} bills arrived after this day was closed.`}
              </p>
              <ul className="space-y-1 text-xs text-content">
                {day.exceptions.map((exception) => (
                  <li key={exception.billId} data-testid={`exception-${exception.billId}`}>
                    {billReference(exception.billNumber)} — <Money paise={exception.totalPaise} /> (
                    {exception.paymentMethod}), rung {formatDateTime(exception.createdAt)} and
                    received {formatDateTime(exception.syncedAt)}.
                  </li>
                ))}
              </ul>
              <p className="text-xs text-content-muted">
                The figures below have <strong>not</strong> been changed. A closed day is what was
                counted and signed off, and a bill landing afterwards must not rewrite it — so it is
                reported here instead, for somebody to account for.
              </p>
            </Card>
          )}

          <Card className="space-y-2" data-testid="cash-figures">
            <Row label="Opening float" paise={day.openingCashPaise} testId="opening" />
            <Row
              label="Cash sales"
              paise={day.cashSalesPaise}
              testId="cash-sales"
              hint="Settled bills paid in cash. A UPI sale is revenue, but not drawer."
            />
            <Row
              label="Cash expenses"
              paise={-day.cashExpensesPaise}
              testId="cash-expenses"
              hint="Expenses paid in cash. Nothing paid another way appears here."
            />
            <Row label="Withdrawals" paise={-day.cashWithdrawnPaise} testId="withdrawn" />

            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-bold text-content">Should be in the drawer</span>
              <Money
                paise={day.expectedClosingPaise}
                className="font-bold"
                data-testid="expected-closing"
              />
            </div>
          </Card>

          {day.withdrawals.length > 0 && (
            <Card className="space-y-1" data-testid="withdrawal-list">
              <h2 className="text-sm font-bold text-content">Taken out today</h2>
              {day.withdrawals.map((entry) => (
                <p key={entry.id} className="flex items-baseline justify-between text-xs">
                  <span className="text-content-muted">
                    {entry.withdrawnBy}
                    {entry.reason ? ` — ${entry.reason}` : ''}
                  </span>
                  <Money paise={entry.amountPaise} />
                </p>
              ))}
            </Card>
          )}

          {closed ? (
            <Card className="space-y-2" data-testid="closed-day">
              <p className="flex items-center gap-2 text-sm font-bold text-content">
                <Lock aria-hidden size={16} />
                Closed {formatDateTime(closed.closed_at)}
              </p>
              <Row label="Counted" paise={closed.actual_closing_paise} testId="closed-actual" />
              <DifferenceLine paise={closed.difference_paise} testId="closed-difference" />
              {closed.notes && <p className="text-xs text-content-muted">{closed.notes}</p>}
              <p className="text-xs text-content-muted">
                These figures are a snapshot of what was counted and signed off. Nothing recomputes
                them, and the day cannot be closed again.
              </p>
            </Card>
          ) : (
            <Card className="space-y-3" data-testid="close-day">
              <div className="space-y-1">
                <label htmlFor="counted" className="block text-sm font-bold text-content">
                  Count the drawer and enter it (₹)
                </label>
                <Input
                  id="counted"
                  inputMode="decimal"
                  value={counted}
                  placeholder="e.g. 4750"
                  onChange={(event) => setCounted(event.target.value)}
                />
              </div>

              {liveDifference !== null && (
                <DifferenceLine paise={liveDifference} testId="live-difference" />
              )}

              <div className="space-y-1">
                <label htmlFor="cash-notes" className="block text-sm font-semibold">
                  Notes (optional)
                </label>
                <Input
                  id="cash-notes"
                  value={notes}
                  placeholder="e.g. Counted twice"
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              {/*
                The drawer is the outlet manager's alone, always
                (multi-outlet-people, design D8): closing the day and taking
                cash out are refused by the database for anyone else, the owner
                included. Reading it is not — an owner who cannot see the day
                cannot oversee it — so the figures stay and only the two writes
                go, with the reason said rather than left to be discovered.
              */}
              {managed ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="phone"
                    disabled={busy || !countedIsUsable}
                    data-testid="close-day-button"
                    onClick={() => setConfirming(true)}
                  >
                    Close the day
                  </Button>
                  <Button
                    variant="secondary"
                    size="phone"
                    disabled={busy}
                    data-testid="add-withdrawal"
                    onClick={() => {
                      setError(null)
                      setWithdrawalOpen(true)
                    }}
                  >
                    <Banknote aria-hidden size={16} />
                    Record a withdrawal
                  </Button>
                </div>
              ) : (
                <p
                  data-testid="drawer-not-yours"
                  className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted"
                >
                  The drawer belongs to this outlet&rsquo;s manager. You can read the day; closing
                  it and taking cash out are theirs.
                </p>
              )}
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Close this day?"
        consequence={
          day
            ? `The figures on this screen are snapshotted as they are now, with the difference recorded against your name. The day cannot be closed again, and nothing afterwards changes it — a bill that syncs later will be reported as an exception rather than folded in.`
            : ''
        }
        confirmLabel="Close the day"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          if (!outletId || !businessDate || !countedIsUsable) return
          void run(() =>
            adapter.closeDay({
              outletId,
              businessDate,
              actualClosingPaise: rupeesToPaise(countedRupees),
              notes,
            }),
          )
        }}
      />

      <FormSheet
        open={withdrawalOpen}
        onClose={() => setWithdrawalOpen(false)}
        title="Record a withdrawal"
        error={error}
        footer={
          <button
            type="submit"
            form="withdrawal-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Record withdrawal'}
          </button>
        }
      >
        <form id="withdrawal-form" onSubmit={submitWithdrawal} className="space-y-4" noValidate>
          <Field label="Amount (₹)" id="withdrawal-amount">
            <Input
              id="withdrawal-amount"
              required
              inputMode="decimal"
              value={withdrawal.amount}
              placeholder="e.g. 3000"
              onChange={(event) => setWithdrawal({ ...withdrawal, amount: event.target.value })}
            />
          </Field>

          <Field label="Taken by" id="withdrawal-by">
            <Input
              id="withdrawal-by"
              required
              value={withdrawal.withdrawnBy}
              placeholder="Who took it out"
              onChange={(event) =>
                setWithdrawal({ ...withdrawal, withdrawnBy: event.target.value })
              }
            />
          </Field>

          <Field label="Reason (optional)" id="withdrawal-reason">
            <Input
              id="withdrawal-reason"
              value={withdrawal.reason}
              placeholder="e.g. Banked on the way home"
              onChange={(event) => setWithdrawal({ ...withdrawal, reason: event.target.value })}
            />
          </Field>
        </form>
      </FormSheet>
    </div>
  )
}

function Row({
  label,
  paise,
  testId,
  hint,
}: {
  label: string
  paise: number
  testId: string
  hint?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-content-muted">{label}</span>
        <Money paise={paise} data-testid={testId} />
      </div>
      {hint && <p className="text-xs text-content-muted">{hint}</p>}
    </div>
  )
}

/**
 * The difference, with its direction in words.
 *
 * Both are shown because either alone is a trap: a bare `−₹240` loses its sign
 * to a bad screen, and a bare "short" loses the amount.
 */
function DifferenceLine({ paise, testId }: { paise: number; testId: string }) {
  const kind = describeDifference(paise)

  return (
    <div
      data-testid={testId}
      data-difference={kind}
      className={
        kind === 'balanced'
          ? 'rounded-lg border border-border bg-surface-raised p-2'
          : 'rounded-lg border border-warning bg-surface-raised p-2'
      }
    >
      <p className="flex items-baseline justify-between">
        <span className="text-sm font-bold text-content">Difference</span>
        <Money paise={paise} display />
      </p>
      <p className="text-xs text-content-muted">{DIFFERENCE_WORDS[kind]}</p>
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
