import { useCallback } from 'react'

import { useAdapters } from '@/data-access'
import type { FixedCostsUnpaid } from '@/data-access/fixed-costs'
import { useSharedRead, type Attention } from '@/features/attention/attention'

import { FIXED_COSTS_PATH, useFixedTabAvailable } from './use-fixed-tab'
import { overdueTone, overdueWords } from './words'

const NOTHING: FixedCostsUnpaid = { count: 0, months: [], paise: 0, categories: {}, today: null }

/**
 * Fixed costs with a month that ended unpaid (fixed-costs-are-spread-over-the-month,
 * design D7): somebody has to pay them, or record that they were paid. Counted
 * across every outlet the reader reaches, like every badge here, and read on
 * mount, on returning to the foreground and when the page says it did the work.
 *
 * It badges the Expenses entry and opens the **Fixed** tab. Where that tab is not
 * shown (staff, or the live app before the owner approves it) it reads nothing
 * and asks the server nothing.
 */
export function useFixedCostsUnpaidAttention(): Attention | null {
  const { fixedCosts } = useAdapters()
  const available = useFixedTabAvailable()
  const read = useCallback(
    () => (available ? fixedCosts.unpaid() : Promise.resolve(NOTHING)),
    [available, fixedCosts],
  )
  const { value } = useSharedRead(fixedCosts, read)
  if (value === null) return null
  const words = overdueWords(value)
  return {
    count: value.count,
    label: words,
    // Money first (owner, 2026-10-20): *₹27,300 overdue · 3 salaries, 1 rent · from September*.
    summaryLabel: words,
    path: FIXED_COSTS_PATH,
    tone: overdueTone(value),
  }
}
