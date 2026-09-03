import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'

import { AdaptersContext } from '@/data-access/adapters-context'
import { enterDemoScope, exitDemoScope } from '@/data-access/demo-scope'
import { createDemoData, createMockAdapters, personaFixtures } from '@/data-access/mock'
import { trackAdapterWrites } from '@/data-access/track-adapter-writes'
import { NotFound } from '@/routes/not-found'
import { PhoneShell } from '@/shell/phone-shell'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, roleFromSegment, type Session } from '@/session/session'

import { DemoBanner } from './demo-banner'
import { DemoCounter } from './demo-counter'
import { DemoResetContext } from './demo-reset'

/**
 * The demo branch's provider stack (design D1/D8). The role comes from the
 * URL — /demo/:roleSegment/* — so a deep link or a reload reconstructs the
 * whole session with no stored state. Only mock adapters are constructed
 * here; this module must never import the Supabase client or the real
 * adapters (eslint enforces it).
 */
export function DemoRoot() {
  const { roleSegment } = useParams()
  const { pathname } = useLocation()
  const role = roleFromSegment(roleSegment)

  // Mark the demo scope during render, not in an effect: children render
  // (and run their effects) before a parent's effect, and the tripwire must
  // already be armed when they do. The lazy ref-init pattern keeps enter/exit
  // balanced under StrictMode's double-invoked renders; the effect re-enters
  // after StrictMode's simulated unmount so the pairing stays exact.
  const scoped = useRef<boolean | null>(null)
  if (scoped.current == null) {
    enterDemoScope()
    scoped.current = true
  }
  useEffect(() => {
    const wasScoped = scoped.current === true
    if (!wasScoped) {
      enterDemoScope()
      scoped.current = true
    }
    return () => {
      exitDemoScope()
      scoped.current = false
    }
  }, [])

  const session = useMemo<Session | undefined>(() => {
    if (!role) return undefined
    const persona = personaFixtures[role]
    return {
      mode: 'demo',
      userId: persona.profile.id,
      assignments: persona.assignments,
      ...deriveSessionScope(persona.assignments),
      displayName: persona.profile.full_name,
      persona,
    }
  }, [role])

  /**
   * Bumped by the reset control. Every mock adapter — and the store beneath
   * them — is rebuilt when it changes, which is the whole of "demo state
   * resets": there is no snapshot to restore, because the starting state is
   * what `createDemoStore()` produces every time (design D10).
   *
   * The role stays in the URL, so a reset returns to the surface it was called
   * from rather than sending the reader back to the owner.
   */
  const [resetCount, setResetCount] = useState(0)
  const reset = useCallback(() => setResetCount((count) => count + 1), [])

  /**
   * The demo's data, which **outlives a role switch**. Several mocks are built
   * per role, so switching rebuilds the adapters — and if the data went with
   * them, raising an alert as the manager and answering it as the owner would
   * show an empty inbox, because it would be a different demo by then.
   *
   * Only a reset replaces it.
   */
  const data = useMemo(
    () => createDemoData(),
    // resetCount is the point of this dependency: a fresh dataset is exactly
    // what a reset is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resetCount],
  )

  // The persona's role reaches the mock so it can enforce the same owner-only
  // boundary the database does — a demo that let a manager change a staff code
  // would teach a product this one is not.
  // Wrapped exactly as the real tree wraps its own, so a demo walked while an
  // update is waiting is not reloaded in the middle of a write either.
  const adapters = useMemo(
    () => trackAdapterWrites(createMockAdapters(role ?? 'super_admin', data)),
    [role, data],
  )

  // The tablet's own address, with nothing after it.
  const atTabletRoot = pathname.replace(/\/$/, '') === `/demo/${roleSegment}`

  if (!session) return <NotFound />

  return (
    <SessionContext.Provider value={session}>
      <DemoResetContext.Provider value={reset}>
        {/* Keyed so a reset remounts the surfaces too. New adapters alone
            would reload the data and leave a half-filled form open over it,
            which is not "the same place every walkthrough starts". */}
        <AdaptersContext.Provider key={resetCount} value={adapters}>
          {/*
            The Biller is a tablet, not a phone, and since this change it is the
            *enrolled* tablet's own shell rather than a role-shell imitation of
            one. The other three roles are people holding phones, which is what
            `PhoneShell` is for.
          */}
          {session.role === 'biller' ? (
            /*
              A tablet has exactly one screen. Production mounts `/counter` as a
              leaf route, so `/counter/people` and `/counter/billing` are equally
              not pages there — the tablet's surfaces are panels within its shell,
              not addresses. Answering the same way here keeps the honest "that
              page does not exist" a Biller has always met, and stops the demo
              offering a phone-shaped copy of a screen the tablet already holds.
            */
            atTabletRoot ? (
              /* The store's connectivity rather than the host's own, so taking
                 the counter offline survives a step onto a phone and back —
                 which is precisely the walkthrough this scene exists for. */
              <DemoCounter banner={<DemoBanner />} connectivity={data.store.connectivity} />
            ) : (
              <>
                <DemoBanner />
                <NotFound />
              </>
            )
          ) : (
            <PhoneShell banner={<DemoBanner />} />
          )}
        </AdaptersContext.Provider>
      </DemoResetContext.Provider>
    </SessionContext.Provider>
  )
}
