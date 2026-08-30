import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { CounterRoot } from './counter-root'
import { RealSessionContext } from './real-session-context'

const harness = vi.hoisted(() => ({
  adapters: { billing: {} },
  useCounterState: vi.fn(),
}))

vi.mock('@/data-access/supabase-adapters', () => ({
  createSupabaseAdapters: () => harness.adapters,
}))

vi.mock('@/features/billing/use-counter-state', () => ({
  useCounterState: harness.useCounterState,
}))

vi.mock('@/features/counter/counter-shell', () => ({
  CounterShell: ({ shift }: { shift: unknown }) => (
    <div data-testid="counter-shell">{shift === null ? 'Waiting for operator' : 'Billing'}</div>
  ),
}))

describe('counter tablet root', () => {
  it('keeps delivery subscribed while the enrolled tablet has no live shift', () => {
    harness.useCounterState.mockReturnValue({})
    render(
      <MemoryRouter>
        <RealSessionContext.Provider
          value={{
            state: {
              status: 'counter',
              device: {
                kind: 'counter-device',
                device: { deviceId: 'device-1', outletId: 'outlet-1', label: 'Counter tablet' },
                shift: null,
              },
            },
            revalidate: vi.fn(),
            endSession: vi.fn(),
          }}
        >
          <CounterRoot />
        </RealSessionContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('counter-shell')).toHaveTextContent('Waiting for operator')
    expect(harness.useCounterState).toHaveBeenCalledOnce()
    expect(harness.adapters).toBeTruthy()
  })
})
