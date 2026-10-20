import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { DataActionError } from '../adapters'
import type { Database } from '../database.types'
import { createSupabaseFixedCostsAdapter } from './fixed-costs'
import { createSupabaseOverviewAdapter } from './overview'

/**
 * The live fixed-costs adapter and Overview's gated month read
 * (fixed-costs-are-spread-over-the-month, §8): which function each call names,
 * what it sends, and how a refusal reads.
 */
function fakeClient(answer: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }))
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc }
}

const KAL = '00000000-0000-4000-a000-000000000001'

describe('the live fixed-costs adapter', () => {
  it('pays in one call, leaving out a note and a choice it does not have', async () => {
    const { client, rpc } = fakeClient({ data: 'link' })
    await createSupabaseFixedCostsAdapter(client).pay({
      id: 'p',
      fixedCostId: 'f',
      amountPaise: 1_200_000,
      paidOn: '2026-11-02',
      countsIn: '2026-10-31',
      isCash: false,
      note: null,
      choice: null,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('record_fixed_cost_payment', {
      p_id: 'p',
      p_fixed_cost_id: 'f',
      p_amount_paise: 1_200_000,
      p_paid_on: '2026-11-02',
      p_counts_in: '2026-10-31',
      p_is_cash: false,
    })
  })

  it('sends the answer when there is one', async () => {
    const { client, rpc } = fakeClient({ data: 'link' })
    await createSupabaseFixedCostsAdapter(client).pay({
      id: 'p',
      fixedCostId: 'f',
      amountPaise: 1_400_000,
      paidOn: '2026-10-19',
      countsIn: '2026-10-19',
      isCash: false,
      note: 'Permanent pay raise',
      choice: 'new-amount',
    })
    expect(rpc).toHaveBeenCalledWith(
      'record_fixed_cost_payment',
      expect.objectContaining({ p_note: 'Permanent pay raise', p_choice: 'new-amount' }),
    )
  })

  it('reads a refusal in words the sheet can show', async () => {
    const { client } = fakeClient({
      error: { code: '22023', message: 'That choice does not fit this payment. Look at it again.' },
    })
    const refused = createSupabaseFixedCostsAdapter(client).undoPayment('f', 'p')
    await expect(refused).rejects.toBeInstanceOf(DataActionError)
    await expect(refused).rejects.toThrow('That choice does not fit this payment.')
  })

  it('reads a permission refusal as one', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'denied' } })
    await expect(createSupabaseFixedCostsAdapter(client).list(KAL)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })
})

describe('Overview’s month read', () => {
  const month = {
    month: '2026-10',
    from: '2026-10-01',
    through: '2026-10-18',
    revenuePaise: 0,
    profitPaise: 0,
  }

  it('asks overview_month alone while pro-rata-pnl is off', async () => {
    const { client, rpc } = fakeClient({ data: month })
    const read = await createSupabaseOverviewAdapter(client).month(KAL)
    expect(rpc).toHaveBeenCalledWith('overview_month', { p_outlet_id: KAL })
    expect(read).not.toHaveProperty('fixedCosts')
  })

  it('asks overview_month_v2 when it is on, and folds the fixed costs with the shared rules', async () => {
    const { client, rpc } = fakeClient({
      data: {
        ...month,
        fixedCosts: {
          today: '2026-10-18',
          costs: [
            {
              id: 'f',
              name: 'Rent',
              category: 'rent',
              note: null,
              startsOn: '2026-10-01',
              stopsOn: null,
              amounts: [{ fromMonth: '2026-10-01', amountPaise: 32_270_000, createdAt: 'a' }],
              settlements: [],
              payments: [],
            },
          ],
        },
      },
    })
    const read = await createSupabaseOverviewAdapter(client).month(KAL, { fixedCosts: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('overview_month_v2', { p_outlet_id: KAL })
    // ₹3,22,700 over 31 days, 18 of them owed: the shared case's figure.
    expect(read.fixedCosts?.unpaidPaise).toBe(18_737_419)
  })

  it('reads no fixed costs as none, so the tile stays #76’s', async () => {
    const { client } = fakeClient({
      data: { ...month, fixedCosts: { today: '2026-10-18', costs: [] } },
    })
    const read = await createSupabaseOverviewAdapter(client).month(KAL, { fixedCosts: true })
    expect(read.fixedCosts).toBeNull()
  })
})
