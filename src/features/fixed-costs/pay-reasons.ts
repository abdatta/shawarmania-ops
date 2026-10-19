import type { FixedCostCategory, PayChoiceKey, PayPrompt } from '@/domain/fixed-costs'

/**
 * Why a payment differs from what was due (owner, 2026-10-19: "paying an amount
 * different from what is due should require some kind of a note"). Each reason
 * is the note the expense keeps and decides what the payment does, so the
 * reader picks one thing they recognise instead of an accounting effect.
 * **Other** asks them to write what it was.
 *
 * Every hint names its amounts (owner, 2026-10-19: "to make less mistakes"): the
 * extra, what next month will owe, what is still to pay, so the figures can be
 * checked before Save.
 */
export interface PayReason {
  key: string
  label: string
  /** The example and the figures, shown under the label. */
  hint: string
  /** What it records beside the payment; null records nothing more. */
  effect: PayChoiceKey | null
  /** Other: the note must be written. */
  needsText?: true
}

/** How a payment stands against what was due, as the sheet decides what to ask. */
export type PaySituation = 'as-due' | 'over' | 'short'

export function paySituation(
  prompt: PayPrompt | null,
  amountPaise: number | null,
  suggestedPaise: number,
): PaySituation {
  // The amount due asks nothing, even where it leaves this month to pay later.
  if (amountPaise === null || amountPaise === suggestedPaise) return 'as-due'
  if (prompt?.kind === 'over') return 'over'
  if (prompt?.kind === 'short') return 'short'
  return 'as-due'
}

/** The words and formatted figures the hints are built from. */
export interface PayReasonWords {
  /** This month and next, and the ended month paid short, by name. */
  month: string
  next: string
  short: string | null
  /** Over: what is paid beyond everything owed. */
  extra: string
  /** Over: what next month owes after an advance, and what it owes otherwise. */
  nextOwes: string
  nextFull: string
  /** Over: the new monthly amount, where one may be set (null in a prorated month). */
  newAmount: string | null
  /** Short: what the month is still owed, and what it settles at with this payment. */
  rest: string
  settledAt: string
  /** Short: the month after the short one, where a pay cut starts. */
  afterShort: string | null
  /** Short: whether a pay cut may be set (not in a prorated month). */
  cutOffered: boolean
  /** Short: whether the short month is already over (paid late, not early). */
  shortEnded: boolean
  /** Paid now. */
  now: string
}

export function payReasons(
  situation: PaySituation,
  category: FixedCostCategory,
  w: PayReasonWords,
): PayReason[] {
  const salary = category === 'salary'
  // The eight answers, settled with the owner on 2026-10-19, every month said by
  // its name (correct for a month already over, where "this month" is not). More: the payment
  // *includes* something (only part of it is the advance or the bonus), or the
  // amount changes for good. Less: an advance from a month still running, the
  // month closed at what was paid, or the amount cut for good. Rent and bills say
  // the same in their own words.
  if (situation === 'over')
    return [
      {
        key: 'advance-next',
        label: `Includes advance from ${w.next}`,
        hint:
          w.nextOwes === w.nextFull
            ? `${w.extra} of it towards ${w.next}.`
            : `${w.next} owes ${w.nextOwes} instead of ${w.nextFull}.`,
        effect: 'ahead',
      },
      {
        key: salary ? 'bonus' : 'extra',
        label: salary ? 'Includes one-time bonus' : 'Includes one-time extra',
        hint: `${w.extra} of it is ${salary ? 'bonus' : 'extra'}, just ${w.month}.`,
        effect: 'extra',
      },
      ...(w.newAmount
        ? [
            {
              key: 'raise',
              label: salary ? 'Permanent pay raise' : 'Permanent new amount',
              hint: `From ${w.next}, we pay ${w.newAmount} a month.`,
              effect: 'new-amount' as const,
            },
          ]
        : []),
      {
        key: 'other',
        label: 'Other',
        hint: `${w.extra} extra, just ${w.month}. Say what it was below.`,
        effect: 'extra',
        needsText: true,
      },
    ]
  if (situation === 'short')
    return [
      // Paid before the month is out it is an advance; a month already over is
      // being paid late, not early, so its rest is simply paid later.
      w.shortEnded
        ? {
            key: 'later',
            label: 'Paying the rest later',
            hint: `${w.now} now, ${w.rest} of ${w.short} later.`,
            effect: null,
          }
        : {
            key: 'advance-this',
            label: `Advance from ${w.short}`,
            hint: `${w.now} now, ${w.rest} of ${w.short} later.`,
            effect: null,
          },
      {
        key: 'thats-all',
        label: `That's all for ${w.short}`,
        hint: salary
          ? `${w.rest} less, one time: leave, a fine.`
          : `${w.rest} less, one time: a smaller bill, a discount.`,
        effect: 'settle',
      },
      ...(w.cutOffered
        ? [
            {
              key: 'cut',
              label: salary ? 'Permanent pay cut' : 'Permanent new amount',
              hint: `From ${w.afterShort}, we pay ${w.settledAt} a month.`,
              effect: 'cut' as const,
            },
          ]
        : []),
      {
        key: 'other',
        label: 'Other',
        hint: `${w.rest} less, just ${w.short}. Say why below.`,
        effect: 'settle',
        needsText: true,
      },
    ]
  return []
}
