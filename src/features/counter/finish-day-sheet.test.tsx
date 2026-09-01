import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { FinishDayReadiness } from '@/data-access/adapters'
import { createMockAdapters } from '@/data-access/mock'

import { FinishDaySheet } from './finish-day-sheet'

function renderSheet(readiness: FinishDayReadiness) {
  const adapters = createMockAdapters('biller')
  adapters.billing.inspectFinishDay = vi.fn().mockResolvedValue(readiness)
  adapters.billing.closeShift = vi.fn().mockResolvedValue(undefined)
  const onFinished = vi.fn()
  render(
    <AdaptersContext.Provider value={adapters}>
      <FinishDaySheet open shiftId="shift-1" onClose={vi.fn()} onFinished={onFinished} />
    </AdaptersContext.Provider>,
  )
  return { adapters, onFinished }
}

describe('Finish Day readiness sheet', () => {
  it('treats recent tender editing as advisory and finishes immediately when chosen', async () => {
    const user = userEvent.setup()
    const { adapters, onFinished } = renderSheet({
      unsentCount: 0,
      needsAttentionCount: 0,
      openOrderCount: 0,
      editablePaymentCount: 1,
      serverReachable: true,
      attributionExceptionCount: 0,
      canFinish: true,
    })

    expect(await screen.findByText(/recent payment can still be edited/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review recent payments/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /finish day now/i }))

    expect(adapters.billing.closeShift).toHaveBeenCalledWith('shift-1')
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('names every hard blocker and offers no finish bypass', async () => {
    renderSheet({
      unsentCount: 2,
      needsAttentionCount: 1,
      openOrderCount: 3,
      editablePaymentCount: 0,
      serverReachable: false,
      attributionExceptionCount: 0,
      canFinish: false,
    })

    expect(await screen.findByText(/Finish Day is unavailable offline/i)).toBeInTheDocument()
    expect(screen.getByText(/2 actions still sending/i)).toBeInTheDocument()
    expect(screen.getByText(/1 action needs attention/i)).toBeInTheDocument()
    expect(screen.getByText(/3 open orders/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /finish day now/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check again/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep billing/i })).toBeInTheDocument()
  })

  it('keeps earlier attribution exceptions informational and financially included', async () => {
    renderSheet({
      unsentCount: 0,
      needsAttentionCount: 0,
      openOrderCount: 0,
      editablePaymentCount: 0,
      serverReachable: true,
      attributionExceptionCount: 2,
      canFinish: true,
    })

    expect(await screen.findByText(/2 earlier flagged bills/i)).toHaveTextContent(
      /included in today’s takings/i,
    )
    expect(screen.getByRole('button', { name: /^finish day$/i })).toBeInTheDocument()
  })
})
