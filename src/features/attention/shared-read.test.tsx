import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FOREGROUND_REREAD_AFTER_MS } from '@/lib/freshness'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { attentionChanged, useSharedRead } from './attention'

/**
 * A shared count re-reads on returning to the foreground. With `fewer-requests`
 * on it does only once the count is two minutes old, and a nudge still re-reads
 * at once (the-app-asks-the-server-less, D6).
 */

function Count({ id, read }: { id: object; read: () => Promise<number> }) {
  const { value } = useSharedRead(id, read)
  return <p data-testid="count">{value ?? 'none'}</p>
}

function foreground() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describeChangeGate('fewer-requests', (on) => {
  function renderCount() {
    const read = vi.fn(async () => 3)
    render(
      <ChangeGatesForTest on={{ 'fewer-requests': on }}>
        <Count id={{}} read={read} />
      </ChangeGatesForTest>,
    )
    return read
  }

  it(`${on ? 'does not re-read' : 're-reads'} a fresh count on returning to the foreground`, async () => {
    const read = renderCount()
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'))
    expect(read).toHaveBeenCalledTimes(1)

    foreground()
    await act(() => vi.advanceTimersByTimeAsync(10))

    expect(read).toHaveBeenCalledTimes(on ? 1 : 2)
  })

  it('re-reads a count older than two minutes on returning to the foreground', async () => {
    const read = renderCount()
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))

    await act(() => vi.advanceTimersByTimeAsync(FOREGROUND_REREAD_AFTER_MS + 1_000))
    foreground()

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('re-reads at once on a nudge, however fresh', async () => {
    const read = renderCount()
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))

    act(() => attentionChanged())

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })
})
