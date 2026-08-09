import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAdapters } from '@/data-access'
import type { CounterShiftRequest, LiveCounterShift } from '@/data-access/adapters'
import { useSharedRead, type Attention } from '@/features/attention/attention'
import { useSession } from '@/session/context'

/**
 * What the counter is asking of the person holding this phone.
 *
 * Two things at once, because they are two states of the same relationship: a
 * **request** waiting to be approved, and a **shift** they are currently
 * accountable for. A home surface shows whichever exists.
 *
 * **It resolves on load and on focus, and treats Realtime as a nudge.** That
 * ordering is the whole degradation story: with the channel up, a request
 * appears within a second of the tablet asking; with it down, the card is there
 * the moment somebody opens or returns to the app. Nothing here waits for a
 * subscription before it reads, so an unavailable channel costs latency and
 * never correctness. `useSharedRead` supplies the mount read, the foreground
 * re-read and the shared result — the navigation renders twice and the home card
 * once, and all three want the same answer.
 *
 * A request also expires by itself, so this holds a one-second tick for exactly
 * as long as one is pending. A card that outlives its request is a card somebody
 * approves for a counter that stopped asking.
 */
export interface CounterHandshake {
  requests: CounterShiftRequest[]
  shifts: LiveCounterShift[]
  /** False until the first read lands, which is what "not known yet" looks like. */
  loaded: boolean
  reread: () => void
}

interface HandshakeSnapshot {
  requests: CounterShiftRequest[]
  shifts: LiveCounterShift[]
}

function unexpired<T extends { expiresAt: string }>(rows: T[], now: number): T[] {
  return rows.filter((row) => Date.parse(row.expiresAt) > now)
}

export function useCounterHandshake(): CounterHandshake {
  const { counter } = useAdapters()
  const { userId } = useSession()

  const read = useCallback(async (): Promise<HandshakeSnapshot> => {
    const [requests, shifts] = await Promise.all([
      counter.listPendingRequests(),
      counter.listLiveShifts(),
    ])
    return { requests, shifts }
  }, [counter])

  const { value, reread } = useSharedRead<HandshakeSnapshot>(counter, read)

  /**
   * The clock, as state rather than as a call during render.
   *
   * Both reads are already filtered server-side, so **zero means "nothing has
   * expired since the read"**, which is true the instant it lands. The ticking
   * only has to catch the two minutes a pending request is alive, so the timer
   * runs exactly while one is and stops the moment none is — the same bargain the
   * rest of the attention mechanism strikes: no timer for a number nobody is
   * waiting on.
   */
  const [now, setNow] = useState(0)
  const pending = value?.requests.length ?? 0

  useEffect(() => {
    if (pending === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pending])

  useEffect(() => {
    return counter.subscribeToOwnHandshake(userId, reread)
  }, [counter, userId, reread])

  const live = useMemo(
    () => ({
      requests: unexpired(value?.requests ?? [], now),
      // Their own, and nobody else's: a manager reading this list sees their
      // outlet's shifts too, and "You are on the counter" about somebody else
      // would be the worst sentence on the screen.
      shifts: unexpired(value?.shifts ?? [], now).filter((shift) => shift.personId === userId),
    }),
    [value, now, userId],
  )

  return { requests: live.requests, shifts: live.shifts, loaded: value !== null, reread }
}

/**
 * The badge behind the home tab: somebody is standing at a counter waiting.
 *
 * A request lives two minutes, so this is the most perishable count in the app
 * and the one place where "the badge may lag" would be useless. It does not lag,
 * because the hook behind it is subscribed — and when the channel is down the
 * count still refreshes when the app comes back to the foreground, which is the
 * moment somebody looks at the phone in their apron.
 */
export function useCounterRequestAttention(): Attention | null {
  const { requests, loaded } = useCounterHandshake()
  if (!loaded) return null
  return {
    count: requests.length,
    label:
      requests.length === 1
        ? 'a counter is waiting for you to open it'
        : `${requests.length} counters are waiting for you to open them`,
  }
}
