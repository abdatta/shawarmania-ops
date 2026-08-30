import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAdapters } from '@/data-access'
import { useCounterState } from '@/features/billing/use-counter-state'
import { CounterShell } from '@/features/counter/counter-shell'
import { counterDeviceFixtures, DEMO_COUNTER_DEVICE_ID } from '@/data-access/mock/fixtures/billing'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession, CounterShift } from '@/session/counter-session'

/**
 * The demo's counter tablet — **the same shell the enrolled device runs**.
 *
 * The Biller walkthrough used to be the role shell with Counter and Expenses as
 * navigation tabs, which was a second implementation of a screen production
 * already had. It drifted, predictably: by the time Finish Day grew a readiness
 * sheet and Leave counter grew a confirmation, none of it could be shown to
 * anybody, because the demo did not mount the file any of it lived in. So this
 * mounts `CounterShell` itself. There is no demo copy left to drift.
 *
 * **It is deliberately not `CounterRoot`.** That component imports
 * `createSupabaseAdapters` and the real session context, and the demo tree is
 * structurally forbidden from reaching either — `demo-safety` proves the import
 * graph, and eslint enforces the boundary. What is duplicated here is a context
 * provider and a `shift`/`onShiftChanged` pair; everything a viewer looks at
 * comes from the shared shell.
 */
export function DemoCounter({ banner }: { banner?: ReactNode }) {
  const session = useDemoCounterSession()

  return (
    <CounterDeviceContext.Provider value={session.device}>
      {/*
        The tablet has no chrome of its own and must not grow any: no navigation,
        no account menu, no sign-out is the shape of the production screen rather
        than an omission. So the banner sits above it, which also keeps the role
        switcher reachable — stepping off the tablet onto a phone to approve a
        shift request is the demo's best scene, and it is navigation the tablet
        itself must never offer.

        **Sticky rather than merely first.** The counter is `min-h-dvh` and its
        expenses panel sits below the fold, so the page genuinely scrolls — as it
        does on real hardware. A banner that scrolled away with it would leave
        somebody looking at a full-screen till with no indication that the money
        on it is invented, and "always visible, never dismissable" is the demo's
        oldest promise. The phone and role shells get this from a flex column
        that owns the viewport; the tablet, which does not, gets it here.
      */}
      <div className="sticky top-0 z-40">{banner}</div>
      <DemoCounterDelivery />
      <CounterShell shift={session.device.shift} onShiftChanged={session.reread} />
    </CounterDeviceContext.Provider>
  )
}

/**
 * Delivery is mounted here for the reason it is mounted in `CounterRoot`: it
 * belongs to the enrolled tablet rather than to the presence of an operator, so
 * queued work drains while the shell is asking for the next shift.
 *
 * It earns its place in the demo too, though for a smaller reason. The mock
 * outbox drains when the counter state gains its first subscriber, and the
 * seeded unsent bill is what Finish Day's readiness sheet reports on — so a
 * walkthrough that opens the sheet from the no-shift screen still sees the queue
 * move rather than a number frozen at one.
 */
function DemoCounterDelivery() {
  useCounterState()
  return null
}

/**
 * The tablet the demo is standing at, and whoever currently holds it.
 *
 * Re-resolved rather than remembered: a shift opening, ending or being handed
 * over changes what this tablet *is*, which is exactly why `CounterRoot`
 * revalidates its session rather than keeping a second copy of the answer beside
 * it. Here the answer comes from the counter adapter's own live-shift read, so
 * the tablet, the Tablets surface and every phone are reading one row.
 */
function useDemoCounterSession(): { device: CounterDeviceSession; reread: () => void } {
  const { counter } = useAdapters()
  const [shift, setShift] = useState<CounterShift | null>(null)
  const [generation, setGeneration] = useState(0)
  const reread = useCallback(() => setGeneration((count) => count + 1), [])

  const device = useMemo(() => {
    const fixture = counterDeviceFixtures.find(
      (candidate) => candidate.id === DEMO_COUNTER_DEVICE_ID,
    )
    if (!fixture) throw new Error('The demo counter tablet fixture is missing.')
    return { deviceId: fixture.id, outletId: fixture.outlet_id, label: fixture.label }
  }, [])

  useEffect(() => {
    let active = true
    void counter.listLiveShifts().then((shifts) => {
      if (!active) return
      const live = shifts.find((candidate) => candidate.deviceId === device.deviceId)
      setShift(
        live
          ? {
              id: live.id,
              personId: live.personId,
              outletId: live.outletId,
              openedAt: live.openedAt,
              businessDate: live.businessDate,
              expiresAt: live.expiresAt,
            }
          : null,
      )
    })
    return () => {
      active = false
    }
  }, [counter, device.deviceId, generation])

  // The handshake announces confirmations and endings to every listener, which
  // is how approving from a phone lands on the tablet without anybody touching
  // it — the demo's stand-in for the realtime channel the real tablet watches.
  useEffect(
    () => counter.subscribeToDeviceHandshake(device.deviceId, reread),
    [counter, device.deviceId, reread],
  )

  return useMemo(
    () => ({ device: { kind: 'counter-device' as const, device, shift }, reread }),
    [device, shift, reread],
  )
}
