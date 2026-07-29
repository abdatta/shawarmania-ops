import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import {
  DEMO_BILLER_ID,
  DEMO_BILLER_PIN,
  DEMO_MORNING_BILLER_ID,
} from '@/data-access/mock/fixtures/billing'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { ShiftUnlock } from './shift-unlock'

/**
 * Whose bills these are. The substance is the handover — a shared tablet
 * changing hands mid-day is the normal case, not the exception — and the single
 * refusal, which must not tell anyone which half they got wrong.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

function renderShift(adapters: DataAdapters = createMockAdapters('biller')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={billerSession}>
          <AdaptersContext.Provider value={adapters}>
            <ShiftUnlock />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

async function closeTheOpenShift(adapters: DataAdapters) {
  const open = adapters.billing.getCounterState().shift
  if (open) await adapters.billing.closeShift(open.id)
}

describe('ShiftUnlock', () => {
  it('shows who holds the counter and offers to close it', async () => {
    renderShift()

    const open = await screen.findByTestId('open-shift')
    expect(open).toHaveTextContent('Demo Biller is on the counter')
    expect(screen.getByTestId('close-shift')).toBeInTheDocument()
    // No PIN pad while somebody is on: closing comes first.
    expect(screen.queryByTestId('pin-pad')).not.toBeInTheDocument()
  })

  it('lists this outlet’s billers once the counter is free', async () => {
    const adapters = createMockAdapters('biller')
    await closeTheOpenShift(adapters)
    renderShift(adapters)

    const grid = await screen.findByTestId('biller-grid')
    expect(grid).toHaveTextContent('Demo Biller')
    expect(grid).toHaveTextContent('Demo Morning Biller')
    expect(grid).not.toHaveTextContent('Demo Evening Biller')
  })

  it('opens a shift on the fourth digit, with no keyboard and no extra tap', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('biller')
    await closeTheOpenShift(adapters)
    renderShift(adapters)

    await user.click(await screen.findByTestId(`biller-${DEMO_MORNING_BILLER_ID}`))
    expect(screen.getByTestId('pin-pad')).toBeInTheDocument()

    for (const digit of DEMO_BILLER_PIN) {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    await waitFor(() => {
      expect(adapters.billing.getCounterState().shift?.billerName).toBe('Demo Morning Biller')
    })
  })

  it('refuses a wrong PIN with one sentence, and opens nothing', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('biller')
    await closeTheOpenShift(adapters)
    renderShift(adapters)

    await user.click(await screen.findByTestId(`biller-${DEMO_BILLER_ID}`))
    for (const digit of '9999') {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    expect(await screen.findByTestId('shift-error')).toHaveTextContent(/did not unlock/i)
    expect(adapters.billing.getCounterState().shift).toBeNull()
    // The entered digits are cleared, so a retry starts from nothing.
    expect(screen.getByTestId('pin-progress')).toHaveAttribute('data-filled', '0')
  })

  it('hands the counter from one biller to another', async () => {
    const user = userEvent.setup()
    const { adapters } = renderShift()

    await user.click(await screen.findByTestId('close-shift'))
    await user.click(screen.getByRole('button', { name: 'Close shift' }))

    await waitFor(() => expect(screen.getByTestId('biller-grid')).toBeInTheDocument())

    await user.click(screen.getByTestId(`biller-${DEMO_MORNING_BILLER_ID}`))
    for (const digit of DEMO_BILLER_PIN) {
      await user.click(screen.getByRole('button', { name: digit }))
    }

    await waitFor(() => {
      expect(adapters.billing.getCounterState().shift?.billerName).toBe('Demo Morning Biller')
    })
  })

  it('deletes a digit rather than trapping a mis-tap', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('biller')
    await closeTheOpenShift(adapters)
    renderShift(adapters)

    await user.click(await screen.findByTestId(`biller-${DEMO_BILLER_ID}`))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByTestId('pin-progress')).toHaveAttribute('data-filled', '2')

    await user.click(screen.getByRole('button', { name: 'Delete last digit' }))
    expect(screen.getByTestId('pin-progress')).toHaveAttribute('data-filled', '1')
  })
})
