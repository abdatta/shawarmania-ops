import { useRef, useState, type FormEvent } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { AttentionField } from '@/components/ui/attention-field'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useFieldAttention } from '@/components/ui/use-field-attention'
import { useAdapters } from '@/data-access'
import { formatPaise } from '@/domain'
import {
  addMonths,
  isProrated,
  lastDayOf,
  monthCost,
  monthOf,
  payOwed,
  payPrompt,
  showsInApplies,
  showsInDefault,
  thisMonthStatus,
  type FixedCostFacts,
} from '@/domain/fixed-costs'
import { Field } from '@/features/expenses/field'
import { cn } from '@/lib/cn'

import { messageOf, parseAmount } from './amounts'
import { paySituation, payReasons } from './pay-reasons'
import { monthName, shortMonths } from './words'

/**
 * Pay (design D5, reworked with the owner, 2026-10-19). Top to bottom, and
 * nothing lower down changes anything above it:
 *
 * 1. what is owed today, fixed, in one line;
 * 2. the amount, starting at the usual payment;
 * 3. when the amount differs from what was due, why: a reason picked from
 *    everyday ones (Advance, Bonus, Days off…) that becomes the expense's note
 *    and decides what the payment does, or Other, written out (pay-reasons.ts);
 * 4. when and how it was paid;
 * 5. which month's figures it shows in, only when that is a real question, and
 *    worded so the reason is in the answer.
 */
export function PaySheet({
  open,
  cost,
  today,
  onClose,
  onPaid,
}: {
  open: boolean
  cost: FixedCostFacts
  today: string
  onClose: () => void
  onPaid: (countsIn: string) => void
}) {
  const { fixedCosts } = useAdapters()
  const owed = payOwed(cost, today)
  // Starts at the usual payment: last month's if it is still owed (salaries go
  // out on the 1st or 2nd), else what is left of this month.
  const [amount, setAmount] = useState(() =>
    owed.suggestedPaise > 0 ? String(owed.suggestedPaise / 100) : '',
  )
  // Exact · Less · More (owner, 2026-10-19), under the amount: paying anything
  // but the amount due is a choice made where it can be seen, so a slip of the
  // thumb is not a payment. Typing a different figure moves the switch; Less and
  // More only take the reader up to the amount; Exact puts the due figure back.
  const [aim, setAim] = useState<'exact' | 'less' | 'more'>(() =>
    owed.suggestedPaise > 0 ? 'exact' : 'more',
  )
  const amountInput = useRef<HTMLInputElement>(null)
  const [paidOn, setPaidOn] = useState(today)
  const [paidWith, setPaidWith] = useState<'' | 'cash' | 'other'>('')
  const [showsIn, setShowsIn] = useState<'earlier' | 'paid' | null>(null)
  const [reasonKey, setReasonKey] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A refused Save points at the field it was refused for (owner, 2026-10-19).
  const attention = useFieldAttention<'amount' | 'reason' | 'note' | 'paidWith'>()
  const [id] = useState(() => crypto.randomUUID())

  const isCash = paidWith === 'cash'
  const amountPaise = parseAmount(amount)
  const shownAim: 'exact' | 'less' | 'more' =
    amountPaise === null || amountPaise === owed.suggestedPaise
      ? aim
      : amountPaise < owed.suggestedPaise
        ? 'less'
        : 'more'

  function chooseAim(next: 'exact' | 'less' | 'more') {
    setAim(next)
    if (next === 'exact') {
      setAmount(owed.suggestedPaise > 0 ? String(owed.suggestedPaise / 100) : '')
      return
    }
    // The amount above is left as it is: the cursor goes to it with the figure
    // selected, so what is typed next replaces it (nothing below changes it).
    amountInput.current?.focus()
    amountInput.current?.select()
  }
  const prompt = amountPaise ? payPrompt(cost, amountPaise, today) : null
  const situation = paySituation(prompt, amountPaise, owed.suggestedPaise)
  const month = monthOf(today)
  // The figures every reason names (owner, 2026-10-19: the amounts make the
  // choice checkable).
  const next = addMonths(month, 1)
  const excessPaise = prompt?.kind === 'over' ? prompt.excessPaise : 0
  const nextFullPaise = monthCost(cost, next)
  const aheadAfterPaise = thisMonthStatus(cost, today).aheadPaise + excessPaise
  const restPaise = prompt?.kind === 'short' ? prompt.restPaise : 0
  const reasons = payReasons(situation, cost.category, {
    month: monthName(month),
    next: monthName(next),
    short: prompt?.kind === 'short' ? monthName(prompt.month) : null,
    extra: formatPaise(excessPaise),
    nextOwes: formatPaise(Math.max(0, nextFullPaise - aheadAfterPaise)),
    nextFull: formatPaise(nextFullPaise),
    newAmount:
      prompt?.kind === 'over' && !isProrated(cost, month)
        ? formatPaise(monthCost(cost, prompt.month) + prompt.excessPaise)
        : null,
    rest: formatPaise(restPaise),
    settledAt: formatPaise(prompt?.kind === 'short' ? prompt.settledAtPaise : 0),
    afterShort: prompt?.kind === 'short' ? monthName(addMonths(prompt.month, 1)) : null,
    cutOffered: prompt?.kind === 'short' && prompt.choices.includes('cut'),
    shortEnded: prompt?.kind === 'short' && prompt.month < month,
    now: formatPaise(amountPaise ?? 0),
  })
  const reason = reasons.find((r) => r.key === reasonKey) ?? null

  const lateMonth = owed.overdueMonths.at(-1) ?? null
  const showsInAsked = lateMonth !== null && showsInApplies(cost, paidOn, isCash)
  const countsIn =
    !showsInAsked || lateMonth === null
      ? paidOn
      : showsIn === 'earlier'
        ? lastDayOf(lateMonth)
        : showsIn === 'paid'
          ? paidOn
          : showsInDefault(cost, amountPaise ?? 0, paidOn, isCash)

  const owedTotal = owed.overduePaise + owed.thisMonthPaise
  const owedParts = [
    owed.overduePaise > 0
      ? `${formatPaise(owed.overduePaise)} from ${shortMonths(owed.overdueMonths)}`
      : null,
    owed.thisMonthPaise > 0
      ? `${formatPaise(owed.thisMonthPaise)} for ${shortMonths([monthOf(today)])}`
      : null,
  ].filter((part): part is string => part !== null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!amountPaise) return attention.flag('amount', 'Enter the amount paid, in rupees.')
    if (reasons.length > 0 && !reason)
      return attention.flag('reason', 'Say why it is different from what was due.')
    if (reason?.needsText && !note.trim()) return attention.flag('note', 'Say what it was.')
    if (paidWith === '') return attention.flag('paidWith', 'Choose what it was paid with.')
    attention.clear()
    setBusy(true)
    setError(null)
    try {
      await fixedCosts.pay({
        id,
        fixedCostId: cost.id,
        amountPaise,
        paidOn,
        countsIn,
        isCash,
        // The reason is the note, so the expense says why it differs.
        note:
          [reason && !reason.needsText ? reason.label : null, note.trim() || null]
            .filter(Boolean)
            .join(' · ') || null,
        choice: reason?.effect ?? null,
      })
      onPaid(countsIn)
    } catch (cause) {
      setError(messageOf(cause, 'That payment was not recorded. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={`Pay ${cost.name}`}
      error={error}
      busy={busy}
      footer={
        <button
          type="submit"
          form="fixed-cost-pay-form"
          disabled={busy}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
          data-testid="save-fixed-cost-payment"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form id="fixed-cost-pay-form" onSubmit={submit} className="space-y-4" noValidate>
        <p
          className="rounded-lg bg-surface-raised px-3 py-2 text-sm"
          data-testid="fixed-cost-pay-owed"
        >
          {owedTotal > 0 ? (
            <>
              <span className="font-semibold text-content">Owes {formatPaise(owedTotal)}</span>
              <span className="text-content-muted">
                {owedParts.length > 1
                  ? ` · ${owedParts.join(' + ')}`
                  : owed.overduePaise > 0
                    ? ` from ${shortMonths(owed.overdueMonths)}`
                    : ` for ${shortMonths([monthOf(today)])}`}
              </span>
            </>
          ) : (
            <span className="text-content-muted">Nothing owed right now</span>
          )}
        </p>

        <AttentionField
          attentionRef={attention.register('amount')}
          message={attention.messageFor('amount')}
        >
          <Field label="Amount paid (₹)" id="fixed-cost-pay-amount">
            <Input
              ref={amountInput}
              id="fixed-cost-pay-amount"
              inputMode="decimal"
              value={amount}
              placeholder="e.g. 10000"
              data-testid="fixed-cost-pay-amount"
              onChange={(event) => {
                setAmount(event.target.value)
                attention.clear('amount')
              }}
              onBlur={() => {
                const value = parseAmount(amount)
                if (value === null || value === owed.suggestedPaise)
                  setAim(owed.suggestedPaise > 0 ? 'exact' : 'more')
              }}
            />
          </Field>
        </AttentionField>

        <div
          role="radiogroup"
          aria-label="Amount paid against what is due"
          className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface p-1"
          data-testid="fixed-cost-pay-aim"
        >
          {(
            [
              ['exact', 'Exact'],
              ['less', 'Less'],
              ['more', 'More'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={shownAim === key}
              disabled={key === 'exact' && owed.suggestedPaise === 0}
              onClick={() => chooseAim(key)}
              data-testid={`pay-aim-${key}`}
              className={cn(
                'h-[var(--size-control-phone)] rounded-lg text-sm font-semibold focus-visible:focus-ring disabled:opacity-40',
                shownAim === key
                  ? 'bg-primary text-on-primary'
                  : 'text-content-muted hover:bg-surface-raised hover:text-content',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {shownAim !== 'exact' && (amountPaise === null || amountPaise === owed.suggestedPaise) && (
          <p className="text-xs text-content-muted" data-testid="fixed-cost-pay-type-amount">
            Type what was paid, above.
          </p>
        )}

        {reasons.length > 0 && (
          <AttentionField
            attentionRef={attention.register('reason')}
            message={attention.messageFor('reason')}
          >
            <fieldset className="space-y-2" data-testid="fixed-cost-pay-reasons">
              <legend className="mb-1 text-sm font-semibold">
                {situation === 'over' ? 'Why more?' : 'Why less?'}
              </legend>
              {reasons.map((option) => {
                const picked = reasonKey === option.key
                return (
                  <div
                    key={option.key}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      picked ? 'border-primary bg-primary/5' : 'border-border',
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="fixed-cost-pay-reason"
                        value={option.key}
                        checked={picked}
                        onChange={() => {
                          setReasonKey(option.key)
                          attention.clear('reason')
                        }}
                        className="mt-1"
                        data-testid={`pay-reason-${option.key}`}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-content">
                          {option.label}
                        </span>
                        <span className="block text-xs text-content-muted">{option.hint}</span>
                      </span>
                    </label>
                    {/*
                    Other opens to say what it was, inside its own card, so writing
                    it reads as finishing the choice rather than a field elsewhere.
                  */}
                    {picked && option.needsText && (
                      <AttentionField
                        attentionRef={attention.register('note')}
                        message={attention.messageFor('note')}
                        className="mt-2"
                      >
                        <Input
                          id="fixed-cost-pay-note"
                          aria-label="What it was"
                          value={note}
                          placeholder="What was it?"
                          autoFocus
                          data-testid="fixed-cost-pay-note"
                          onChange={(event) => {
                            setNote(event.target.value)
                            attention.clear('note')
                          }}
                        />
                      </AttentionField>
                    )}
                  </div>
                )
              })}
            </fieldset>
          </AttentionField>
        )}

        <Field label="Paid on" id="fixed-cost-paid-on">
          <Input
            id="fixed-cost-paid-on"
            type="date"
            value={paidOn}
            max={today}
            data-testid="fixed-cost-paid-on"
            onChange={(event) => setPaidOn(event.target.value || today)}
          />
        </Field>

        <AttentionField
          attentionRef={attention.register('paidWith')}
          message={attention.messageFor('paidWith')}
        >
          <Field label="Paid with" id="fixed-cost-paid-with">
            <Select
              id="fixed-cost-paid-with"
              value={paidWith}
              data-testid="fixed-cost-paid-with"
              onChange={(event) => {
                setPaidWith(event.target.value as 'cash' | 'other')
                attention.clear('paidWith')
              }}
            >
              <option value="" disabled>
                Choose…
              </option>
              <option value="cash">Drawer cash</option>
              {/* Cash from the collected stack is not the drawer's (owner, 2026-10-19). */}
              <option value="other">UPI / bank or collected cash</option>
            </Select>
          </Field>
        </AttentionField>

        {showsInAsked && lateMonth && (
          <fieldset className="space-y-2" data-testid="fixed-cost-shows-in">
            <legend className="mb-1 text-sm font-semibold">Shows in</legend>
            {[
              {
                key: 'earlier' as const,
                title: `${monthName(lateMonth)}'s figures`,
                hint: `Late pay for ${monthName(lateMonth)}: its P&L carries it.`,
                selected: countsIn === lastDayOf(lateMonth),
              },
              {
                key: 'paid' as const,
                title: `${monthName(monthOf(paidOn))}'s figures`,
                hint: 'Counted on the day it was paid.',
                selected: countsIn === paidOn,
              },
            ].map((option) => (
              <label
                key={option.key}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2',
                  option.selected ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="fixed-cost-shows-in"
                  checked={option.selected}
                  onChange={() => setShowsIn(option.key)}
                  className="mt-1"
                  data-testid={`shows-in-${option.key}`}
                />
                <span>
                  <span className="block text-sm font-semibold text-content">{option.title}</span>
                  <span className="block text-xs text-content-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {!reason?.needsText && (
          <Field label="Note (optional)" id="fixed-cost-pay-note">
            <Input
              id="fixed-cost-pay-note"
              value={note}
              data-testid="fixed-cost-pay-note"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        )}
      </form>
    </FormSheet>
  )
}
