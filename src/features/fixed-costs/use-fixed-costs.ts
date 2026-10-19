import { useEffect, useMemo, useState } from 'react'

import { useChangeGate } from '@/change-gates/context'
import { useAdapters } from '@/data-access'
import type { FixedCostsReading } from '@/data-access/fixed-costs'
import { fixedCostLabel } from '@/domain/fixed-costs'

/**
 * The outlet's fixed costs, read once for a screen that shows Pro-rata P&L or
 * the Fixed chip (fixed-costs-are-spread-over-the-month, design D9). Read only
 * while `pro-rata-pnl` is on and the caller says the reader may see them (the
 * owner or a manager); anyone else makes no request, which is what keeps the
 * counter's requests where they were.
 */
export function useOutletFixedCosts(
  outletId: string | null,
  enabled: boolean,
): FixedCostsReading | null {
  const { fixedCosts } = useAdapters()
  const gate = useChangeGate('pro-rata-pnl')
  const [reading, setReading] = useState<{ key: string; value: FixedCostsReading } | null>(null)
  const on = gate && enabled && outletId !== null
  useEffect(() => {
    if (!on || !outletId) return
    let active = true
    void fixedCosts
      .list(outletId)
      .then((value) => {
        if (active) setReading({ key: outletId, value })
      })
      // Nothing to chip and nothing to spread: the screen reads as it does without.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [fixedCosts, on, outletId])
  return on && reading?.key === outletId ? reading.value : null
}

export interface FixedMark {
  /** The fixed cost it pays, and its name: where the payment is changed. */
  fixedCostId: string
  name: string
  outletId: string
  label: string
  /** The payment's own note, without the fixed cost's name the row already shows. */
  note: string | null
  /** The day paid, where it differs from the day it counts in. */
  paidOn: string | null
}

/** Each fixed-cost payment's expense, marked by its link: never by what the row says. */
export function useFixedMarks(
  reading: FixedCostsReading | null,
  outletId: string | null = null,
): Map<string, FixedMark> {
  return useMemo(() => {
    const marks = new Map<string, FixedMark>()
    for (const cost of reading?.costs ?? [])
      for (const payment of cost.payments)
        marks.set(payment.expenseId, {
          fixedCostId: cost.id,
          name: cost.name,
          outletId: outletId ?? '',
          label: fixedCostLabel(cost.name, cost.category),
          note: payment.note,
          paidOn: payment.paidOn === payment.countsIn ? null : payment.paidOn,
        })
    return marks
  }, [reading, outletId])
}
