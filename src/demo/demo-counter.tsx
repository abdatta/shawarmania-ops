import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { useAdapters } from '@/data-access'
import { useCounterState } from '@/features/billing/use-counter-state'
import { CounterShell } from '@/features/counter/counter-shell'
import { counterDeviceFixtures, DEMO_COUNTER_DEVICE_ID } from '@/data-access/mock/fixtures/billing'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession, CounterShift } from '@/session/counter-session'
import { COUNTER_RESUME_SCHEMA_VERSION, type CounterResumeRecord } from '@/outbox'
import type { DemoConnectivity } from '@/data-access/mock'

import {
  DemoConnectivityContext,
  type DemoConnectivityControl,
  type DemoConnectivityState,
} from './demo-connectivity'

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
export function DemoCounter({
  banner,
  connectivity,
}: {
  banner?: ReactNode
  connectivity: DemoConnectivity
}) {
  const session = useDemoCounterSession(connectivity)

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

        **The connectivity control renders inside that banner**, and reaches it
        from here. A React element passed as a prop is rendered where it is
        *placed*, not where it was built — `banner` was constructed up in
        `DemoRoot`, but it resolves context from this position, which is what
        lets a provider wrapped around it serve a component that is not
        lexically inside it. The alternative was threading a setter through
        `DemoRoot` into a slot both shells are meant to treat as opaque.

        The same mechanism is what keeps the control *off* the surfaces that
        have no counter: outside this tree the context is null and the banner
        renders nothing.
      */}
      <DemoConnectivityContext.Provider value={session.connectivity}>
        <div className="sticky top-0 z-40">{banner}</div>
      </DemoConnectivityContext.Provider>
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
function useDemoCounterSession(connectivity: DemoConnectivity): {
  device: CounterDeviceSession
  reread: () => void
  connectivity: DemoConnectivityControl
} {
  const { billing, counter, menu, outlets } = useAdapters()
  const [shift, setShift] = useState<CounterShift | null>(null)

  /**
   * Both halves of "offline" are read from the store rather than held here.
   *
   * This host is **unmounted** when a walkthrough steps onto a phone — the
   * tablet is not what a phone role renders — so anything kept in its own state
   * comes back at its initial value. Holding the chosen scene here made a
   * counter that was offline before the step reconnect itself after it, which is
   * the one thing this scene must not do. The store outlives the switch, and a
   * reset rebuilds it.
   */
  const connectivityState = useSyncExternalStore(connectivity.subscribe, () => connectivity.state)
  const offlineResume = useSyncExternalStore(connectivity.subscribe, () => connectivity.resume)
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

  /**
   * The record the tablet would have found in its own storage.
   *
   * Built here rather than anywhere nearer the control, and deliberately kept
   * **identical in shape and schema version** to what `readCounterResume`
   * returns from IndexedDB after a real outage. If this drifts, the demo is
   * showing a scene the app does not actually implement, which is the one
   * failure a demo of an offline counter cannot afford.
   */
  const captureResume = useCallback(async (): Promise<CounterResumeRecord | undefined> => {
    if (!shift) return
    const [outlet, rememberedMenu, pipeline, history] = await Promise.all([
      outlets.getOutlet(device.outletId),
      menu.listMenu(device.outletId),
      billing.listOpenOrders(device.outletId),
      billing.listShiftHistory(shift.id),
    ])
    if (!outlet) return undefined
    const now = new Date().toISOString()
    return {
      tabletId: device.deviceId,
      schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
      complete: true,
      tablet: { id: device.deviceId, label: device.label, outletId: device.outletId },
      shift: {
        id: shift.id,
        personId: shift.personId,
        outletId: shift.outletId,
        openedAt: shift.openedAt,
        businessDate: shift.businessDate,
        expiresAt: shift.expiresAt,
      },
      outlet,
      menu: rememberedMenu,
      pipeline,
      bills: history.bills,
      rememberedCustomers: {},
      lastSuccessfulReadAt: now,
      serverObservedAt: now,
      deviceObservedAt: now,
    }
  }, [billing, device, menu, outlets, shift])

  /**
   * The one place that knows both halves of "offline", and the reason they are
   * two pieces of state rather than one.
   *
   * `connectivity` is whether the mock backend answers — it lives on the demo
   * store, so it survives a role switch and a reset rebuilds it. `offlineResume`
   * is a property of this counter session and lives here. Only the transitions
   * need both, so only this function holds both.
   *
   * The resume record is captured **before** the backend is taken away, which is
   * the order reality uses: the tablet wrote that record while it could still
   * read, and found it later when it could not.
   */
  const setConnectivity = useCallback(
    (next: DemoConnectivityState) => {
      if (next === 'closed-and-reopened') {
        // Captured **before** the backend is taken away, which is the order
        // reality uses: the tablet wrote that record while it could still read,
        // and found it later when it could not.
        void captureResume().then((record) => connectivity.set(next, record))
        return
      }
      connectivity.set(next)
      if (next === 'online') reread()
    },
    [captureResume, connectivity, reread],
  )

  return useMemo(
    () => ({
      device: {
        kind: 'counter-device' as const,
        device,
        shift,
        ...(offlineResume ? { offlineResume } : {}),
      },
      reread,
      connectivity: { state: connectivityState, set: setConnectivity },
    }),
    [device, shift, offlineResume, reread, connectivityState, setConnectivity],
  )
}
