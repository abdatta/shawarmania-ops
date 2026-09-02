import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'
import type { CounterResumeRecord } from '@/outbox'

import { OfflineFillHint } from './offline-fill-hint'

const device: CounterDeviceSession = {
  kind: 'counter-device',
  device: { deviceId: 'tablet-1', outletId: 'outlet-1', label: 'Till one' },
  shift: {
    id: 'shift-1',
    personId: 'person-1',
    outletId: 'outlet-1',
    openedAt: '2026-09-01T12:00:00.000Z',
    businessDate: '2026-09-01',
    expiresAt: '2026-09-02T00:00:00.000Z',
  },
}

describe('the offline fill hint', () => {
  it('says nothing outside the tablet tree, where the placeholder is a moment', () => {
    // Manager surfaces render the same placeholders. The hook that reads the
    // tablet throws there by design, so this must use the context directly and
    // answer with nothing rather than an error.
    render(<OfflineFillHint />)
    expect(screen.queryByTestId('offline-fill-hint')).toBeNull()
  })

  it('says nothing on a tablet that resolved its shift online', () => {
    render(
      <CounterDeviceContext.Provider value={device}>
        <OfflineFillHint />
      </CounterDeviceContext.Provider>,
    )
    expect(screen.queryByTestId('offline-fill-hint')).toBeNull()
  })

  it('explains the wait on a counter resumed from its record', () => {
    render(
      <CounterDeviceContext.Provider
        value={{ ...device, offlineResume: {} as CounterResumeRecord }}
      >
        <OfflineFillHint />
      </CounterDeviceContext.Provider>,
    )
    expect(screen.getByTestId('offline-fill-hint')).toHaveTextContent(
      'Checking the server first — your saved copy loads in a moment.',
    )
  })
})
